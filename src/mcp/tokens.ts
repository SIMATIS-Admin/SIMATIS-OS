import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { instances, type Instance } from '../instances/schema.js';
import { jetons, type Jeton } from './schema.js';

export type Portee = Jeton['portee'];

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Returns the clear token once; only its hash is kept.
export async function createToken(
  db: Executor,
  {
    nom,
    portee,
    instanceSlug,
    instanceId: givenInstanceId,
    expiresAt,
  }: {
    nom: string;
    portee: Portee;
    instanceSlug?: string;
    instanceId?: string;
    expiresAt?: Date;
  },
): Promise<{ id: string; token: string }> {
  let instanceId: string | null = givenInstanceId ?? null;
  if (portee === 'instance' && !instanceId) {
    if (!instanceSlug)
      throw new Error('Un jeton d’instance doit nommer son instance (--instance).');
    const [instance] = await db
      .select({ id: instances.id })
      .from(instances)
      .where(and(eq(instances.slug, instanceSlug), eq(instances.statut, 'actif')));
    if (!instance) throw new Error(`Instance inconnue ou archivée : ${instanceSlug}`);
    instanceId = instance.id;
  }
  const token = `smt_${randomBytes(32).toString('base64url')}`;
  const [row] = await db
    .insert(jetons)
    .values({ nom, portee, instanceId, hash: hashToken(token), expiresAt: expiresAt ?? null })
    .returning({ id: jetons.id });
  if (!row) throw new Error('Jeton non créé');
  return { id: row.id, token };
}

export type ResolvedToken = { jeton: Jeton; instance: Instance | null };

// Null for an unknown, revoked or expired token, or one whose instance is archived.
export async function resolveToken(db: Executor, token: string): Promise<ResolvedToken | null> {
  const [jeton] = await db
    .select()
    .from(jetons)
    .where(
      and(
        eq(jetons.hash, hashToken(token)),
        isNull(jetons.revokedAt),
        or(isNull(jetons.expiresAt), gt(jetons.expiresAt, new Date())),
      ),
    );
  if (!jeton) return null;
  if (jeton.instanceId === null) return { jeton, instance: null };
  const [instance] = await db
    .select()
    .from(instances)
    .where(and(eq(instances.id, jeton.instanceId), eq(instances.statut, 'actif')));
  return instance ? { jeton, instance } : null;
}

export async function revokeToken(db: Executor, id: string): Promise<boolean> {
  const rows = await db
    .update(jetons)
    .set({ revokedAt: new Date() })
    .where(and(eq(jetons.id, id), isNull(jetons.revokedAt)))
    .returning({ id: jetons.id });
  return rows.length > 0;
}

export async function listTokens(db: Executor) {
  return db
    .select({
      id: jetons.id,
      nom: jetons.nom,
      portee: jetons.portee,
      instance: instances.slug,
      createdAt: jetons.createdAt,
      revokedAt: jetons.revokedAt,
    })
    .from(jetons)
    .leftJoin(instances, eq(instances.id, jetons.instanceId))
    .orderBy(jetons.createdAt);
}
