import {
  COULEURS,
  bouton,
  echapper as echapperMail,
  habillerMail,
  paragraphe,
  salutation,
} from '../mail/gabarit.js';
import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import { entreprises } from '../crm/schema.js';
import type { Database, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { TYPES_TEST_VMA, vmaTests, type TestVma, type TypeTestVma } from './schema.js';

export type InvitationDeps = {
  // Adresse du site (ex. https://www.simatis.fr) et jeton des invitations (VMA_OS_TOKEN côté site).
  url: string;
  token: string;
  fetch?: typeof fetch;
};

export class InvitationImpossible extends Error {}
export class TestIntrouvable extends Error {}

// Règle du semestre (cahier, §7.1) : un premier test par entreprise au plus tous les 182 jours
// glissants. Au-delà, Marc doit confirmer explicitement. Les essais n'entrent pas dans la règle.
export const SEMESTRE_JOURS = 182;

export type DernierTest = { id: string; date: string; entrepriseNom: string };

export class SemestreAConfirmer extends Error {
  constructor(readonly dernier: DernierTest) {
    super(
      `${dernier.entrepriseNom} a déjà passé un test le ${new Date(dernier.date).toLocaleDateString('fr-FR')} : moins de ${SEMESTRE_JOURS} jours. Confirmez pour créer une nouvelle invitation.`,
    );
  }
}

// Le dernier premier test reçu de l'entreprise, s'il date de moins de 182 jours.
async function testRecent(
  tx: Tx,
  instanceId: string,
  p: { entrepriseId?: string | null; entrepriseNom: string },
  maintenant: Date,
): Promise<DernierTest | null> {
  const limite = new Date(maintenant.getTime() - SEMESTRE_JOURS * 24 * 3600 * 1000);
  const nom = sql`lower(${vmaTests.entrepriseNom}) = lower(${p.entrepriseNom})`;
  const [dernier] = await tx
    .select({
      id: vmaTests.id,
      recueLe: vmaTests.recueLe,
      entrepriseNom: vmaTests.entrepriseNom,
    })
    .from(vmaTests)
    .where(
      and(
        eq(vmaTests.instanceId, instanceId),
        eq(vmaTests.type, 'premier'),
        eq(vmaTests.statut, 'utilisee'),
        gte(vmaTests.recueLe, limite),
        p.entrepriseId ? or(eq(vmaTests.entrepriseId, p.entrepriseId), nom) : nom,
      ),
    )
    .orderBy(desc(vmaTests.recueLe))
    .limit(1);
  if (!dernier?.recueLe) return null;
  return {
    id: dernier.id,
    date: dernier.recueLe.toISOString(),
    entrepriseNom: dernier.entrepriseNom,
  };
}

const base = (url: string) => url.replace(/\/+$/, '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Crée une invitation sur le site, puis la garde dans l'instance avec son lien. Le site ne reçoit
// que le nom de l'entreprise et le type : aucune donnée de mandat.
export async function creerInvitation(
  db: Database,
  deps: InvitationDeps,
  p: {
    instanceId: string;
    entrepriseId?: string | null;
    entrepriseNom: string;
    type: TypeTestVma;
    contactNom?: string | null;
    contactEmail?: string | null;
    tutoiement?: boolean;
    // Réponse de Marc à l'alerte du semestre (true = il confirme).
    confirmerSemestre?: boolean;
  },
): Promise<TestVma> {
  const nom = p.entrepriseNom.trim();
  if (!nom) throw new InvitationImpossible("Nom de l'entreprise manquant");
  if (!TYPES_TEST_VMA.includes(p.type)) throw new InvitationImpossible("Type d'invitation inconnu");
  const email = p.contactEmail?.trim() || null;
  if (email && !EMAIL.test(email))
    throw new InvitationImpossible('Adresse e-mail du contact invalide');

  return withInstance(db, p.instanceId, async (tx) => {
    if (p.entrepriseId) {
      const [trouvee] = await tx
        .select({ id: entreprises.id })
        .from(entreprises)
        .where(and(eq(entreprises.instanceId, p.instanceId), eq(entreprises.id, p.entrepriseId)));
      if (!trouvee) throw new InvitationImpossible('Entreprise introuvable dans cette instance');
    }

    if (p.type === 'premier' && !p.confirmerSemestre) {
      const dernier = await testRecent(tx, p.instanceId, { ...p, entrepriseNom: nom }, new Date());
      if (dernier) throw new SemestreAConfirmer(dernier);
    }

    const http = deps.fetch ?? fetch;
    const res = await http(`${base(deps.url)}/api/test-vma/invitations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ entreprise: nom, type: p.type }),
    });
    if (!res.ok) throw new InvitationImpossible(`Site : création refusée (${res.status})`);
    const { id, expireLe } = (await res.json()) as { id: string; expireLe: string };

    // Le lien n'existe qu'une fois l'invitation créée côté site : sans lien, pas d'invitation dans l'OS.
    const [cree] = await tx
      .insert(vmaTests)
      .values({
        instanceId: p.instanceId,
        entrepriseId: p.entrepriseId ?? null,
        entrepriseNom: nom,
        contactNom: p.contactNom?.trim() || null,
        contactEmail: email,
        tutoiement: p.tutoiement ?? false,
        type: p.type,
        statut: 'envoyee',
        invitationId: id,
        lien: `${base(deps.url)}/test-vma?i=${id}`,
        expireLe: new Date(expireLe),
      })
      .returning();
    if (!cree) throw new InvitationImpossible("Enregistrement de l'invitation impossible");
    return cree;
  });
}

export type EnvoiInvitation = { statut: 'envoye' | 'simule' | 'echec'; raison?: string };

const echapper = echapperMail;

type ParamsMail = {
  entrepriseNom: string;
  contactNom: string | null;
  lien: string;
  expireLe: Date;
  tutoiement?: boolean;
  origine?: 'invitation' | 'inscription';
};

// Les deux registres d'un même mail : seule la formulation change, jamais le gabarit.
const registre = (tutoiement?: boolean) =>
  tutoiement
    ? { votre: 'ton', lienVoici: 'Voici ton lien', copiez: 'copie' }
    : { votre: 'votre', lienVoici: 'Voici votre lien', copiez: 'copiez' };

const pixel = (lien: string) => {
  const url = urlPixel(lien);
  return url
    ? `<tr><td style="height:0;line-height:0;font-size:0;"><img src="${echapper(url)}" width="1" height="1" alt="" style="display:block;border:0;"></td></tr>`
    : '';
};

// Le pixel de suivi vient du lien du test : même site, même identifiant d'invitation. Sans lien reconnaissable, pas de pixel.
export function urlPixel(lien: string): string | null {
  return lien.includes('/test-vma?i=')
    ? lien.replace('/test-vma?i=', '/api/test-vma/pixel?i=')
    : null;
}

function corpsMail(p: ParamsMail, introduction: string): string {
  const r = registre(p.tutoiement);
  const lien = echapper(p.lien);
  return `<tr><td style="padding:26px 32px 4px;">${[
    paragraphe(salutation(p.contactNom)),
    paragraphe(introduction),
    bouton('Passer le test VMA', p.lien),
    paragraphe(`Le lien expire le ${p.expireLe.toLocaleDateString('fr-FR')}.`),
    paragraphe(
      `Si le bouton ne s’ouvre pas, ${r.copiez} ce lien : <a href="${lien}" style="color:${COULEURS.nuit};text-decoration:underline;">${lien}</a>`,
    ),
  ].join('')}</td></tr>${pixel(p.lien)}`;
}

// Mail d'invitation : le lien, le nom de l'entreprise et la date d'expiration, rien d'autre.
export function mailInvitation(p: ParamsMail): { subject: string; html: string } {
  const r = registre(p.tutoiement);
  return {
    subject: `Votre test VMA : ${p.entrepriseNom}`,
    html: habillerMail(
      corpsMail(
        p,
        `${p.origine === 'inscription' ? 'Conformément à votre demande, voici votre lien' : r.lienVoici} pour passer le test VMA de ${echapper(p.entrepriseNom)} :`,
      ),
      { tutoiement: p.tutoiement },
    ),
  };
}

// Relance : même gabarit et même lien, un court rappel en tête.
export function mailRelance(p: ParamsMail): { subject: string; html: string } {
  const r = registre(p.tutoiement);
  return {
    subject: `Rappel : ${r.votre} test VMA (${p.entrepriseNom})`,
    html: habillerMail(
      corpsMail(
        p,
        `Je me permets de revenir vers ${p.tutoiement ? 'toi' : 'vous'} au sujet du test VMA de ${echapper(p.entrepriseNom)}, que ${p.tutoiement ? 'tu n’as' : 'vous n’avez'} pas encore passé. ${r.lienVoici} :`,
      ),
      { tutoiement: p.tutoiement },
    ),
  };
}

// Envoie un mail de l'invitation depuis la messagerie de l'instance. Jamais bloquant : le résultat
// dit si le mail est parti, simulé, ou en échec (avec la raison).
export async function envoyerMail(
  tx: Tx,
  instance: Instance,
  ecriture: ConnexionDeps,
  p: { to: string | null; message: { subject: string; html: string } },
): Promise<EnvoiInvitation> {
  if (!p.to) return { statut: 'echec', raison: 'aucune adresse e-mail' };
  try {
    const res = await tx.transaction((sp) =>
      writeVia(
        sp,
        instance,
        'messagerie',
        { op: 'message.send', data: { to: p.to, ...p.message } },
        ecriture,
      ),
    );
    return res.simulation ? { statut: 'simule' } : { statut: 'envoye' };
  } catch (error) {
    return {
      statut: 'echec',
      raison: error instanceof Error ? error.message : String(error),
    };
  }
}

// Envoie le mail d'invitation. Avec `id`, le résultat est consigné sur l'invitation : date du
// dernier envoi réel, ou raison de l'échec. Une simulation ne change rien.
export async function envoyerInvitation(
  db: Database,
  instance: Instance,
  ecriture: ConnexionDeps,
  test: Pick<TestVma, 'entrepriseNom' | 'contactNom' | 'contactEmail' | 'lien' | 'expireLe'> & {
    id?: string;
    tutoiement?: boolean;
    origine?: 'invitation' | 'inscription';
  },
): Promise<EnvoiInvitation> {
  if (!test.contactEmail) return { statut: 'echec', raison: 'aucune adresse e-mail' };
  const message = mailInvitation({
    entrepriseNom: test.entrepriseNom,
    contactNom: test.contactNom,
    lien: test.lien,
    expireLe: test.expireLe,
    tutoiement: test.tutoiement,
    origine: test.origine,
  });
  return withInstance(db, instance.id, async (tx) => {
    if (test.id) {
      const [actuel] = await tx
        .select()
        .from(vmaTests)
        .where(and(eq(vmaTests.instanceId, instance.id), eq(vmaTests.id, test.id)))
        .for('update');
      if (!actuel) return { statut: 'echec', raison: 'Invitation introuvable' };
      if (actuel.envoyeeLe) return { statut: 'envoye' };
      if (actuel.statut !== 'envoyee' || actuel.expireLe <= new Date())
        return { statut: 'echec', raison: 'Invitation expirée ou fermée' };
    }
    const envoi = await envoyerMail(tx, instance, ecriture, { to: test.contactEmail, message });
    if (test.id && envoi.statut !== 'simule') {
      await tx
        .update(vmaTests)
        .set(
          envoi.statut === 'envoye'
            ? { envoyeeLe: new Date(), echecEnvoi: null, updatedAt: new Date() }
            : { echecEnvoi: envoi.raison ?? 'échec', updatedAt: new Date() },
        )
        .where(and(eq(vmaTests.instanceId, instance.id), eq(vmaTests.id, test.id)));
    }
    return envoi;
  });
}

// Révoque une invitation encore ouverte : d'abord côté site, puis dans l'OS.
export async function revoquerInvitation(
  db: Database,
  deps: InvitationDeps,
  p: { instanceId: string; testId: string },
): Promise<TestVma> {
  return withInstance(db, p.instanceId, async (tx) => {
    const [test] = await tx
      .select()
      .from(vmaTests)
      .where(and(eq(vmaTests.instanceId, p.instanceId), eq(vmaTests.id, p.testId)));
    if (!test) throw new InvitationImpossible('Invitation introuvable dans cette instance');
    if (test.statut !== 'envoyee')
      throw new InvitationImpossible('Seule une invitation ouverte peut être révoquée');

    const http = deps.fetch ?? fetch;
    const res = await http(`${base(deps.url)}/api/test-vma/invitations?id=${test.invitationId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${deps.token}` },
    });
    if (!res.ok) throw new InvitationImpossible(`Site : révocation refusée (${res.status})`);

    const [maj] = await tx
      .update(vmaTests)
      .set({ statut: 'revoquee', updatedAt: new Date() })
      .where(and(eq(vmaTests.instanceId, p.instanceId), eq(vmaTests.id, p.testId)))
      .returning();
    if (!maj) throw new InvitationImpossible("Mise à jour de l'invitation impossible");
    return maj;
  });
}

// Suppression définitive d'un test (par exemple créé pour essayer). Une invitation encore ouverte
// est d'abord révoquée côté site, pour que son lien cesse de fonctionner.
export async function supprimerTest(
  db: Database,
  deps: InvitationDeps | null,
  p: { instanceId: string; testId: string },
): Promise<void> {
  const [test] = await withInstance(db, p.instanceId, (tx) =>
    tx
      .select()
      .from(vmaTests)
      .where(and(eq(vmaTests.instanceId, p.instanceId), eq(vmaTests.id, p.testId))),
  );
  if (!test) throw new TestIntrouvable();
  if (test.statut === 'envoyee') {
    if (!deps) throw new InvitationImpossible('Test de VMA non configuré (VMA_OS_TOKEN)');
    await revoquerInvitation(db, deps, p);
  }
  await withInstance(db, p.instanceId, (tx) =>
    tx
      .delete(vmaTests)
      .where(and(eq(vmaTests.instanceId, p.instanceId), eq(vmaTests.id, p.testId))),
  );
}

// Espace testeur : le site ouvre une session temporaire (12 h) pour Marc. Rien n'est gardé dans
// l'OS, ni invitation ni résultat : les essais restent dans le navigateur de Marc.
export async function ouvrirEspaceTesteur(
  deps: InvitationDeps,
): Promise<{ lien: string; expireLe: string }> {
  const http = deps.fetch ?? fetch;
  const res = await http(`${base(deps.url)}/api/test-vma/testeur/acces`, {
    method: 'POST',
    headers: { authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new InvitationImpossible(`Site : accès testeur refusé (${res.status})`);
  const { id, expireLe } = (await res.json()) as { id: string; expireLe: string };
  return { lien: `${base(deps.url)}/test-vma/testeur?t=${id}`, expireLe };
}

// Un lien de formulaire par destinataire de prospection ; aucun contact ni test créé avant inscription.
export async function creerLienProspectionVma(
  deps: InvitationDeps,
): Promise<{ lien: string; expireLe: string }> {
  const res = await (deps.fetch ?? fetch)(`${base(deps.url)}/api/test-vma/liens-prospection`, {
    method: 'POST',
    headers: { authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) throw new InvitationImpossible(`Site : création du lien refusée (${res.status})`);
  const { id, expireLe } = (await res.json()) as { id: string; expireLe: string };
  if (!/^[0-9a-f]{32}$/.test(id) || !Number.isFinite(Date.parse(expireLe)))
    throw new InvitationImpossible('Lien de prospection invalide');
  return { lien: `${base(deps.url)}/inscription-vma?a=${id}`, expireLe };
}
