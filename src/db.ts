import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Database = NodePgDatabase;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Tx;

export function createDb(url: string): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
  // Le serveur peut couper une connexion inactive (redémarrage, base supprimée) : le pool l'écarte et
  // en rouvre une à la demande. Sans écouteur, Node traite cet événement comme fatal et fait tomber
  // le processus (ou, en test, toute l'exécution alors que chaque test est passé).
  pool.on('error', () => undefined);
  return { db: drizzle(pool), pool };
}
