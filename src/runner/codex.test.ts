import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { tourCodex } from './runner.js';

it('signale un échec de lancement avec un résultat JSON explicite, sans exposer les données', async () => {
  let retour: unknown;
  const fetchFake = ((_url: string, init?: RequestInit) => {
    if (typeof init?.body === 'string') {
      retour = JSON.parse(init.body);
      return Promise.resolve(Response.json({ ok: true }));
    }
    return Promise.resolve(
      Response.json({
        travail: {
          id: '00000000-0000-4000-8000-000000000001',
          demande: { consigne: 'Test fictif', entree: '', schema: {} },
        },
      }),
    );
  }) as typeof fetch;
  await tourCodex(
    { base: 'http://os.test', token: 'fictif', claude: 'fictif', fetch: fetchFake },
    '/binaire-fictif-inexistant',
  );
  expect(retour).toEqual({ id: '00000000-0000-4000-8000-000000000001', ok: false, resultat: null });
});

it('fait la recherche avec Claude quand le moteur choisi est Claude, et rend sa sortie structurée', async () => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'faux-claude-'));
  try {
    const faux = path.join(dossier, 'claude');
    await writeFile(
      faux,
      '#!/bin/sh\ncat >/dev/null\necho \'{"is_error":false,"structured_output":{"contacts":[]}}\'\n',
      { mode: 0o755 },
    );
    let retour: unknown;
    const fetchFake = ((_url: string, init?: RequestInit) => {
      if (typeof init?.body === 'string') {
        retour = JSON.parse(init.body);
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.resolve(
        Response.json({
          moteur: 'claude',
          travail: {
            id: '00000000-0000-4000-8000-000000000002',
            demande: { consigne: 'Test fictif', entree: '', schema: { type: 'object' } },
          },
        }),
      );
    }) as typeof fetch;
    await tourCodex(
      { base: 'http://os.test', token: 'fictif', claude: faux, fetch: fetchFake },
      '/binaire-codex-qui-ne-doit-pas-servir',
    );
    expect(retour).toEqual({
      id: '00000000-0000-4000-8000-000000000002',
      ok: true,
      resultat: { contacts: [] },
    });
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});

it('signale un échec de Claude sans exposer sa sortie', async () => {
  let retour: unknown;
  const fetchFake = ((_url: string, init?: RequestInit) => {
    if (typeof init?.body === 'string') {
      retour = JSON.parse(init.body);
      return Promise.resolve(Response.json({ ok: true }));
    }
    return Promise.resolve(
      Response.json({
        moteur: 'claude',
        travail: {
          id: '00000000-0000-4000-8000-000000000003',
          demande: { consigne: 'Test fictif', entree: '', schema: {} },
        },
      }),
    );
  }) as typeof fetch;
  await tourCodex(
    { base: 'http://os.test', token: 'fictif', claude: '/claude-inexistant', fetch: fetchFake },
    '/binaire-codex-qui-ne-doit-pas-servir',
  );
  expect(retour).toEqual({ id: '00000000-0000-4000-8000-000000000003', ok: false, resultat: null });
});
