import type pg from 'pg';

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function appDatabaseUrl(ownerUrl: string, role: string, password: string): string {
  const url = new URL(ownerUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

// Runtime role: owns nothing and cannot bypass Row-Level Security. Replayed at every start so
// tables added by later migrations are granted too.
export async function ensureAppRole(
  ownerPool: pg.Pool,
  { role, password }: { role: string; password: string },
): Promise<void> {
  if (!ROLE_NAME.test(role)) throw new Error(`Nom de rôle invalide : ${role}`);
  const client = await ownerPool.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      'select exists (select 1 from pg_roles where rolname = $1) as exists',
      [role],
    );
    const options = `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${client.escapeLiteral(password)}`;
    await client.query(
      rows[0]?.exists ? `ALTER ROLE ${role} ${options}` : `CREATE ROLE ${role} ${options}`,
    );

    const { rows: dbRows } = await client.query<{ name: string }>(
      'select current_database() as name',
    );
    const database = client.escapeIdentifier(dbRows[0]?.name ?? '');
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);

    const { rows: journal } = await client.query<{ exists: boolean }>(
      "select to_regclass('public.journal') is not null as exists",
    );
    if (journal[0]?.exists) {
      await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE journal FROM ${role}`);
    }
  } finally {
    client.release();
  }
}
