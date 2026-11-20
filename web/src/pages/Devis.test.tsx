// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Devis } from './Devis.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

const contenu = {
  titre: 'Diagnostic fictif',
  adresse: '',
  attention: '',
  contexte: 'Contexte fictif',
  objectifs: '',
  inclus: 'Entretiens',
  exclu: 'Recrutement',
  livrables: '',
  debut: null,
  duree: '',
  remisePct: 0,
  acomptePct: 0,
  frais: 'refactures',
  fraisPlafond: null,
  fraisTexte: '',
  modePrix: 'forfait',
  sortieMois: null,
  texteSortie: '',
  conditionsParticulieres: '',
  validiteJours: 30,
  clauses: [{ titre: 'Paiement', texte: 'À 30 jours', active: true }],
};
const brouillon = {
  ...contenu,
  id: 'd1',
  opportuniteId: 'o9',
  numero: 'DEV-2026-001',
  version: 1,
  statut: 'brouillon',
  createdAt: '2026-11-01T00:00:00Z',
  envoyeLe: null,
  opportunite: 'Diagnostic fictif',
  entreprise: 'Exemple Industrie',
  contact: 'Camille Exemple',
  lignes: [
    { libelle: 'Diagnostic', unite: 'forfait', quantite: 1, prixUnitaire: null, prixPropose: 5100 },
  ],
  totaux: { brut: 0, remise: 0, ht: 0, tva: 0, ttc: 0, acompte: 0, prixManquant: true },
  versions: 1,
  tvaPct: 20,
  mentions: '',
};
const valide = {
  ...brouillon,
  statut: 'valide',
  lignes: [{ libelle: 'Diagnostic', unite: 'forfait', quantite: 1, prixUnitaire: 5100 }],
};
const etapes = [
  { id: 'detection', label: 'Détection' },
  { id: 'prospection', label: 'Prospection' },
  { id: 'qualification', label: 'Qualification' },
  { id: 'proposition', label: 'Proposition' },
];
const opps = [
  {
    id: 'radar-1',
    titre: 'Premier contact',
    etape: 'prospection',
    clos: null,
    entreprise: 'Radar SA',
    montant: null,
    modeFacturation: 'spot',
  },
  {
    id: 'o2',
    titre: 'Accompagnement',
    etape: 'qualification',
    clos: null,
    entreprise: 'Démo Mécanique',
    montant: 900,
    modeFacturation: 'recurrent',
  },
  {
    id: 'o1',
    titre: 'Diagnostic fictif',
    etape: 'proposition',
    clos: null,
    entreprise: 'Exemple Industrie',
    montant: 5100,
    modeFacturation: 'spot',
  },
];

const parametres = {
  reglages: {
    numerotation: 'DEV-{AAAA}-{NNN}',
    mentions: '',
    tvaPct: 20,
    validiteJours: 30,
    acomptePct: 0,
  },
  clauses: [
    {
      id: 'c1',
      titre: 'Confidentialité',
      texte: 'Gardée confidentielle.',
      parDefaut: false,
      ordre: 1,
    },
  ],
  modeles: [
    {
      id: 'm1',
      nom: 'Modèle fictif',
      contexte: '',
      objectifs: '',
      inclus: 'Prestation',
      exclu: '',
      livrables: '',
      duree: '',
      lignes: [],
    },
  ],
};
let detail: Record<string, unknown> = brouillon;
let existant = false;

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.endsWith('/devis/parametres')) return json(parametres);
  if (url.endsWith('/pipeline')) return json({ etapes, opportunites: opps });
  if (url.endsWith('/devis') && method === 'GET') return json([detail]);
  if (url.endsWith('/devis') && method === 'POST') return json({ ...detail, existant });
  if (url.endsWith('/devis/d1') && method === 'GET') return json(detail);
  if (url.endsWith('/version')) return json({ ...brouillon, id: 'd2', version: 2 });
  return json({ id: 'd1', statut: 'proposee' });
}

