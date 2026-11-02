import { describe, expect, it } from 'vitest';
import { analyserReponse, consigne, entree, ErreurAnalyse } from './analyse.js';

const contact = (extra: Record<string, unknown> = {}) => ({
  prenom: 'Claire',
  nom: 'Martin',
  fonction: 'Responsable achats',
  email: 'claire.martin@atelier-fictif.test',
  telephone: '04 50 12 34 56',
  sourceUrl: 'https://atelier-fictif.test/equipe',
  confiance: 'haute',
  modeEmail: 'trouve',
  ...extra,
});

describe('consigne et entrée', () => {
  it('reprend les fonctions saisies, sans décideur imposé', () => {
    const texte = consigne('contacts', ['Responsable achats', 'DRH'], 2);
    expect(texte).toContain('Responsable achats');
    expect(texte).toContain('DRH');
    expect(texte).toContain('2');
    expect(texte).not.toMatch(/dirigeant|décideur/i);
    expect(texte).toMatch(/URL/);
  });

  it('pour compléter, la consigne ne demande pas de nouvelles personnes', () => {
    expect(consigne('completer', [], 1)).toMatch(/déjà connu|même personne/i);
  });

  it('l’entrée donne l’entreprise, le domaine et le contact connu', () => {
    const t = entree({
      entreprise: 'Atelier Fictif',
      domaine: 'atelier-fictif.test',
      prenom: 'Claire',
      nom: 'Martin',
      fonction: null,
      email: null,
      telephone: null,
    });
    expect(t).toContain('Atelier Fictif');
    expect(t).toContain('atelier-fictif.test');
    expect(t).toContain('Claire Martin');
  });
});

describe('analyse de la réponse', () => {
  it('garde les contacts valides, tronqués au maximum demandé', () => {
    const r = analyserReponse(
      {
        contacts: [
          contact(),
          contact({ prenom: 'Paul', nom: 'Petit', email: null }),
          contact({ prenom: 'Zoé', nom: 'Roux' }),
        ],
      },
      2,
    );
    expect(r.map((c) => c.nom)).toEqual(['Martin', 'Petit']);
    expect(r[0]).toMatchObject({ email: 'claire.martin@atelier-fictif.test', modeEmail: 'trouve' });
  });

  it('une réponse sans contact est valide', () => {
    expect(analyserReponse({ contacts: [] }, 3)).toEqual([]);
  });

  it.each([null, 'texte', 42, {}, { contacts: 'x' }, { contacts: [{ nom: 3 }] }])(
    'rejette une réponse hors schéma (%j)',
    (json) => {
      expect(() => analyserReponse(json, 3)).toThrow(ErreurAnalyse);
    },
  );

  it('un mail ou un téléphone sans source https n’est jamais « trouvé »', () => {
    const [sansSource] = analyserReponse({ contacts: [contact({ sourceUrl: null })] }, 1);
    expect(sansSource).toMatchObject({ modeEmail: 'deduit', confiance: 'basse', telephone: null });
    const [http] = analyserReponse({ contacts: [contact({ sourceUrl: 'http://x.test' })] }, 1);
    expect(http).toMatchObject({ modeEmail: 'deduit', confiance: 'basse', telephone: null });
  });

  it('écarte un mail ou un téléphone invalide sans perdre la personne', () => {
    const [c] = analyserReponse({ contacts: [contact({ email: 'jean@', telephone: '12' })] }, 1);
    expect(c).toMatchObject({ nom: 'Martin', email: null, telephone: null, modeEmail: null });
    const [d] = analyserReponse({ contacts: [contact({ email: 'a b@x.test' })] }, 1);
    expect(d?.email).toBeNull();
  });

  it('normalise le téléphone au format international', () => {
    const [c] = analyserReponse({ contacts: [contact()] }, 1);
    expect(c?.telephone).toBe('+33450123456');
  });

  it('écarte un contact sans nom ni mail ni téléphone', () => {
    expect(
      analyserReponse(
        { contacts: [contact({ prenom: null, nom: null, email: null, telephone: null })] },
        3,
      ),
    ).toEqual([]);
  });

  it('une même personne (casse, accents) n’apparaît qu’une fois, la plus complète gardée', () => {
    const r = analyserReponse(
      {
        contacts: [
          contact({ prenom: 'Zoé', nom: 'Roux', email: null, telephone: null }),
          contact({ prenom: 'ZOE', nom: 'roux' }),
        ],
      },
      3,
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.email).toBe('claire.martin@atelier-fictif.test');
  });
});
