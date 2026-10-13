import { ImapFlow } from 'imapflow';
import { GenericContainer, Wait } from 'testcontainers';

export const BOITE = { user: 'marc@pilote.example', password: 'secret-fictif' };

export type TestImap = {
  serveur: { host: string; port: number; secure: false };
  // Drops a raw message in a folder, dated as given (IMAP searches on the arrival date).
  deposer: (dossier: string, brut: string, date: Date, flags?: string[]) => Promise<void>;
  lire: (dossier: string) => Promise<{ flags: string[]; source: string }[]>;
  stop: () => Promise<void>;
};

// A throwaway IMAP server holding one fictive mailbox, with the folders a real one has.
export async function startImap(): Promise<TestImap> {
  const container = await new GenericContainer('greenmail/standalone:2.1.3')
    .withEnvironment({
      GREENMAIL_OPTS: `-Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=marc:${BOITE.password}@pilote.example -Dgreenmail.users.login=email`,
    })
    .withExposedPorts(3143)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const serveur = {
    host: container.getHost(),
    port: container.getMappedPort(3143),
    secure: false as const,
  };
  const avec = async <T>(fn: (client: ImapFlow) => Promise<T>) => {
    const client = new ImapFlow({
      ...serveur,
      auth: { user: BOITE.user, pass: BOITE.password },
      logger: false,
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout();
    }
  };
  await avec(async (client) => {
    await client.mailboxCreate('Sent');
    await client.mailboxCreate('Drafts');
  });
  return {
    serveur,
    deposer: (dossier, brut, date, flags = []) =>
      avec(async (client) => {
        await client.append(dossier, brut.replace(/\r?\n/g, '\r\n'), flags, date);
      }),
    lire: (dossier) =>
      avec(async (client) => {
        const lock = await client.getMailboxLock(dossier);
        try {
          const lus = await client.fetchAll('1:*', { flags: true, source: true });
          return lus.map((m) => ({
            flags: [...(m.flags ?? [])],
            source: m.source?.toString('utf8') ?? '',
          }));
        } finally {
          lock.release();
        }
      }),
    stop: async () => {
      await container.stop();
    },
  };
}
