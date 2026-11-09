// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EtatBase, ImportBase } from '../api.js';
import { Bases } from './Bases.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let etat: EtatBase;
let enrichissement: Record<string, unknown> | null = null;
let mandats: unknown[] = [];
let rapprochement: unknown = null;
let reponses: unknown[] = [];

// La liste complète est repliée par défaut : les tests qui la lisent l'ouvrent d'avance.
beforeEach(() => window.localStorage.setItem('base-liste-ouverte', '1'));

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
  if (url.includes('/base/listes/') && url.endsWith('/fiches')) return json({ ajoutees: 1 });
  if (method === 'POST' && url.endsWith('/base/tags')) return json({ ok: true });
  if (url.endsWith('/entreprise/candidats'))
    return json({
      candidats: [
        {
          siren: '123456789',
          nom: 'ATELIER FICTIF',
          naf: null,
          categorie: null,
          effectif: null,
          adresse: null,
          ville: 'CHASSIEU',
          active: true,
        },
      ],
    });
  if (method === 'POST' && url.endsWith('/entreprise'))
    return json({
      entreprise: {
        id: 'e1',
        siren: '123456789',
        nom: 'ATELIER FICTIF',
        finances: [],
        dirigeants: [],
      },
      rattachees: 1,
    });
  if (method === 'POST' && url.endsWith('/base/imports')) return json([apercu]);
  if (method === 'POST' && url.endsWith('/enrichir')) return json({ zone: 'prospectable' });
  if (method === 'POST' && url.endsWith('/integrer'))
    return json({ creees: 2, fusionnees: 0, restantes: 1 });
  if (method === 'PUT') return json(apercu);
  if (method === 'GET' && url.endsWith('/base/enrichissement'))
    return json(enrichissement ?? { disponible: false, lotMax: 0, tacheEnCours: null });
  if (url.endsWith('/suggestions') && url.includes('/base/enrichissement/')) return json([]);
  if (method === 'GET' && url.includes('/base/enrichissement/'))
    return json({ tache: { id: 't', etat: 'terminee', jetons: 0, erreur: null }, lignes: [] });
  if (url.includes('/base/enrichissement-sessions/') && url.endsWith('/contacts'))
    return json([
      {
        entreprise: 'Atelier Fictif',
        prenom: 'Léa',
        nom: 'Martin',
        fonction: 'Dirigeante',
        statut: null,
      },
    ]);
  if (url.includes('/base/enrichissement-sessions/') && (method === 'PATCH' || method === 'DELETE'))
    return json({ ok: true });
  if (url.endsWith('/base/enrichissement-sessions'))
    return json([
      {
        id: 's1',
        date: '2026-11-03T08:00:00Z',
        nature: 'recherche',
        libelle: 'Recherche de nouveaux prospects',
        mode: 'automatique',
        etat: 'terminee',
        traites: 12,
        ajoutees: 9,
        detail: null,
        commentaire: null,
      },
      {
        id: 's2',
        date: '2026-11-02T08:00:00Z',
        nature: 'enrichissement',
        libelle: 'Complément de fiches',
        mode: 'manuel',
        etat: 'erreur',
        traites: 3,
        ajoutees: 0,
        detail: 'Quota atteint',
        commentaire: null,
      },
    ]);
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

const videEtat = (): EtatBase => ({
  fiches: [],
  total: 0,
  compteurs: { aEnrichir: 0, prospectable: 0 },
  provenances: [],
  listes: [],
  tags: [],
  imports: [],
});
const ouvrirImport = () => fireEvent.click(screen.getByText('+ Importer une liste'));
const remplirDepot = (texte: string) => {
  fireEvent.change(screen.getByPlaceholderText('Sharp, LinkedIn, salon…'), {
    target: { value: 'Sharp' },
  });
  fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, {
    target: { value: texte },
  });
};

