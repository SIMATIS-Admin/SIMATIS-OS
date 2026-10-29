import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auteurDe, configPartage, connecterPartage } from './partage-mcp.js';

let dossier: string;
beforeEach(async () => {
  dossier = await mkdtemp(path.join(tmpdir(), 'partage-mcp-'));
});
afterEach(() => rm(dossier, { recursive: true, force: true }));

// Faux serveur « partage » : même protocole que le vrai (JSON-RPC ligne à ligne sur stdio).
const FAUX_SERVEUR = `
import { createInterface } from 'node:readline';
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') return reply(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'partage', version: '1' } });
  if (method === 'tools/list') return reply(id, { tools: [] });
  if (method === 'tools/call') {
    if (params.name === 'echec') return reply(id, { content: [{ type: 'text', text: 'échec : dossier refusé' }], isError: true });
    return reply(id, { content: [{ type: 'text', text: params.name + ':' + JSON.stringify(params.arguments) + ':' + process.env.PARTAGE_AUTHOR }] });
  }
  if (id !== undefined) reply(id, {});
});
`;

describe('configPartage', () => {
  it('lit le serveur « partage » de la configuration de Claude Code', async () => {
    const f = path.join(dossier, 'claude.json');
    await writeFile(
      f,
      JSON.stringify({
        mcpServers: {
          autre: { command: 'x' },
          partage: { command: 'node', args: ['a.mjs'], env: { PARTAGE_AUTHOR: ' Marc ' } },
        },
      }),
    );
    const c = await configPartage(f);
    expect(c).toEqual({ command: 'node', args: ['a.mjs'], env: { PARTAGE_AUTHOR: ' Marc ' } });
    expect(auteurDe(c!)).toBe('marc');
  });

  it('rend null sans fichier, sans serveur ou avec un fichier illisible', async () => {
    expect(await configPartage(path.join(dossier, 'absent.json'))).toBeNull();
    const f = path.join(dossier, 'vide.json');
    await writeFile(f, '{"mcpServers":{}}');
    expect(await configPartage(f)).toBeNull();
    await writeFile(f, 'pas du json');
    expect(await configPartage(f)).toBeNull();
  });
});

describe('connecterPartage', () => {
  it('appelle les outils du serveur avec son environnement et traduit ses échecs', async () => {
    const script = path.join(dossier, 'faux.mjs');
    await writeFile(script, FAUX_SERVEUR);
    const p = connecterPartage({
      command: process.execPath,
      args: [script],
      env: { PARTAGE_AUTHOR: 'marc' },
    });
    try {
      expect(p.auteur).toBe('marc');
      expect(await p.appeler('lire_partage', { chemin: 'a.md' })).toBe(
        'lire_partage:{"chemin":"a.md"}:marc',
      );
      expect(await p.appeler('lister_partage', {})).toBe('lister_partage:{}:marc');
      await expect(p.appeler('echec', {})).rejects.toThrow('dossier refusé');
    } finally {
      await p.fermer();
    }
  });
});
