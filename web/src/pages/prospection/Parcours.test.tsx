// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BrouillonCampagne,
  CampagneProspection,
  ResultatCampagne,
  TacheRelance,
  VueProspection,
} from '../../api.js';
import { Prospection } from '../Prospection.js';
import { Attente } from './Attente.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let taches: TacheRelance[];
let campagne: CampagneProspection;
let vue: VueProspection;
let resultat: ResultatCampagne;
let refus: { url: RegExp; message: string } | null;

const brouillon = (
  id: string,
  nom: string,
  o: Partial<BrouillonCampagne> = {},
): BrouillonCampagne => ({
  id,
  contactNom: nom,
  contactEmail: `${nom.toLowerCase()}@exemple.test`,
  societe: `Société ${nom}`,
  touche: 2,
  etat: 'pret',
  objet: `Re: ${nom}`,
  corps: `<p>Bonjour ${nom},</p><p>Bien à vous,</p>`,
  note: null,
  suiviType: 'delai',
  suiviDate: null,
  ...o,
});

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
  calls.push({ url, method, body });
  const json = (b: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(b), { status }));
  if (refus?.url.test(url)) return json({ error: refus.message }, 400);
  if (url.endsWith('/prospection/rapprocher')) return json({ envoyes: 0 });
  if (url.endsWith('/prospection/taches-relance')) return json(taches);
  if (url.endsWith('/prospection') && method === 'GET') return json(vue);
  if (url.endsWith('/prospection/campagnes') && method === 'POST') {
    return json({ campagneId: campagne.id, refusees: [] }, 201);
  }
  if (/\/brouillons\/[^/]+$/.test(url) && method === 'PATCH') {
    const id = url.split('/').pop();
    const b = campagne.brouillons.find((x) => x.id === id)!;
    Object.assign(b, body);
    if (body?.suiviDate) b.suiviDate = `${body.suiviDate as string}T08:00:00Z`;
    return json(b);
  }
  if (url.endsWith('/finaliser')) return json(resultat);
  if (url.endsWith('/relancer')) {
    campagne.statut = 'redaction';
    return json({ ok: true });
  }
  if (/\/campagnes\/[^/]+$/.test(url)) return json(campagne);
  return json({}, 404);
}

