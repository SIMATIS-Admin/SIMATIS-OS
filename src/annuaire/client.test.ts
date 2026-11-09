import { describe, expect, it, vi } from 'vitest';
import { creerClientAnnuaire, libelleEffectif } from './client.js';

// Réponse fictive, au format de l'API publique recherche-entreprises.api.gouv.fr.
const resultat = {
  siren: '123456789',
  nom_complet: 'ATELIER FICTIF',
  nature_juridique: '5710',
  activite_principale: '25.62B',
  categorie_entreprise: 'PME',
  tranche_effectif_salarie: '12',
  date_creation: '1996-03-01',
  etat_administratif: 'A',
  nombre_etablissements_ouverts: 2,
  opposition_diffusion_commerciale: true,
  siege: {
    siret: '12345678900011',
    adresse: '30 RUE DES TESTS 69680 CHASSIEU',
    code_postal: '69680',
    libelle_commune: 'CHASSIEU',
    departement: '69',
    latitude: '45.7285',
    longitude: '4.9745',
  },
  finances: {
    '2021': { ca: 400000, resultat_net: 5000 },
    '2022': { ca: 425165, resultat_net: 9666 },
  },
  dirigeants: [
    {
      type_dirigeant: 'personne physique',
      nom: 'DUPONT',
      prenoms: 'Jeanne, Marie',
      qualite: 'Président',
      date_de_naissance: '1970-05',
      annee_de_naissance: '1970',
      nationalite: 'Française',
    },
    {
      type_dirigeant: 'personne morale',
      denomination: 'HOLDING FICTIVE',
      siren: '987654321',
      qualite: 'Directeur général',
    },
    {
      type_dirigeant: 'personne morale',
      denomination: 'HOLDING FICTIVE',
      siren: '987654321',
      qualite: 'Directeur général',
    },
    {
      type_dirigeant: 'personne morale',
      denomination: 'CABINET AUDIT FICTIF',
      qualite: 'Commissaire aux comptes titulaire',
    },
  ],
};

const reponse = (corps: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(corps), { status }));
const sansAttente = () => Promise.resolve();

describe('client de l’annuaire des entreprises', () => {
  it('ne garde que ce que la base utilise, sans donnée personnelle superflue ni commissaire aux comptes ni doublon', async () => {
    const fetchFn = vi.fn(() => reponse({ results: [resultat], total_results: 1 }));
    const client = creerClientAnnuaire({ fetchFn, attendre: sansAttente });
    const [e] = await client.chercher('atelier fictif');
    expect(e).toEqual({
      siren: '123456789',
      nom: 'ATELIER FICTIF',
      formeJuridique: '5710',
      naf: '25.62B',
      categorie: 'PME',
      effectif: '20 à 49 salariés',
      creeLe: '1996-03-01',
      active: true,
      etablissementsOuverts: 2,
      oppositionDiffusion: true,
      siret: '12345678900011',
      adresse: '30 RUE DES TESTS 69680 CHASSIEU',
      codePostal: '69680',
      ville: 'CHASSIEU',
      departement: '69',
      latitude: 45.7285,
      longitude: 4.9745,
      finances: [
        { annee: 2022, ca: 425165, resultat: 9666 },
        { annee: 2021, ca: 400000, resultat: 5000 },
      ],
      dirigeants: [
        { nom: 'Jeanne Marie DUPONT', fonction: 'Président', societe: false },
        { nom: 'HOLDING FICTIVE', fonction: 'Directeur général', societe: true },
      ],
    });
    expect(JSON.stringify(e)).not.toMatch(/1970|Française|naissance/);
  });

  it('interroge l’API publique avec la recherche et un nombre limité de résultats', async () => {
    const fetchFn = vi.fn<(url: string) => Promise<Response>>(() => reponse({ results: [] }));
    const client = creerClientAnnuaire({ fetchFn, attendre: sansAttente });
    await client.chercher('Atelier & Fils', { departement: '69', limite: 3 });
    const url = new URL(fetchFn.mock.calls[0]?.[0] ?? '');
    expect(url.origin + url.pathname).toBe('https://recherche-entreprises.api.gouv.fr/search');
    expect(url.searchParams.get('q')).toBe('Atelier & Fils');
    expect(url.searchParams.get('departement')).toBe('69');
    expect(url.searchParams.get('per_page')).toBe('3');
  });

  it('retrouve une entreprise par son SIREN, et rend null si elle est inconnue', async () => {
    const client = creerClientAnnuaire({
      fetchFn: vi.fn((url: string) =>
        reponse({ results: url.includes('q=123456789') ? [resultat] : [] }),
      ),
      attendre: sansAttente,
    });
    expect((await client.parSiren('123 456 789'))?.nom).toBe('ATELIER FICTIF');
    expect(await client.parSiren('999999999')).toBeNull();
    await expect(client.parSiren('12')).rejects.toThrow(/SIREN/);
  });

  it('réessaie une fois après un refus de débit (429), puis abandonne', async () => {
    const attendre = vi.fn(sansAttente);
    const unSeulRefus = vi
      .fn()
      .mockImplementationOnce(() => reponse({}, 429))
      .mockImplementation(() => reponse({ results: [resultat] }));
    const client = creerClientAnnuaire({ fetchFn: unSeulRefus, attendre });
    expect(await client.chercher('x')).toHaveLength(1);
    expect(unSeulRefus).toHaveBeenCalledTimes(2);

    const toujoursRefuse = vi.fn(() => reponse({}, 429));
    const bloque = creerClientAnnuaire({ fetchFn: toujoursRefuse, attendre });
    await expect(bloque.chercher('x')).rejects.toThrow(/débit/);
    expect(toujoursRefuse).toHaveBeenCalledTimes(2);
  });

  it('signale un service indisponible ou une réponse illisible', async () => {
    const hs = creerClientAnnuaire({ fetchFn: () => reponse({}, 503), attendre: sansAttente });
    await expect(hs.chercher('x')).rejects.toThrow(/indisponible/);
    const illisible = creerClientAnnuaire({
      fetchFn: () => reponse({ results: [{ siren: 12 }] }),
      attendre: sansAttente,
    });
    await expect(illisible.chercher('x')).rejects.toThrow(/illisible/);
  });

  it('espace les appels pour rester sous la limite de l’API', async () => {
    const attendre = vi.fn<(ms: number) => Promise<void>>(sansAttente);
    const client = creerClientAnnuaire({
      fetchFn: () => reponse({ results: [] }),
      attendre,
      intervalleMs: 250,
    });
    await client.chercher('a');
    await client.chercher('b');
    expect(attendre).toHaveBeenCalledWith(expect.any(Number));
    expect(attendre.mock.calls.every(([ms]) => ms <= 250)).toBe(true);
  });

  it('traduit les codes d’effectif de l’INSEE', () => {
    expect(libelleEffectif('NN')).toBe('Sans salarié');
    expect(libelleEffectif('03')).toBe('6 à 9 salariés');
    expect(libelleEffectif('53')).toBe('10 000 salariés et plus');
    expect(libelleEffectif(null)).toBeNull();
    expect(libelleEffectif('99')).toBeNull();
  });
});
