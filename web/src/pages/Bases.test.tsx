// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EtatBase, ImportBase } from '../api.js';
import { Bases } from './Bases.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let etat: EtatBase;
let mandats: unknown[] = [];
let rapprochement: unknown = null;
let reponses: unknown[] = [];

const apercu: ImportBase = {
  id: '11111111-1111-4111-8111-111111111111',
  nomFichier: 'Texte collé',
  feuille: 'Texte collé',
  provenance: 'Sharp',
  mandat: null,
  statut: 'apercu',
  creeLe: '2026-10-22T08:00:00Z',
  entetes: ['Société', 'Nom', 'Mail', 'Code'],
  correspondance: { entreprise: 0, nom: 1, email: 2 },
  echantillon: [['Atelier Fictif', 'Durand', 'd@atelier-fictif.test', 'A1']],
  compteurs: {
    total: 3,
    prospectables: 1,
    aEnrichir: 1,
    sousMinimum: 1,
    doublonsInternes: 0,
    integrees: 0,
  },
  lignes: [
    {
      numero: 1,
      statut: 'pret',
      zone: 'prospectable',
      raison: null,
      avertissements: [],
      alertes: ['Contacté par Mandat A le 01/09/2026'],
      brut: [],
      fiche: {
        entreprise: 'Atelier Fictif',
        civilite: null,
        civiliteDeduite: false,
        prenom: null,
        nom: 'DURAND',
        email: 'd@atelier-fictif.test',
        telephone: null,
        fonction: null,
      },
    },
  ],
  rapport: null,
};

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (method === 'POST' && url.endsWith('/base/imports')) return json([apercu]);
  if (method === 'POST' && url.endsWith('/integrer'))
    return json({ creees: 2, fusionnees: 0, restantes: 1 });
  if (method === 'PUT') return json(apercu);
  if (url.endsWith('/base/mandats')) return json(mandats);
  if (url.endsWith('/base/rapprochement-mail'))
    return method === 'POST' ? json(rapprochement, 202) : json(rapprochement);
  if (url.endsWith('/base/reponses')) return json({ aValider: reponses, aClasser: 2 });
  if (url.includes('/base/reponses/') && method === 'POST') return json({ ok: true });
  if (url.endsWith('/base/crm/repondants'))
    return json({ cree: 2, existant: 0, simulation: 0, refuse: 1 });
  if (method === 'PUT' && url.includes('/base/mandats/')) return json({ ok: true });
  if (method === 'PATCH') return json({ ok: true });
  if (url.endsWith('/historique/actualiser')) return json({ verifiees: 1, trouvees: 0 });
  if (url.includes('/base/imports/'))
    return json({ ...apercu, compteurs: { ...apercu.compteurs, sousMinimum: 0 } });
  return json(etat);
}

describe('écran Bases vivantes', () => {
  beforeEach(() => {
    calls = [];
    etat = {
      fiches: [],
      total: 0,
      compteurs: { aEnrichir: 0, prospectable: 0 },
      provenances: [],
      imports: [],
    };
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('invite à importer une première liste quand la base est vide', async () => {
    render(<Bases slug="simatis" />);
    expect(await screen.findByText(/La base est vide/)).toBeTruthy();
  });

  it('exige la source de la liste avant de lire', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText(/La base est vide/);
    fireEvent.click(screen.getByText('Lire la liste'));
    expect(await screen.findByText(/Indiquez la source/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('lit du texte collé, montre l’aperçu, puis intègre après validation', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText(/La base est vide/);
    fireEvent.change(screen.getByPlaceholderText('Sharp, LinkedIn, salon…'), {
      target: { value: 'Sharp' },
    });
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'Société\tNom\nAtelier Fictif\tDurand' },
    });
    fireEvent.click(screen.getByText('Lire la liste'));

    expect(await screen.findByText('1 prospectables')).toBeTruthy();
    expect(screen.getByText('Contacté par Mandat A le 01/09/2026')).toBeTruthy();
    expect(screen.getByText('1 sous le minimum')).toBeTruthy();
    const envoi = calls.find((c) => c.method === 'POST');
    expect(envoi?.body).toMatchObject({ provenance: 'Sharp' });
    expect((envoi?.body as { texte: string }).texte).toContain('Atelier Fictif');
    expect(calls.some((c) => c.url.endsWith('/integrer'))).toBe(false);

    fireEvent.click(screen.getByText('Intégrer 2 fiches à la base'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/integrer'))).toBe(true));
  });

  it('corrige le contenu d’une colonne', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText(/La base est vide/);
    fireEvent.change(screen.getByPlaceholderText('Sharp, LinkedIn, salon…'), {
      target: { value: 'Sharp' },
    });
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByText('Lire la liste'));
    const colonne = await screen.findByLabelText('Contenu de la colonne Code');
    fireEvent.change(colonne, { target: { value: 'fonction' } });
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put?.body).toEqual({
        correspondance: { entreprise: 0, nom: 1, email: 2, fonction: 3 },
      });
    });
  });
});

