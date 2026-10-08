import type pg from 'pg';

export const MAX_LIGNES = 200;

export const VUES = {
  v_entreprises: 'id, nom, secteur, ville, taille, domaine, source, created_at, updated_at',
  v_contacts:
    'id, entreprise_id, nom, fonction, email, telephone, role, source, created_at, updated_at',
  v_propositions: 'id, type, contenu, auteur, statut, niveau, decide_par, decide_at, created_at',
  v_journal: 'id, at, acteur, action, niveau, details',
};

// Agent-written SQL, so every layer assumes it is hostile:
// - a single statement (no ";", and the extended protocol refuses several commands anyway);
// - a read-only transaction, with a timeout and a row cap;
// - SET LOCAL ROLE to a role that can only read the instance-filtered v_* views.
export async function runReadQuery(
  pool: pg.Pool,
  { instanceId, lectureRole, sql }: { instanceId: string; lectureRole: string; sql: string },
): Promise<Record<string, unknown>[]> {
  const text = sql.trim().replace(/;\s*$/, '');
  if (!text) throw new Error('Requête vide.');
  if (text.includes(';')) throw new Error('Une seule requête SELECT, sans « ; ».');

  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("select set_config('app.instance_id', $1, true)", [instanceId]);
    await client.query(`SET LOCAL ROLE ${client.escapeIdentifier(lectureRole)}`);
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query<Record<string, unknown>>({
      text: `select * from (${text}) as requete limit ${MAX_LIGNES}`,
      // Not yet in @types/pg: forces the extended protocol, which runs exactly one statement.
      queryMode: 'extended',
    } as pg.QueryConfig);
    return result.rows;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}
