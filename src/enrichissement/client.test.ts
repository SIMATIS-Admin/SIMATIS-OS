import { describe, expect, it } from 'vitest';
import { creerClientOpenAI, ErreurIA } from './client.js';

const CLE = 'cle-fictive-123';
const demande = { consigne: 'Consigne.', entree: 'Atelier Fictif', schema: { type: 'object' } };

const reponse = (corps: unknown, status = 200) =>
  Promise.resolve(
    new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), { status }),
  );

describe('client OpenAI', () => {
  it('envoie la demande avec recherche web et sortie JSON stricte, et renvoie JSON et jetons', async () => {
    let appel: { url: string; init: RequestInit } | undefined;
    const client = creerClientOpenAI({ cle: CLE, modele: 'modele-fictif' }, (url, init) => {
      appel = { url, init };
      return reponse({
        output: [
          { type: 'web_search_call' },
          { type: 'message', content: [{ type: 'output_text', text: '{"contacts":[]}' }] },
        ],
        usage: { input_tokens: 120, output_tokens: 30 },
      });
    });
    expect(await client.demander(demande)).toEqual({ json: { contacts: [] }, jetons: 150 });
    expect(appel?.url).toBe('https://api.openai.com/v1/responses');
    expect((appel?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CLE}`);
    const corps = JSON.parse(appel?.init.body as string) as {
      model: string;
      tools: unknown;
      text: { format: unknown };
      instructions: string;
      input: string;
    };
    expect(corps.model).toBe('modele-fictif');
    expect(corps.tools).toEqual([{ type: 'web_search' }]);
    expect(corps.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(corps.instructions).toBe('Consigne.');
    expect(corps.input).toBe('Atelier Fictif');
  });

  it.each([401, 429])('un HTTP %i arrête tout le lot, sans afficher la clé', async (status) => {
    const client = creerClientOpenAI({ cle: CLE, modele: 'm' }, () =>
      reponse({ error: { message: `refus pour ${CLE}` } }, status),
    );
    const erreur = await client.demander(demande).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurIA);
    expect((erreur as ErreurIA).fatale).toBe(true);
    expect((erreur as ErreurIA).message).not.toContain(CLE);
  });

  it('un HTTP 500 ou un corps illisible ne concerne que la fiche en cours', async () => {
    const c500 = creerClientOpenAI({ cle: CLE, modele: 'm' }, () => reponse('panne', 500), 0);
    expect(await c500.demander(demande).catch((e: unknown) => e)).toMatchObject({ fatale: false });
    const illisible = creerClientOpenAI({ cle: CLE, modele: 'm' }, () => reponse('pas du json'));
    expect(await illisible.demander(demande).catch((e: unknown) => e)).toMatchObject({
      fatale: false,
    });
    const sansTexte = creerClientOpenAI({ cle: CLE, modele: 'm' }, () =>
      reponse({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'non' }] }] }),
    );
    expect(await sansTexte.demander(demande).catch((e: unknown) => e)).toMatchObject({
      fatale: false,
    });
  });

  it('retente une fois après un 5xx', async () => {
    let n = 0;
    const client = creerClientOpenAI(
      { cle: CLE, modele: 'm' },
      () => {
        n++;
        return n === 1
          ? reponse('panne', 503)
          : reponse({
              output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }],
              usage: { input_tokens: 1, output_tokens: 1 },
            });
      },
      0,
    );
    expect((await client.demander(demande)).json).toEqual({ a: 1 });
    expect(n).toBe(2);
  });
});
