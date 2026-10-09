import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z
    .string({ error: 'obligatoire' })
    .refine(
      (value) => URL.canParse(value),
      'URL invalide (caractère spécial dans le mot de passe ?)',
    )
    .refine(
      (value) => /^postgres(ql)?:\/\//.test(value),
      'doit commencer par postgres:// ou postgresql://',
    ),
  APP_DB_PASSWORD: z.string({ error: 'obligatoire' }).min(1, 'obligatoire'),
  APP_DB_ROLE: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/, 'lettres minuscules, chiffres et _ uniquement')
    .default('simatis_app'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SECRETS_DIR: z.string().min(1).default('./secrets/instances'),
  REAL_WRITES: z.enum(['off', 'on']).default('off'),
  BACKUP_STATUS_FILE: z.string().min(1).default('./backup-status/last.json'),
  // Default Google OAuth client, used by instances that have none of their own.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type Config = {
  databaseUrl: string;
  appDbRole: string;
  appDbPassword: string;
  host: string;
  port: number;
  logLevel: z.infer<typeof schema>['LOG_LEVEL'];
  secretsDir: string;
  realWrites: boolean;
  backupStatusFile: string;
  googleClient?: { clientId: string; clientSecret: string };
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')} : ${issue.message}`)
      .join(' ; ');
    throw new Error(`Configuration invalide — ${details}`);
  }
  const e = result.data;
  return {
    databaseUrl: e.DATABASE_URL,
    appDbRole: e.APP_DB_ROLE,
    appDbPassword: e.APP_DB_PASSWORD,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    secretsDir: e.SECRETS_DIR,
    realWrites: e.REAL_WRITES === 'on',
    backupStatusFile: e.BACKUP_STATUS_FILE,
    ...(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
      ? { googleClient: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET } }
      : {}),
  };
}