beforeEach(() => {
  calls = [];
  refus = null;
  taches = [
    {
      id: 't1',
      titre: 'Relancer Alice',
      contactNom: 'Alice',
      societe: 'Société Alice',
      echeance: '2026-10-28T08:00:00Z',
      touche: 2,
      utilisable: true,
    },
    {
      id: 't2',
      titre: 'Relancer Bruno',
      contactNom: 'Bruno',
      societe: 'Société Bruno',
      echeance: '2026-10-29T08:00:00Z',
      touche: 2,
      utilisable: true,
    },
    {
      id: 't3',
      titre: 'Relancer Sans',
      contactNom: null,
      societe: null,
      echeance: null,
      touche: 2,
      utilisable: false,
    },
  ];
  campagne = {
    id: 'c1',
    mode: 'relance',
    statut: 'relecture',
    reglage: {
      offre: 'vma',
      creneaux: true,
      signatureId: 's1',
      suivi: { type: 'courte' },
      touchesMax: 4,
    },
    erreur: null,
    resultat: null,
    brouillons: [
      brouillon('b1', 'Alice'),
      brouillon('b2', 'Bruno', { etat: 'a_verifier', note: 'Fil introuvable' }),
    ],
  };
  vue = {
    stats: {
      jour: 3,
      objectif: 30,
      semaine: 10,
      reponses: 1,
      rdv: 0,
      parTheme: {},
      parTouche: {},
      relancesFaites: 0,
      relancesRestantes: 2,
      aConfirmer: 0,
    },
    signatures: [{ id: 's1', nom: 'Simatis', defaut: true, typeMime: 'image/png' }],
    recentes: [],
    enCours: null,
  };
  resultat = {
    brouillons: 1,
    simulation: false,
    suivisCrees: 1,
    suivisNonCrees: 0,
    clos: 0,
    faites: 1,
    echecs: 0,
  };
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ouvrirChoix = async () => {
  render(<Prospection slug="simatis" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Choisir les tâches' }));
  await screen.findByText('Quelles tâches relancer ?');
};

describe('Relancer des tâches : choix', () => {
  it('liste les tâches, désactive celle sans contact, et sélectionne seulement les utilisables', async () => {
    await ouvrirChoix();
    expect(screen.getByLabelText<HTMLInputElement>('Choisir Relancer Sans').disabled).toBe(true);
    expect(screen.getByText(/Sans contact ou sans adresse mail/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Tout sélectionner'));
    expect(screen.getByRole('button', { name: 'Continuer avec 2 tâches' })).toBeTruthy();
  });

  it('ne continue pas sans sélection', async () => {
    await ouvrirChoix();
    expect(
      screen.getByRole('button', { name: /Continuer avec 0 tâche/ }).hasAttribute('disabled'),
    ).toBe(true);
  });
});

describe('Relancer des tâches : réglage', () => {
  async function versReglage() {
    await ouvrirChoix();
    fireEvent.click(screen.getByLabelText('Choisir Relancer Alice'));
    fireEvent.click(screen.getByRole('button', { name: 'Continuer avec 1 tâche' }));
    await screen.findByText(/Régler la campagne/);
  }

  it('propose la signature par défaut et envoie le réglage choisi', async () => {
    await versReglage();
    expect(screen.getByLabelText<HTMLSelectElement>('Signature').value).toBe('s1');
    fireEvent.click(screen.getByLabelText("Diagnostic d'endurance"));
    fireEvent.click(screen.getByLabelText('1 à 2 mois'));
    fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'aucune' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rédiger le brouillon' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/campagnes'))).toBe(true),
    );
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/campagnes'))!;
    expect(post.body).toEqual({
      mode: 'relance',
      tacheIds: ['t1'],
      reglage: {
        offre: 'diagnostic',
        creneaux: true,
        signatureId: null,
        suivi: { type: 'longue' },
        touchesMax: 4,
      },
    });
  });

  it('montre le refus du serveur sans quitter le réglage', async () => {
    await versReglage();
    refus = {
      url: /\/prospection\/campagnes$/,
      message: 'La date du suivi doit être aujourd’hui ou plus tard.',
    };
    fireEvent.click(screen.getByRole('button', { name: 'Rédiger le brouillon' }));
    expect(await screen.findByText(/date du suivi/)).toBeTruthy();
    expect(screen.getByText(/Régler la campagne/)).toBeTruthy();
  });

  it('envoie la date précise choisie', async () => {
    await versReglage();
    fireEvent.click(screen.getByLabelText('Date précise'));
    fireEvent.change(screen.getByLabelText('Date du suivi'), { target: { value: '2099-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rédiger le brouillon' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/campagnes'))).toBe(true),
    );
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/campagnes'))!;
    expect((post.body as { reglage: { suivi: unknown } }).reglage.suivi).toEqual({
      type: 'date',
      date: '2099-02-01',
    });
  });
});

describe('Attente de la rédaction', () => {
  it('interroge la campagne jusqu’à la relecture', async () => {
    campagne.statut = 'redaction';
    const onPret = vi.fn();
    render(<Attente slug="simatis" id="c1" intervalleMs={10} onPret={onPret} />);
    expect(await screen.findByText(/Claude rédige les brouillons/)).toBeTruthy();
    expect(onPret).not.toHaveBeenCalled();
    campagne.statut = 'relecture';
    await waitFor(() => expect(onPret).toHaveBeenCalled());
  });

  it('affiche l’erreur de l’exécuteur et permet de relancer la rédaction', async () => {
    campagne.statut = 'erreur';
    campagne.erreur = "L'exécuteur n'a pas pris la demande en 15 minutes.";
    render(<Attente slug="simatis" id="c1" intervalleMs={10} onPret={vi.fn()} />);
    expect(await screen.findByText(/exécuteur n'a pas pris/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Relancer la rédaction' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/relancer'))).toBe(true));
    expect(await screen.findByText(/Claude rédige les brouillons/)).toBeTruthy();
  });
});

describe('Relecture et fin', () => {
  async function relecture() {
    vue.enCours = 'c1';
    render(<Prospection slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reprendre la campagne en cours' }));
    await screen.findByText('Objet : Re: Alice');
  }

  it('reprend la campagne en cours depuis l’accueil, à la relecture', async () => {
    await relecture();
    expect(screen.getByRole('button', { name: 'Ouvrir le mail de Bruno' })).toBeTruthy();
    expect(screen.getByAltText('Signature Simatis')).toBeTruthy();
  });

  it('bloque la création tant qu’un brouillon est à vérifier, puis la permet après relecture', async () => {
    await relecture();
    const creer = () => screen.getByRole('button', { name: /Créer les \d+ brouillons?/ });
    expect(creer().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/1 à vérifier/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le mail de Bruno' }));
    expect(screen.getByText('Fil introuvable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "J'ai relu ce mail" }));
    await waitFor(() => expect(creer().hasAttribute('disabled')).toBe(false));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ etat: 'pret' });
  });

  it('modifie le texte (HTML refait à partir du texte) et l’objet', async () => {
    await relecture();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le texte' }));
    fireEvent.change(screen.getByLabelText('Texte du mail'), {
      target: { value: 'Bonjour Alice,\n\n- Jeudi 12 à 9h30\n- Mardi 17 à 14h\n\nBien à vous,' },
    });
    fireEvent.change(screen.getByLabelText('Objet'), { target: { value: 'Re: Autre objet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le texte' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      objet: 'Re: Autre objet',
      corps:
        '<p>Bonjour Alice,</p><ul><li>Jeudi 12 à 9h30</li><li>Mardi 17 à 14h</li></ul><p>Bien à vous,</p>',
    });
  });

  it('écarte un mail, règle un dossier clos et une date citée', async () => {
    await relecture();
    fireEvent.click(screen.getByLabelText('Dossier clos (refus)'));
    await waitFor(() =>
      expect(calls.some((c) => (c.body as { suiviType?: string })?.suiviType === 'clos')).toBe(
        true,
      ),
    );
    fireEvent.click(screen.getByLabelText('Date citée par le contact'));
    fireEvent.change(screen.getByLabelText('Date de reprise'), { target: { value: '2099-01-15' } });
    await waitFor(() =>
      expect(
        calls.some((c) => (c.body as { suiviDate?: string })?.suiviDate === '2099-01-15'),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Écarter' }));
    await waitFor(() =>
      expect(calls.some((c) => (c.body as { etat?: string })?.etat === 'ecarte')).toBe(true),
    );
  });

  it('crée les brouillons et affiche le résumé', async () => {
    campagne.brouillons = [brouillon('b1', 'Alice')];
    await relecture();
    fireEvent.click(
      screen.getByRole('button', { name: 'Créer les 1 brouillon dans la messagerie' }),
    );
    expect(await screen.findByText('Brouillons créés')).toBeTruthy();
    const ligne = screen.getByText('Tâches de suivi créées').closest('tr')!;
    expect(within(ligne).getByText('1')).toBeTruthy();
  });

  it('en simulation, explique que rien n’a été créé et revient à la relecture', async () => {
    campagne.brouillons = [brouillon('b1', 'Alice')];
    resultat = { ...resultat, simulation: true, brouillons: 0 };
    await relecture();
    fireEvent.click(screen.getByRole('button', { name: /Créer les 1 brouillon/ }));
    expect(await screen.findByText(/Simulation :/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revenir à la relecture' }));
    expect(await screen.findByText('Objet : Re: Alice')).toBeTruthy();
  });

  it('affiche le refus du serveur à la création', async () => {
    campagne.brouillons = [brouillon('b1', 'Alice')];
    await relecture();
    refus = { url: /\/finaliser$/, message: 'Aucune messagerie branchée sur cette instance.' };
    fireEvent.click(screen.getByRole('button', { name: /Créer les 1 brouillon/ }));
    expect(await screen.findByText(/Aucune messagerie branchée/)).toBeTruthy();
  });
});

describe('Accueil : campagnes récentes', () => {
  it('liste les campagnes terminées', async () => {
    vue.recentes = [
      {
        id: 'c0',
        mode: 'relance',
        statut: 'terminee',
        creeLe: '2026-10-29T10:00:00Z',
        brouillons: 6,
        resultat: null,
      },
    ];
    render(<Prospection slug="simatis" />);
    expect(await screen.findByText('Relance de tâches')).toBeTruthy();
  });
});
