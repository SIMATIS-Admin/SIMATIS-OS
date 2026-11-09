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
