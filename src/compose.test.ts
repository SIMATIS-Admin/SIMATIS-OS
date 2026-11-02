import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// Une variable de .env que compose.yaml ne transmet pas n'arrive jamais au conteneur : l'app la
// croit absente sans qu'aucune erreur ne le dise.
describe('compose.yaml', () => {
  it('transmet au conteneur les variables du relais déclarées dans .env.example', async () => {
    const exemple = await readFile('.env.example', 'utf8');
    const compose = await readFile('compose.yaml', 'utf8');
    const variables = [...exemple.matchAll(/^(RELAIS_[A-Z_]+)=/gm)].map((m) => m[1]);
    expect(variables).toContain('RELAIS_CLE_INSCRIPTION');
    for (const v of variables) expect(compose, v).toContain(`${v}: \${${v}:-}`);
  });

  it('transmet au conteneur la clé OpenAI et les réglages de l’enrichissement', async () => {
    const exemple = await readFile('.env.example', 'utf8');
    const compose = await readFile('compose.yaml', 'utf8');
    const variables = [...exemple.matchAll(/^(OPENAI_API_KEY|ENRICHISSEMENT_[A-Z_]+)=/gm)].map(
      (m) => m[1],
    );
    expect(variables).toContain('OPENAI_API_KEY');
    expect(variables).toHaveLength(4);
    for (const v of variables) expect(compose, v).toContain(`${v}: \${${v}:-}`);
  });
});
