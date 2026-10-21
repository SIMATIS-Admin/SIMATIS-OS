import {
  COULEURS,
  bouton,
  echapper as echapperMail,
  habillerMail,
  paragraphe,
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

// Mail d'invitation : le lien, le nom de l'entreprise et la date d'expiration, rien d'autre.
export function mailInvitation(p: {
  entrepriseNom: string;
  contactNom: string | null;
  lien: string;
  expireLe: Date;
}): { subject: string; html: string } {
  const bonjour = p.contactNom ? `Bonjour ${echapper(p.contactNom)},` : 'Bonjour,';
  const lien = echapper(p.lien);
  return {
    subject: `Votre test VMA : ${p.entrepriseNom}`,
    html: habillerMail(
      `<tr><td style="padding:26px 32px 4px;">${[
        paragraphe(bonjour),
        paragraphe(`Voici votre lien pour passer le test VMA de ${echapper(p.entrepriseNom)} :`),
        bouton('Passer le test VMA', p.lien),
        paragraphe(`Le lien expire le ${p.expireLe.toLocaleDateString('fr-FR')}.`),
        paragraphe(
          `Si le bouton ne s’ouvre pas, copiez ce lien : <a href="${lien}" style="color:${COULEURS.nuit};text-decoration:underline;">${lien}</a>`,
        ),
      ].join('')}</td></tr>`,
    ),
  };
}

// Envoie le mail d'invitation depuis la messagerie de l'instance. Jamais bloquant : l'invitation
// existe déjà, le résultat dit si le mail est parti, simulé, ou en échec (avec la raison).
export async function envoyerInvitation(
  db: Database,
  instance: Instance,
  ecriture: ConnexionDeps,
  test: Pick<TestVma, 'entrepriseNom' | 'contactNom' | 'contactEmail' | 'lien' | 'expireLe'>,
): Promise<EnvoiInvitation> {
  if (!test.contactEmail) return { statut: 'echec', raison: 'aucune adresse e-mail' };
  const message = mailInvitation({
    entrepriseNom: test.entrepriseNom,
    contactNom: test.contactNom,
    lien: test.lien,
    expireLe: test.expireLe,
  });
  return withInstance(db, instance.id, async (tx) => {
    try {
      const res = await tx.transaction((sp) =>
        writeVia(
          sp,
          instance,
          'messagerie',
          { op: 'message.send', data: { to: test.contactEmail, ...message } },
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