describe('écran Devis', () => {
  beforeEach(() => {
    calls = [];
    detail = brouillon;
    existant = false;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('la liste montre le numéro, le client et « prix à fixer »', async () => {
    render(<Devis slug="simatis" />);
    expect(await screen.findByText('DEV-2026-001')).toBeTruthy();
    expect(screen.getByText('Exemple Industrie')).toBeTruthy();
    expect(screen.getByText('prix à fixer')).toBeTruthy();
  });

  it('le choix de l’affaire filtre à la saisie et met la Proposition en tête', async () => {
    render(<Devis slug="simatis" />);
    fireEvent.click(await screen.findByText('+ Nouveau devis'));
    const lignes = await screen.findAllByRole('button', { name: /Préparer le devis/ });
    expect(lignes).toHaveLength(2);
    const premiere = screen.getAllByRole('row')[0] as HTMLElement;
    expect(premiere.textContent).toContain('Exemple Industrie');
    fireEvent.change(screen.getByPlaceholderText(/Rechercher une affaire/), {
      target: { value: 'démo' },
    });
    expect(screen.getAllByRole('button', { name: /Préparer le devis/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Préparer le devis/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ opportuniteId: 'o2' }),
    );
  });

  it('ne propose pas les affaires encore au Radar', async () => {
    render(<Devis slug="simatis" />);
    fireEvent.click(await screen.findByText('+ Nouveau devis'));
    await screen.findAllByRole('button', { name: /Préparer le devis/ });
    expect(screen.queryByText('Radar SA')).toBeNull();
    expect(screen.getByText('Proposition')).toBeTruthy();
  });

  it('saisir un prix met l’aperçu à jour sans réseau, puis enregistre le brouillon', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Prix/ }));
    const avant = calls.length;
    fireEvent.change(screen.getByLabelText('Prix unitaire : Diagnostic'), {
      target: { value: '1000' },
    });
    expect(screen.getAllByText(/1 200 €|1 200,00 €/).length).toBeGreaterThan(0);
    expect(calls.length).toBe(avant);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), {
      timeout: 3000,
    });
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      lignes: [{ prixUnitaire: 1000 }],
    });
  });

  it('« Reprendre » copie le montant de l’affaire dans le prix', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Prix/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reprendre 5\s100/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Prix unitaire : Diagnostic').value).toBe(
      '5100',
    );
  });

  it('« Valider le devis » est grisé tant qu’un prix manque', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Envoi/ }));
    expect(screen.getByText<HTMLButtonElement>('Valider le devis').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Prix/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reprendre 5\s100/ }));
    fireEvent.click(screen.getByRole('button', { name: /Envoi/ }));
    expect(screen.getByText<HTMLButtonElement>('Valider le devis').disabled).toBe(false);
  });

  it('un devis validé a tous ses champs désactivés et propose une nouvelle version', async () => {
    detail = valide;
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Mission/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Intitulé de la mission').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Envoi/ }));
    fireEvent.click(screen.getByText('Nouvelle version'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/version'))).toBe(true));
  });

  it('un devis envoyé propose « Accepté » et « Refusé » ; le refus envoie le motif', async () => {
    detail = { ...valide, statut: 'transmis', envoyeLe: '2026-11-10T09:00:00Z' };
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Envoi/ }));
    expect(screen.queryByText('Demander l’envoi')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refusé' }));
    fireEvent.change(screen.getByLabelText('Motif du refus (facultatif)'), {
      target: { value: 'Budget gelé' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le refus' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/conclure'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/conclure'))?.body).toEqual({
      issue: 'refuse',
      motif: 'Budget gelé',
    });
  });

  it('« Accepté » envoie l’issue sans motif', async () => {
    detail = { ...valide, statut: 'transmis', envoyeLe: '2026-11-10T09:00:00Z' };
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Envoi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accepté' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/conclure'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/conclure'))?.body).toEqual({ issue: 'accepte' });
  });

  it('un devis accepté est verrouillé et affiche son issue', async () => {
    detail = { ...valide, statut: 'accepte', envoyeLe: '2026-11-10T09:00:00Z' };
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Mission/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Intitulé de la mission').disabled).toBe(true);
    expect(screen.getAllByText('Accepté').length).toBeGreaterThan(0);
  });

  it('avec une affaire, ouvre directement le devis existant', async () => {
    existant = true;
    detail = { ...brouillon, opportuniteId: 'o1' };
    render(<Devis slug="simatis" affaire="o1" />);
    expect(await screen.findByLabelText('Intitulé de la mission')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ opportuniteId: 'o1' });
  });

  it('depuis une affaire sans devis, propose le choix du modèle avant de créer', async () => {
    render(<Devis slug="simatis" affaire="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modèle fictif' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      opportuniteId: 'o1',
      modeleId: 'm1',
    });
  });

  it('depuis une affaire sans devis, « Sans modèle » crée comme avant', async () => {
    render(<Devis slug="simatis" affaire="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sans modèle' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ opportuniteId: 'o1' });
  });

  it('« Tous les devis » ramène à la liste même après une ouverture depuis une affaire', async () => {
    detail = { ...brouillon, opportuniteId: 'o1' };
    render(<Devis slug="simatis" affaire="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Tous les devis/ }));
    expect(await screen.findByText('+ Nouveau devis')).toBeTruthy();
  });

  it('quitter l’éditeur tout de suite enregistre quand même la saisie', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Prix/ }));
    fireEvent.change(screen.getByLabelText('Prix unitaire : Diagnostic'), {
      target: { value: '1000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Tous les devis/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      lignes: [{ prixUnitaire: 1000 }],
    });
  });

  it('valider n’attend pas l’enregistrement automatique : un seul PUT avant la validation', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Prix/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reprendre 5\s100/ }));
    fireEvent.click(screen.getByRole('button', { name: /Envoi/ }));
    fireEvent.click(screen.getByText('Valider le devis'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/valider'))).toBe(true));
    await new Promise((r) => setTimeout(r, 1200));
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('le choix d’un modèle de mission est envoyé à la création', async () => {
    render(<Devis slug="simatis" />);
    fireEvent.click(await screen.findByText('+ Nouveau devis'));
    fireEvent.change(await screen.findByLabelText('Modèle de mission'), {
      target: { value: 'm1' },
    });
    fireEvent.click((await screen.findAllByRole('button', { name: /Préparer le devis/ }))[0]!);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ modeleId: 'm1' }),
    );
  });

  it('insère une clause de la bibliothèque, copiée dans le devis', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Conditions/ }));
    fireEvent.change(await screen.findByLabelText('Insérer une clause de la bibliothèque'), {
      target: { value: 'c1' },
    });
    expect(screen.getByDisplayValue('Gardée confidentielle.')).toBeTruthy();
  });

  it('l’aperçu montre les mentions de l’émetteur et la TVA réglée', async () => {
    detail = { ...brouillon, tvaPct: 10, mentions: 'Société fictive, 1 rue fictive' };
    render(<Devis slug="simatis" ouvrir="d1" />);
    expect(await screen.findByText(/Société fictive, 1 rue fictive/)).toBeTruthy();
    expect(screen.getAllByText(/TVA 10 %/).length).toBeGreaterThan(0);
  });

  it('l’aperçu porte le logo, le pied de page et l’adresse saisie du client', async () => {
    detail = { ...brouillon, mentions: 'Société fictive, 1 rue fictive' };
    render(<Devis slug="simatis" ouvrir="d1" />);
    const apercu = await screen.findByLabelText('Aperçu du devis');
    expect(apercu.querySelector('img[alt="SIMATIS"]')).toBeTruthy();
    expect(apercu.textContent).not.toContain('Direction commerciale à temps partagé');
    fireEvent.change(screen.getByLabelText('Adresse du client'), {
      target: { value: '12 rue Fictive' },
    });
    fireEvent.change(screen.getByLabelText('À l’attention de'), {
      target: { value: 'Alex Fictif' },
    });
    expect(apercu.textContent).toContain('12 rue Fictive');
    expect(apercu.textContent).toContain('Alex Fictif');
    expect(apercu.querySelector('.pied')?.textContent).toBe('Société fictive, 1 rue fictive');
  });

  it('passe en abonnement mensuel : l’aperçu montre le prix par mois et la sortie', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    const apercu = await screen.findByLabelText('Aperçu du devis');
    fireEvent.click(screen.getByRole('button', { name: /Prix/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Abonnement mensuel' }));
    fireEvent.change(screen.getByLabelText('Mensualité (€ HT)'), { target: { value: '2500' } });
    fireEvent.change(screen.getByLabelText('Engagement (mois)'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Sortie possible dès le mois'), {
      target: { value: '6' },
    });
    expect(apercu.textContent).toMatch(/2\s500,00\s€ HT \/ mois/);
    expect(apercu.textContent).toContain('6e mois');
    fireEvent.change(screen.getByLabelText('Frais de déplacement'), {
      target: { value: 'plafonnes' },
    });
    fireEvent.change(screen.getByLabelText('Plafond par aller-retour (€ HT)'), {
      target: { value: '60' },
    });
    expect(apercu.textContent).toContain('plafonnés à 60 € HT par aller-retour');
  });

  it('les conditions particulières n’apparaissent que si elles sont saisies', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    const apercu = await screen.findByLabelText('Aperçu du devis');
    expect(apercu.textContent).not.toContain('Conditions particulières');
    fireEvent.click(screen.getByRole('button', { name: /Conditions/ }));
    fireEvent.change(screen.getByLabelText('Conditions particulières (facultatif)'), {
      target: { value: 'Clause fictive' },
    });
    expect(apercu.textContent).toContain('Conditions particulières');
    expect(apercu.textContent).toContain('Clause fictive');
  });

  it('propose le PDF du devis à l’étape Envoi', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Envoi/ }));
    const lien = screen.getByRole('link', { name: /Télécharger le PDF/ });
    expect(lien.getAttribute('href')).toBe('/api/i/simatis/devis/d1/pdf');
    expect(lien.getAttribute('target')).toBe('_blank');
  });
});