describe('base vivante : filtres, export, conformité', () => {
  const fiche = {
    id: '22222222-2222-4222-8222-222222222222',
    zone: 'prospectable' as const,
    entreprise: 'Atelier Fictif',
    civilite: null,
    prenom: 'Léa',
    nom: 'MARTIN',
    email: 'lea@atelier-fictif.test',
    telephone: null,
    fonction: null,
    provenance: 'Sharp',
    mandat: null,
    statutProspection: 'contacte' as const,
    dernierContactLe: '2026-09-15T10:00:00Z',
    dernierContactCanal: 'email',
    resultat: null,
    nbContacts: 2,
    mandatContacteur: 'Mandat A',
    opposition: false,
    exclusion: null,
    emailInvalide: false,
    crmMandat: null,
    alertes: [
      {
        code: 'recontact',
        libelle: 'Contacté le 15/09/2026 : recontact déconseillé',
        bloquante: false,
      },
    ],
  };

  beforeEach(() => {
    calls = [];
    mandats = [];
    rapprochement = null;
    reponses = [];
    etat = {
      fiches: [fiche],
      total: 1,
      compteurs: { aEnrichir: 0, prospectable: 1 },
      provenances: ['Sharp'],
      imports: [],
    };
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('montre le dernier contact et les alertes de chaque fiche', async () => {
    render(<Bases slug="simatis" />);
    expect(await screen.findByText('Atelier Fictif')).toBeTruthy();
    expect(screen.getByText('Contacté')).toBeTruthy();
    expect(screen.getByText(/Contacté le 15\/09\/2026/)).toBeTruthy();
    expect(screen.getByText(/2 contacts · Mandat A/)).toBeTruthy();
  });

  it('envoie les filtres au serveur et propose l’export avec les mêmes filtres', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText('Atelier Fictif');
    fireEvent.change(screen.getByLabelText('Filtrer par statut'), {
      target: { value: 'jamais_contacte' },
    });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/base?statut=jamais_contacte'))).toBe(true),
    );
    const lien = screen.getByText<HTMLAnchorElement>('Exporter en CSV');
    expect(lien.getAttribute('href')).toBe('/api/i/simatis/base/export.csv?statut=jamais_contacte');
  });

  it('marque une opposition', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText('Atelier Fictif');
    fireEvent.change(screen.getByLabelText('Conformité de Léa MARTIN'), {
      target: { value: 'opposition' },
    });
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch?.url).toBe('/api/i/simatis/base/fiches/22222222-2222-4222-8222-222222222222');
      expect(patch?.body).toEqual({ opposition: true, exclusion: null });
    });
  });

  it('actualise l’historique depuis les CRM', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText('Atelier Fictif');
    fireEvent.click(screen.getByText("Actualiser l'historique"));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/base/historique/actualiser'))).toBe(true),
    );
  });
});

describe('base vivante : boîte mail et réponses', () => {
  beforeEach(() => {
    calls = [];
    mandats = [{ slug: 'mandat-a', nom: 'Mandat A', debutMandat: '2026-09-01' }];
    rapprochement = null;
    reponses = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        entreprise: 'Atelier Fictif',
        contact: 'Léa MARTIN',
        mandat: 'Mandat A',
        recuLe: '2026-09-12T09:00:00Z',
        objet: 'Re: Proposition',
        extrait: 'Merci, merci de ne plus me contacter.',
        classe: 'ne_plus_contacter',
      },
    ];
    etat = {
      fiches: [],
      total: 0,
      compteurs: { aEnrichir: 0, prospectable: 0 },
      provenances: [],
      imports: [],
    };
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lance la lecture de la boîte d’un mandat et suit son avancement', async () => {
    render(<Bases slug="simatis" />);
    const bouton = await screen.findByText('Lire la boîte mail');
    rapprochement = {
      etat: 'en_cours',
      mandat: 'Mandat A',
      depuis: '2026-09-01',
      lus: 40,
      total: 200,
    };
    fireEvent.click(bouton);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/rapprochement-mail'))).toBe(
        true,
      ),
    );
    expect(
      calls.find((c) => c.method === 'POST' && c.url.endsWith('/rapprochement-mail'))?.body,
    ).toEqual({
      mandat: 'mandat-a',
    });
    expect(await screen.findByText(/40 messages lus sur 200/)).toBeTruthy();
  });

  it('montre le rapport d’un rapprochement terminé', async () => {
    rapprochement = {
      etat: 'termine',
      mandat: 'Mandat A',
      depuis: '2026-09-01',
      lus: 9,
      total: 9,
      rapport: { messages: 9, contactes: 4, reponses: 1, autos: 1, bounces: 2, jamaisContactes: 1 },
    };
    render(<Bases slug="simatis" />);
    expect(await screen.findByText('4 contactés')).toBeTruthy();
    expect(screen.getByText('2 adresses en erreur')).toBeTruthy();
    expect(screen.getByText('1 jamais contactés')).toBeTruthy();
  });

  it('enregistre la date de début du mandat', async () => {
    render(<Bases slug="simatis" />);
    const champ = await screen.findByLabelText('Début du mandat');
    fireEvent.change(champ, { target: { value: '2026-08-15' } });
    fireEvent.blur(champ);
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/base/mandats/mandat-a'));
      expect(put?.body).toEqual({ debut: '2026-08-15' });
    });
  });

  it('propose la classe de Claude et la valide', async () => {
    render(<Bases slug="simatis" />);
    expect(await screen.findByText(/merci de ne plus me contacter/)).toBeTruthy();
    expect(screen.getByText(/2 réponses attendent la routine/)).toBeTruthy();
    const classe = screen.getByLabelText<HTMLSelectElement>('Classe de la réponse de Léa MARTIN');
    expect(classe.value).toBe('ne_plus_contacter');
    fireEvent.click(screen.getByText('Valider'));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith('/valider'));
      expect(post?.body).toEqual({ classe: 'ne_plus_contacter' });
    });
  });

  it('ajoute les répondants au CRM et résume le résultat', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText('Ajouter les répondants au CRM du mandat'));
    expect(await screen.findByText(/2 ajoutés au CRM, 1 écartés/)).toBeTruthy();
  });
});
