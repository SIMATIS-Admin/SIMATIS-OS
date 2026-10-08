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
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = {
  databaseUrl: string;
  host: string;
  port: number;
  logLevel: z.infer<typeof schema>['LOG_LEVEL'];
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')} : ${issue.message}`)
      .join(' ; ');
    throw new Error(`Configuration invalide — ${details}`);
  }
  const { DATABASE_URL, HOST, PORT, LOG_LEVEL } = result.data;
  return { databaseUrl: DATABASE_URL, host: HOST, port: PORT, logLevel: LOG_LEVEL };
}