describe('base vivante : import en trois temps', () => {
  beforeEach(() => {
    calls = [];
    enrichissement = null;
    mandats = [];
    rapprochement = null;
    reponses = [];
    etat = videEtat();
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('invite à importer une première liste quand la base est vide', async () => {
    render(<Bases slug="simatis" />);
    expect(await screen.findByText(/La base est vide/)).toBeTruthy();
    fireEvent.click(screen.getByText('Importer une liste'));
    expect(screen.getByRole('dialog', { name: 'Importer une liste' })).toBeTruthy();
  });

  it('exige la source de la liste avant de lire', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText(/La base est vide/);
    ouvrirImport();
    fireEvent.click(screen.getByText('Lire la liste'));
    expect(await screen.findByText(/Indiquez la source/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('lit du texte collé, fait vérifier les colonnes, puis intègre après validation', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText(/La base est vide/);
    ouvrirImport();
    remplirDepot('Société\tNom\nAtelier Fictif\tDurand');
    fireEvent.click(screen.getByText('Lire la liste'));

    expect(await screen.findByText(/3 colonnes reconnues sur 4/)).toBeTruthy();
    const envoi = calls.find((c) => c.method === 'POST');
    expect(envoi?.body).toMatchObject({ provenance: 'Sharp' });
    expect((envoi?.body as { texte: string }).texte).toContain('Atelier Fictif');

    fireEvent.click(screen.getByText('Continuer'));
    expect(await screen.findByText('1 prospectables')).toBeTruthy();
    expect(screen.getByText('Contacté par Mandat A le 01/09/2026')).toBeTruthy();
    expect(screen.getByText('1 sous le minimum')).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/integrer'))).toBe(false);

    fireEvent.click(screen.getByText('Intégrer 2 fiches à la base'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/integrer'))).toBe(true));
  });

  it('corrige le contenu d’une colonne', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText(/La base est vide/);
    ouvrirImport();
    remplirDepot('x');
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

  it('range un import en attente dans « À faire » et le rouvre à la validation', async () => {
    etat = { ...videEtat(), imports: [{ ...apercu }] };
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText(/Valider l'import « Texte collé » \(3 lignes\)/));
    expect(await screen.findByText('1 prospectables')).toBeTruthy();
    expect(screen.getByText('Intégrer 2 fiches à la base')).toBeTruthy();
  });

  it('annule un import en envoyant une requête que le serveur accepte', async () => {
    etat = { ...videEtat(), imports: [{ ...apercu }] };
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText(/Valider l'import « Texte collé » \(3 lignes\)/));
    fireEvent.click(await screen.findByText("Annuler l'import"));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    // Fastify refuses a JSON request without a body: the cancel must carry one.
    expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({});
    expect(screen.queryByText('Bad Request')).toBeNull();
  });

  it('se ferme avec Échap', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText(/La base est vide/);
    ouvrirImport();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('base vivante : liste unique, filtres, fiche, sélection', () => {
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
      compteurs: { aEnrichir: 4, prospectable: 1 },
      provenances: ['Sharp'],
      listes: [],
      tags: [],
      imports: [],
    };
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const lectures = () => calls.filter((c) => c.method === 'GET').map((c) => c.url);

  it('sépare les parcours d’ajout des outils de la liste et ouvre la base complète', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText('Atelier Fictif');
    expect(screen.getByRole('tab', { name: /Base complète/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(
      within(screen.getByRole('region', { name: 'Trouver des prospects' })).getByRole('button', {
        name: 'Rechercher de nouveaux prospects',
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Importer des contacts' })).getByRole('button', {
        name: '+ Importer une liste',
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Fiches de la base' })).getByLabelText(
        'Rechercher dans la base',
      ),
    ).toBeTruthy();
    const menu = screen.getByText('Gérer la base').closest('details');
    expect(menu?.open).toBe(false);
    fireEvent.click(screen.getByText('Gérer la base'));
    expect(menu?.open).toBe(true);
    expect(within(menu!).getByText('Mettre à jour depuis les mails')).toBeTruthy();
    expect(within(menu!).getByText('Exporter en CSV')).toBeTruthy();
  });

  it('montre le dernier contact et les alertes de chaque fiche', async () => {
    render(<Bases slug="simatis" />);
    expect(await screen.findByText('Atelier Fictif')).toBeTruthy();
    expect(
      within(
        within(screen.getByRole('region', { name: 'Fiches de la base' })).getByRole('table'),
      ).getByText('Contacté'),
    ).toBeTruthy();
    expect(screen.getByText(/Contacté le 15\/09\/2026/)).toBeTruthy();
    expect(screen.getByText(/2 contacts · Mandat A/)).toBeTruthy();
  });

  it('propose de compléter les fiches sans moyen de contact', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText(/4 fiches sans contact à enrichir/));
    await waitFor(() => expect(lectures().some((u) => u.includes('zone=a_enrichir'))).toBe(true));
    expect(await screen.findByText(/n'entre jamais dans un CRM/)).toBeTruthy();
  });

  it('chaque onglet envoie ses filtres au serveur', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText('Atelier Fictif');
    fireEvent.click(screen.getByRole('tab', { name: 'Prêtes à contacter' }));
    await waitFor(() =>
      expect(
        lectures().some(
          (u) => u.includes('zone=prospectable') && u.includes('statut=jamais_contacte'),
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Contactées' }));
    await waitFor(() => expect(lectures().some((u) => /statut=contacte(&|$)/.test(u))).toBe(true));
    expect(screen.getByRole('tab', { name: 'Contactées' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('envoie la recherche et l’alerte, et propose l’export avec les mêmes filtres', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText('Atelier Fictif');
    fireEvent.change(screen.getByLabelText('Filtrer par alerte'), {
      target: { value: 'email_invalide' },
    });
    fireEvent.change(screen.getByLabelText('Rechercher dans la base'), {
      target: { value: 'fictif' },
    });
    await waitFor(() => {
      const url = lectures().at(-1) ?? '';
      expect(url).toContain('alerte=email_invalide');
      expect(url).toContain('q=fictif');
    });
    const lien = screen.getByText('Exporter en CSV').closest('a');
    expect(lien?.getAttribute('href')).toContain('export.csv?');
    expect(lien?.getAttribute('href')).toContain('alerte=email_invalide');
  });

  it('enrichit une entreprise sans contact depuis sa fiche', async () => {
    etat = {
      ...etat,
      fiches: [{ ...fiche, zone: 'a_enrichir', prenom: null, nom: '', email: null }],
    };
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText('Contact à trouver chez Atelier Fictif'));
    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Léa' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lea@atelier.test' } });
    fireEvent.click(screen.getByText('Enregistrer le contact'));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith('/enrichir'));
      expect(post?.url).toContain('/base/fiches/22222222');
      expect(post?.body).toMatchObject({ prenom: 'Léa', nom: 'Martin', email: 'lea@atelier.test' });
    });
  });

  it('bascule entre les contacts et les entreprises de la base', async () => {
    render(<Bases slug="simatis" />);
    await screen.findByText('Atelier Fictif');
    fireEvent.click(screen.getByRole('tab', { name: 'Entreprises' }));
    expect(await screen.findByLabelText('Rechercher une entreprise de la base')).toBeTruthy();
    expect(calls.some((c) => c.url.includes('/base/entreprises'))).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }));
    expect(await screen.findByLabelText('Rechercher dans la base')).toBeTruthy();
  });

  it('ouvre la recherche d’entreprises depuis le parcours de recherche', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chercher des entreprises' }));
    expect(screen.getByRole('dialog', { name: 'Chercher des entreprises' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chercher dans l’annuaire' })).toBeTruthy();
  });

  it('rattache la fiche à l’annuaire sans fermer la fiche', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText('Léa MARTIN'));
    fireEvent.click(screen.getByRole('button', { name: /Rattacher à l’annuaire/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir' }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/entreprise'));
      expect(post?.url).toContain('/base/fiches/22222222');
      expect(post?.body).toEqual({ siren: '123456789' });
    });
    expect(await screen.findByText('1 contact rattaché.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Léa MARTIN' })).toBeTruthy();
  });

  it('marque une opposition depuis la fiche', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText('Léa MARTIN'));
    fireEvent.change(screen.getByLabelText('Conformité de Léa MARTIN'), {
      target: { value: 'opposition' },
    });
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch?.url).toContain('/base/fiches/22222222');
      expect(patch?.body).toEqual({ opposition: true, exclusion: null });
    });
  });

  it('agit sur plusieurs fiches à la fois', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByLabelText('Sélectionner Léa MARTIN'));
    expect(screen.getByText('1 sélectionnée')).toBeTruthy();
    fireEvent.click(screen.getByText('Ne plus contacter'));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch?.body).toEqual({ opposition: true, exclusion: null });
    });
  });

  it('filtre par liste et par étiquette', async () => {
    etat = {
      ...etat,
      listes: [{ id: 'l1', nom: 'À appeler', type: 'contacts', mandat: null, nombre: 3 }],
      tags: ['salon'],
    };
    render(<Bases slug="simatis" />);
    await screen.findByText('Atelier Fictif');
    fireEvent.change(screen.getByLabelText('Filtrer par liste'), { target: { value: 'l1' } });
    await waitFor(() => expect(lectures().some((u) => u.includes('liste=l1'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Filtrer par étiquette'), {
      target: { value: 'salon' },
    });
    await waitFor(() => expect(lectures().some((u) => u.includes('tag=salon'))).toBe(true));
    expect(screen.getByRole('button', { name: 'Exporter pour Waalaxy' })).toBeTruthy();
  });

  it('ajoute la sélection à une liste et l’étiquette', async () => {
    etat = {
      ...etat,
      listes: [{ id: 'l1', nom: 'À appeler', type: 'contacts', mandat: null, nombre: 3 }],
    };
    vi.spyOn(window, 'prompt').mockReturnValue('Salon 2026');
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByLabelText('Sélectionner Léa MARTIN'));
    fireEvent.change(screen.getByLabelText('Ajouter la sélection à une liste'), {
      target: { value: 'l1' },
    });
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith('/base/listes/l1/fiches'));
      expect(post?.method).toBe('POST');
      expect(post?.body).toEqual({ ids: ['22222222-2222-4222-8222-222222222222'] });
    });
    expect(await screen.findByText('1 contact ajouté à la liste.')).toBeTruthy();
    // La liste est relue après l'ajout : la sélection repart de zéro.
    fireEvent.click(await screen.findByLabelText('Sélectionner Léa MARTIN'));
    fireEvent.click(screen.getByRole('button', { name: 'Étiqueter…' }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith('/base/tags'));
      expect(post?.body).toEqual({
        ids: ['22222222-2222-4222-8222-222222222222'],
        ajouter: ['Salon 2026'],
      });
    });
  });

  it('propose d’enrichir avec l’IA quand Codex est disponible', async () => {
    const { unmount } = render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByLabelText('Sélectionner Léa MARTIN'));
    expect(screen.queryByText('Rechercher avec Codex')).toBeNull();
    unmount();
    cleanup();
    enrichissement = { disponible: true, lotMax: 5, tacheEnCours: null };
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByLabelText('Sélectionner Léa MARTIN'));
    fireEvent.click(await screen.findByText('Rechercher avec Codex'));
    expect(await screen.findByText('Lancer sur 1 fiche')).toBeTruthy();
  });

  it('permet de suivre un enrichissement resté en cours', async () => {
    enrichissement = { disponible: true, lotMax: 5, tacheEnCours: 'tache-9' };
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText("Suivre l'enrichissement"));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/base/enrichissement/tache-9'))).toBe(true),
    );
  });

  it('actualise l’historique depuis les CRM', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText("Actualiser l'historique"));
    expect(await screen.findByText(/1 adresses vérifiées dans les CRM/)).toBeTruthy();
  });

  it('affiche les dernières sessions, automatiques et manuelles', async () => {
    render(<Bases slug="simatis" />);
    const panneau = await screen.findByRole('region', { name: "Sessions d'enrichissement" });
    expect(await within(panneau).findByText('Automatique')).toBeTruthy();
    expect(within(panneau).getByText('Manuel')).toBeTruthy();
    expect(within(panneau).getByText('Quota atteint')).toBeTruthy();
  });

  it('replie la liste des sessions et retient le choix', async () => {
    window.localStorage.removeItem('sessions-enrichissement-ouvertes');
    render(<Bases slug="simatis" />);
    const panneau = await screen.findByRole('region', { name: "Sessions d'enrichissement" });
    expect(await within(panneau).findByText('Quota atteint')).toBeTruthy();
    fireEvent.click(within(panneau).getByRole('button', { name: 'Replier la liste' }));
    expect(within(panneau).queryByText('Quota atteint')).toBeNull();
    expect(window.localStorage.getItem('sessions-enrichissement-ouvertes')).toBe('0');
  });

  it('montre les contacts d’une session et enregistre un commentaire', async () => {
    window.localStorage.removeItem('sessions-enrichissement-ouvertes');
    render(<Bases slug="simatis" />);
    const panneau = await screen.findByRole('region', { name: "Sessions d'enrichissement" });
    const boutons = await within(panneau).findAllByTitle('Voir les contacts de cette session');
    fireEvent.click(boutons[0]!);
    expect(await within(panneau).findByText('Atelier Fictif')).toBeTruthy();
    fireEvent.change(within(panneau).getByLabelText('Commentaire'), {
      target: { value: 'Lancée par erreur' },
    });
    fireEvent.click(within(panneau).getByRole('button', { name: 'Enregistrer le commentaire' }));
    await waitFor(() => {
      const patch = calls.find(
        (c) => c.method === 'PATCH' && c.url.includes('enrichissement-sessions'),
      );
      expect(patch?.url).toContain('/enrichissement-sessions/recherche/s1');
      expect(patch?.body).toEqual({ commentaire: 'Lancée par erreur' });
    });
  });

  it('supprime une session après confirmation', async () => {
    window.localStorage.removeItem('sessions-enrichissement-ouvertes');
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    render(<Bases slug="simatis" />);
    const panneau = await screen.findByRole('region', { name: "Sessions d'enrichissement" });
    fireEvent.click(
      (await within(panneau).findAllByRole('button', { name: 'Supprimer la session' }))[1]!,
    );
    await waitFor(() => expect(within(panneau).queryByText('Quota atteint')).toBeNull());
    expect(
      calls.some(
        (c) =>
          c.method === 'DELETE' && c.url.endsWith('/enrichissement-sessions/enrichissement/s2'),
      ),
    ).toBe(true);
    vi.unstubAllGlobals();
  });

  it('replie la liste des contacts par défaut et la rouvre avec le bouton', async () => {
    window.localStorage.removeItem('base-liste-ouverte');
    render(<Bases slug="simatis" />);
    const bouton = await screen.findByRole('button', { name: 'Afficher la liste des contacts' });
    expect(screen.queryByText('Atelier Fictif')).toBeNull();
    fireEvent.click(bouton);
    expect(await screen.findByText('Atelier Fictif')).toBeTruthy();
    expect(window.localStorage.getItem('base-liste-ouverte')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Réduire la liste des contacts' }));
    expect(screen.queryByText('Atelier Fictif')).toBeNull();
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
      listes: [],
      tags: [],
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
    fireEvent.click(await screen.findByText('Mettre à jour depuis les mails'));
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
    fireEvent.click(await screen.findByText('Mettre à jour depuis les mails'));
    expect(await screen.findByText('4 contactés')).toBeTruthy();
    expect(screen.getByText('2 adresses en erreur')).toBeTruthy();
    expect(screen.getByText('1 jamais contactés')).toBeTruthy();
  });

  it('enregistre la date de début du mandat', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText('Mettre à jour depuis les mails'));
    const champ = await screen.findByLabelText('Début du mandat');
    fireEvent.change(champ, { target: { value: '2026-08-15' } });
    fireEvent.blur(champ);
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/base/mandats/mandat-a'));
      expect(put?.body).toEqual({ debut: '2026-08-15' });
    });
  });

  it('propose la classe de Claude et la valide en un clic', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText('Classer 1 réponse'));
    expect(await screen.findByText(/merci de ne plus me contacter/)).toBeTruthy();
    expect(screen.getByText(/2 réponses attendent la routine/)).toBeTruthy();
    expect(screen.getByText('Proposé par Claude : Ne plus me contacter')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ne plus me contacter/ }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith('/valider'));
      expect(post?.body).toEqual({ classe: 'ne_plus_contacter' });
    });
  });

  it('valide une réponse avec le clavier', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText('Classer 1 réponse'));
    await screen.findByText(/merci de ne plus me contacter/);
    fireEvent.keyDown(document, { key: '1' });
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith('/valider'));
      expect(post?.body).toEqual({ classe: 'interesse' });
    });
  });

  it('ajoute les répondants au CRM et résume le résultat', async () => {
    render(<Bases slug="simatis" />);
    fireEvent.click(await screen.findByText('Classer 1 réponse'));
    fireEvent.click(await screen.findByText('Ajouter les répondants au CRM du mandat'));
    expect(await screen.findByText(/2 ajoutés au CRM, 1 écartés/)).toBeTruthy();
  });
});
