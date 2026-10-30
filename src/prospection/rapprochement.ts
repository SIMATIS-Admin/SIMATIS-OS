import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { messagerieDe, type Messagerie } from '../connecteurs/messagerie.js';
import { connexions } from '../connexions/schema.js';
import type { ConnexionDeps } from '../connexions/service.js';
import { contacts } from '../crm/schema.js';
import type { Database, Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { loadInstanceSecrets } from '../secrets.js';
import { prospectionOccurrences } from './schema.js';

const JOURS_MAX = 21;
const CONTACTS_MAX = 40;

// Marc envoie lui-même ses brouillons depuis sa messagerie : l'OS le constate après coup. Un
// brouillon devient « envoyé » quand la messagerie montre un mail de Marc à ce contact, daté d'après
// la création du brouillon. C'est ce qui fait monter le compteur du jour.
export async function rapprocherEnvois(
  tx: Executor,
  boite: Messagerie,
  maintenant = new Date(),
): Promise<number> {
  const attente = await tx
    .select({
      id: prospectionOccurrences.id,
      creeLe: prospectionOccurrences.createdAt,
      email: contacts.email,
    })
    .from(prospectionOccurrences)
    .innerJoin(
      contacts,
      and(
        eq(contacts.id, prospectionOccurrences.contactId),
        eq(contacts.instanceId, currentInstance),
      ),
    )
    .where(
      and(
        eq(prospectionOccurrences.instanceId, currentInstance),
        eq(prospectionOccurrences.etat, 'brouillon'),
        isNotNull(contacts.email),
        gte(
          prospectionOccurrences.createdAt,
          new Date(maintenant.getTime() - JOURS_MAX * 86400_000),
        ),
      ),
    )
    .orderBy(desc(prospectionOccurrences.createdAt));
  if (attente.length === 0) return 0;

  let compte: string;
  try {
    compte = (await boite.compte()).toLowerCase();
  } catch {
    return 0;
  }
  if (!compte) return 0;

  const parEmail = new Map<string, typeof attente>();
  for (const o of attente) {
    const email = (o.email ?? '').toLowerCase();
    if (!parEmail.has(email) && parEmail.size >= CONTACTS_MAX) continue;
    parEmail.set(email, [...(parEmail.get(email) ?? []), o]);
  }

  let envoyes = 0;
  for (const [email, occurrences] of parEmail) {
    let messages;
    try {
      messages = await boite.historique(email, { mois: 1 });
    } catch {
      continue; // Un contact en échec n'arrête pas les autres.
    }
    const miens = messages
      .filter((m) => (m.de ?? '').toLowerCase().includes(compte))
      .map((m) => ({ date: m.date ? new Date(m.date) : null }))
      .filter((m): m is { date: Date } => m.date !== null && !Number.isNaN(m.date.getTime()));
    for (const o of occurrences) {
      // Un seul mail de Marc par occurrence : on prend le plus ancien parti depuis la création.
      const parti = miens
        .filter((m) => m.date.getTime() >= o.creeLe.getTime())
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
      if (!parti) continue;
      await tx
        .update(prospectionOccurrences)
        .set({ etat: 'envoye', envoyeAt: parti.date, updatedAt: new Date() })
        .where(eq(prospectionOccurrences.id, o.id));
      envoyes += 1;
    }
  }
  return envoyes;
}

// Version de l'écran : la messagerie réelle de l'instance. Sans messagerie branchée, rien à constater.
export async function rapprocherInstance(
  db: Database,
  instance: Instance,
  deps: ConnexionDeps,
): Promise<number> {
  return withInstance(db, instance.id, async (tx) => {
    const [c] = await tx
      .select({ fournisseur: connexions.fournisseur, etat: connexions.etat })
      .from(connexions)
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'messagerie')));
    if (!c || c.etat === 'non_configuree' || !['gmail', 'infomaniak'].includes(c.fournisseur))
      return 0;
    const secrets = await loadInstanceSecrets(deps.secretsDir, instance.slug);
    return rapprocherEnvois(tx, messagerieDe(c.fournisseur, { instance, secrets }));
  });
}
