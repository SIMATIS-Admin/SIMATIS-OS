import { expect, it } from 'vitest';
import { chercherProspects } from './recherche.js';

it('conserve un contact sourcé par un lien Markdown et rejette une source invalide', async () => {
  const contact = {
    entreprise: 'Atelier fictif',
    prenom: 'Alice',
    nom: 'Exemple',
    fonction: 'Direction',
    email: 'alice@atelier.example',
    linkedin: null,
    qualification: 'Données fictives',
  };
  const contacts = await chercherProspects(
    {
      demander: () =>
        Promise.resolve({
          json: {
            contacts: [
              {
                ...contact,
                source:
                  '[Source](https://atelier.example/equipe) ; [Autre](https://atelier.example/contact)',
              },
              { ...contact, nom: 'Invalide', source: 'sans source' },
            ],
          },
          jetons: 0,
        }),
    },
    'Test fictif',
    10,
  );
  expect(contacts).toHaveLength(1);
  expect(contacts[0]?.source).toBe('https://atelier.example/equipe');
});
