import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import type { AppelerPartage } from './partage.js';

export type ConfigPartage = { command: string; args: string[]; env: Record<string, string> };

// Le serveur MCP « partage » est déjà installé pour Claude Code sur ce poste, avec le jeton kDrive
// dans son environnement : l'OS le relance à l'identique plutôt que de redemander le jeton. Le jeton
// reste dans le processus du runner, jamais dans la base ni le dépôt.
export async function configPartage(
  fichier = path.join(homedir(), '.claude.json'),
): Promise<ConfigPartage | null> {
  try {
    const brut = JSON.parse(await readFile(fichier, 'utf8')) as {
      mcpServers?: Record<string, Partial<ConfigPartage> | undefined>;
    };
    const s = brut.mcpServers?.partage;
    if (!s?.command) return null;
    return { command: s.command, args: s.args ?? [], env: s.env ?? {} };
  } catch {
    return null;
  }
}

export const auteurDe = (config: ConfigPartage) =>
  (config.env.PARTAGE_AUTHOR ?? '').trim().toLowerCase();

// Une connexion réutilisée tant qu'elle tient ; relancée si le processus s'est arrêté.
export function connecterPartage(config: ConfigPartage) {
  let client: Promise<Client> | null = null;
  const ouvrir = () => {
    const c = new Client({ name: 'simatis-os', version: '1.0.0' });
    return c
      .connect(
        new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: { ...getDefaultEnvironment(), ...config.env },
          stderr: 'ignore',
        }),
      )
      .then(() => c);
  };

  const appeler: AppelerPartage = async (outil, args) => {
    client ??= ouvrir();
    let c: Client;
    try {
      c = await client;
    } catch (e) {
      client = null;
      throw e;
    }
    let res;
    try {
      res = await c.callTool({ name: outil, arguments: args });
    } catch (e) {
      client = null;
      void c.close().catch(() => undefined);
      throw e;
    }
    const texte = ((res.content as { type: string; text?: string }[] | undefined) ?? [])
      .map((p) => p.text ?? '')
      .join('\n');
    if (res.isError) throw new Error(texte.replace(/^échec : /, ''));
    return texte;
  };

  return {
    appeler,
    auteur: auteurDe(config),
    fermer: async () => {
      const c = await client?.catch(() => null);
      client = null;
      await c?.close().catch(() => undefined);
    },
  };
}
