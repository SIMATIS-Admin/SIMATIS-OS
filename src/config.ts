import { z } from 'zod';

// An empty value in .env means unset.
const vide = (value: unknown) => (value === '' ? undefined : value);

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
  SITE_CONTACT_URL: z.preprocess(
    vide,
    z
      .string()
      .refine((value) => /^https?:\/\//.test(value), 'doit commencer par http:// ou https://')
      .optional(),
  ),
  SITE_CONTACT_TOKEN: z.preprocess(vide, z.string().min(32, '32 caractères au moins').optional()),
  // Test de VMA : création et révocation des invitations sur le site. Distinct du jeton de relève.
  VMA_OS_TOKEN: z.preprocess(vide, z.string().min(32, '32 caractères au moins').optional()),
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
  // Public website whose contact form feeds the Inbox; null when not configured.
  site: { url: string; token: string } | null;
  // Jeton des invitations du Test de VMA ; null tant qu'il n'est pas configuré.
  vmaOsToken: string | null;
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
  const siteUrl = e.SITE_CONTACT_URL;
  const siteToken = e.SITE_CONTACT_TOKEN;
  if (Boolean(siteUrl) !== Boolean(siteToken)) {
    throw new Error(
      'Configuration invalide — SITE_CONTACT_URL et SITE_CONTACT_TOKEN vont ensemble',
    );
  }
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
    site: siteUrl && siteToken ? { url: siteUrl, token: siteToken } : null,
    vmaOsToken: e.VMA_OS_TOKEN ?? null,
  };
}
