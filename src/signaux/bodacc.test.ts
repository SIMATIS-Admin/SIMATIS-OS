import { describe, expect, it, vi } from 'vitest';
import { classer, creerClientBodacc, type AnnonceBrute } from './bodacc.js';

const annonce = (extra: Partial<AnnonceBrute>): AnnonceBrute => ({
  id: 'A202601000001',
  dateparution: '2026-10-05',
  typeavis_lib: 'Avis initial',
  familleavis_lib: 'Procédures collectives',
  tribunal: 'Greffe du Tribunal des Activités Economiques de Lyon',
  url_complete: 'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A202601000001',
  jugement: null,
  acte: null,
  modificationsgenerales: null,
  radiationaurcs: null,
  ...extra,
});

describe('classement des annonces du BODACC', () => {
  it('une procédure collective est une alerte, avec la nature du jugement', () => {
    const s = classer(
      annonce({
        jugement: JSON.stringify({
          nature: 'Jugement d’ouverture de liquidation judiciaire',
          date: '2026-10-01',
          complementJugement: 'Liquidation judiciaire avec poursuite d’activité.',
        }),
      }),
    );
    expect(s).toMatchObject({
      sourceId: 'A202601000001',
      date: '2026-10-05',
      famille: 'Procédure collective',
      nature: 'Jugement d’ouverture de liquidation judiciaire',
      gravite: 'alerte',
      detail: 'Liquidation judiciaire avec poursuite d’activité.',
      url: 'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A202601000001',
    });
  });

  it('une conciliation, un rétablissement professionnel et une radiation sont des alertes', () => {
    expect(
      classer(
        annonce({
          familleavis_lib: 'Procédures de conciliation',
          jugement: '{"nature":"Jugement d’homologation de l’accord"}',
        }),
      ),
    ).toMatchObject({ famille: 'Conciliation', gravite: 'alerte' });
    expect(
      classer(annonce({ familleavis_lib: 'Procédures de rétablissement professionnel' })),
    ).toMatchObject({ famille: 'Rétablissement professionnel', gravite: 'alerte' });
    expect(
      classer(
        annonce({ familleavis_lib: 'Radiations', radiationaurcs: '{"commentaire":"Radiation"}' }),
      ),
    ).toMatchObject({ famille: 'Radiation', gravite: 'alerte', nature: 'Radiation' });
  });

  it('une vente ou cession de fonds est un point d’attention', () => {
    const s = classer(
      annonce({
        familleavis_lib: 'Ventes et cessions',
        acte: JSON.stringify({
          descriptif: 'Acte en date du 29/10/2026',
          vente: { categorieVente: 'Achat d’un fonds par une personne morale' },
        }),
      }),
    );
    expect(s).toMatchObject({
      famille: 'Vente ou cession',
      nature: 'Achat d’un fonds par une personne morale',
      gravite: 'attention',
    });
  });

  it('une modification, une création ou une immatriculation sont de simples informations', () => {
    expect(
      classer(
        annonce({
          familleavis_lib: 'Modifications diverses',
          modificationsgenerales: '{"descriptif":"Modification survenue sur l’administration."}',
        }),
      ),
    ).toMatchObject({
      famille: 'Modification',
      gravite: 'info',
      nature: 'Modification survenue sur l’administration.',
    });
    expect(classer(annonce({ familleavis_lib: 'Créations' }))).toMatchObject({
      famille: 'Création',
      gravite: 'info',
    });
    expect(classer(annonce({ familleavis_lib: 'Immatriculations' }))).toMatchObject({
      famille: 'Immatriculation',
      gravite: 'info',
    });
  });

  it('ignore les dépôts de comptes, les annulations et les familles inconnues', () => {
    expect(classer(annonce({ familleavis_lib: 'Dépôts des comptes' }))).toBeNull();
    expect(classer(annonce({ typeavis_lib: 'Avis d’annulation' }))).toBeNull();
    expect(classer(annonce({ familleavis_lib: 'Annonces diverses' }))).toBeNull();
    expect(classer(annonce({ familleavis_lib: null }))).toBeNull();
  });

  it('supporte un contenu illisible ou trop long sans planter', () => {
    const s = classer(annonce({ jugement: 'pas du json' }));
    expect(s).toMatchObject({ famille: 'Procédure collective', nature: 'Procédure collective' });
    const long = classer(
      annonce({ jugement: JSON.stringify({ nature: 'N', complementJugement: 'x'.repeat(2000) }) }),
    );
    expect(long?.detail?.length).toBeLessThanOrEqual(500);
  });
});

describe('client du BODACC', () => {
  const reponse = (corps: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(corps), { status }));

  it('interroge les annonces d’un SIREN depuis une date, sans les dépôts de comptes', async () => {
    const fetchFn = vi.fn<(url: string) => Promise<Response>>(() =>
      reponse({ results: [annonce({}), annonce({ id: 'A2', familleavis_lib: 'Radiations' })] }),
    );
    const client = creerClientBodacc({ fetchFn, attendre: () => Promise.resolve() });
    const r = await client.annonces('123456789', '2024-11-01');
    expect(r.map((a) => a.id)).toEqual(['A202601000001', 'A2']);
    const url = new URL(fetchFn.mock.calls[0]?.[0] ?? '');
    expect(url.origin).toBe('https://bodacc-datadila.opendatasoft.com');
    const where = url.searchParams.get('where') ?? '';
    expect(where).toContain('registre="123456789"');
    expect(where).toContain("dateparution>=date'2024-11-01'");
    expect(where).toContain('familleavis_lib!="Dépôts des comptes"');
    expect(url.searchParams.get('order_by')).toBe('dateparution desc');
  });

  it('refuse un SIREN invalide et signale un service en panne ou une réponse illisible', async () => {
    const client = creerClientBodacc({
      fetchFn: () => reponse({ results: [] }),
      attendre: () => Promise.resolve(),
    });
    await expect(client.annonces('12', '2024-01-01')).rejects.toThrow(/SIREN/);
    const hs = creerClientBodacc({
      fetchFn: () => reponse({}, 503),
      attendre: () => Promise.resolve(),
    });
    await expect(hs.annonces('123456789', '2024-01-01')).rejects.toThrow(/indisponible/);
    const illisible = creerClientBodacc({
      fetchFn: () => reponse({ results: [{ id: 3 }] }),
      attendre: () => Promise.resolve(),
    });
    await expect(illisible.annonces('123456789', '2024-01-01')).rejects.toThrow(/illisible/);
  });
});
