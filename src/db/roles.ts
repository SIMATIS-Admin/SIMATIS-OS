import type pg from 'pg';

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

// NOLOGIN role the app switches to (SET LOCAL ROLE) for requete_lecture: it can only read the
// instance-filtered v_* views.
export const lectureRoleOf = (role: string) => `${role}_lecture`;

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

    // v_* views run with the owner's rights: writing through them would bypass Row-Level Security.
    const lecture = lectureRoleOf(role);
    const { rows: lectureRows } = await client.query<{ exists: boolean }>(
      'select exists (select 1 from pg_roles where rolname = $1) as exists',
      [lecture],
    );
    if (!lectureRows[0]?.exists) await client.query(`CREATE ROLE ${lecture} NOLOGIN`);
    await client.query(`GRANT ${lecture} TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${lecture}`);
    const { rows: views } = await client.query<{ name: string }>(
      "select table_name as name from information_schema.views where table_schema = 'public' and table_name like 'v\\_%'",
    );
    for (const { name } of views) {
      const view = client.escapeIdentifier(name);
      await client.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${view} FROM ${role}`);
      await client.query(`GRANT SELECT ON ${view} TO ${lecture}`);
    }
  } finally {
    client.release();
  }
}
