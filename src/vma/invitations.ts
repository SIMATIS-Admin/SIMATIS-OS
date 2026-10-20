import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { entreprises } from '../crm/schema.js';
import type { Database, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import { TYPES_TEST_VMA, vmaTests, type TestVma, type TypeTestVma } from './schema.js';

export type InvitationDeps = {
  // Adresse du site (ex. https://www.simatis.fr) et jeton des invitations (VMA_OS_TOKEN côté site).
  url: string;
  token: string;
  fetch?: typeof fetch;
};

export class InvitationImpossible extends Error {}

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
