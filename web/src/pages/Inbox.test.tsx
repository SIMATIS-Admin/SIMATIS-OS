// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Inbox } from './Inbox.js';

// The page header lives in the app: this stands in for it, with its two slots.
function AvecEntete(props: Omit<Parameters<typeof Inbox>[0], 'entete'>) {
  const [gauche, setGauche] = useState<HTMLElement | null>(null);
  const [droite, setDroite] = useState<HTMLElement | null>(null);
  return (
    <>
      <span ref={setGauche} />
      <span ref={setDroite} />
      <Inbox {...props} entete={{ gauche, droite }} />
    </>
  );
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let simulation = false;

const proposition = {
  id: 'p1',
  type: 'email.brouillon',
  contenu: {
    to: 'h.morvan@exemple.fr',
    objet: 'Votre proposition',
    corps: '<p>Bonjour Madame Morvan,</p><script>alert(1)</script>',
    origine: 'Routine quotidienne',
    controles: ['Pas de réponse au dernier message'],
  },
  auteur: 'os',
  statut: 'proposee',
  niveau: 'L1',
  decidePar: null,
  resultat: null,
  createdAt: '2026-10-08T06:00:00Z',
  action: "Créer un brouillon d'email",
  contact: { id: 'c1', nom: 'Hélène Morvan', entreprise: 'Ateliers Morvan' },
};

const sujet = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'mail_a_repondre',
  titre: `Sujet ${id}`,
  resume: `Résumé ${id}`,
  origine: 'messagerie',
  lien: null,
  echeance: null,
  priorite: 3,
  statut: 'a_traiter',
  tacheId: null,
  createdAt: '2026-10-10T08:00:00Z',
  traiteAt: null,
  contact: null,
  entreprise: null,
  instance: { slug: 'simatis', nom: 'SIMATIS', couleur: '#0B2545' },
  proposition: null,
  ...extra,
});

const liste = () => [
  sujet('s1', {
    titre: 'Répondre à Hélène',
    echeance: '2020-01-02T10:00:00Z',
    contact: { id: 'c1', nom: 'Hélène Morvan' },
    lien: 'https://mail.exemple.fr/fil/1',
  }),
  sujet('s2', {
    type: 'devis',
    titre: 'Devis Fonderie',
    echeance: '2099-01-02T10:00:00Z',
    entreprise: { id: 'e1', nom: 'Fonderie fictive' },
    instance: { slug: 'helioval', nom: 'Helioval', couleur: '#E3A33B' },
  }),
  sujet('s3', {
    type: 'a_valider',
    titre: 'Votre proposition',
    origine: 'os',
    proposition,
  }),
];
const traites = () => [
  sujet('s4', { statut: 'tache', tacheId: 't9', traiteAt: '2026-10-11T08:00:00Z' }),
  sujet('s5', {
    type: 'a_valider',
    titre: 'Proposition décidée',
    statut: 'traite',
    traiteAt: '2026-10-10T08:00:00Z',
    proposition: { ...proposition, statut: 'ecartee' },
  }),
];

// Successive states of the add conversation returned by the server.
let echanges: Record<string, unknown>[] = [];
const echange = (statut: string, extra: Record<string, unknown> = {}) => ({
  id: 'e1',
  statut,
  messages: [{ de: 'pilote', texte: 'Devis pour la société fictive avant jeudi', at: 'a' }],
  brouillon: null,
  erreur: null,
  demandeAt: new Date().toISOString(),
  ...extra,
});

let routineActive = true;
let derniereRoutine: unknown = null;
// Statuts returned by successive polls of the Inbox routine execution.
let statutsExecution: string[] = [];
const execution = (statut: string) => ({
  id: 'x1',
  routine: 'inbox',
  statut,
  demandePar: 'marc',
  debut: null,
  fin: null,
  createdAt: '2026-10-16T06:30:00Z',
  etapes: [],
  rapport: null,
});

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (url.includes('/contacts?q=')) return json([]);
  if (url.includes('/echanges')) {
    if (url.endsWith('/ajouter')) return json({ echange: echange('ajoute'), sujet: sujet('n2') });
    return json(
      echanges.length > 1 ? echanges.shift() : echanges[0],
      method === 'POST' ? 201 : 200,
    );
  }
  if (url.includes('/decision')) return json({ ...proposition, statut: 'appliquee' });
  if (url.endsWith('/tache'))
    return simulation
      ? json({ simulation: true, message: 'Simulation : rien n’a été écrit dans HubSpot.' }, 202)
      : json(sujet('s1', { statut: 'tache', tacheId: 't1' }), 201);
  if (url.endsWith('/routines'))
    return json([
      {
        cle: 'inbox',
        nom: 'Routine Inbox',
        etapes: [],
        skill: 'alimenter-inbox',
        actif: routineActive,
        params: {},
        rythme: 'Jours ouvrés à 6h30',
        derniere: derniereRoutine,
      },
    ]);
  if (url.endsWith('/routines/inbox/executions') && method === 'POST')
    return json(execution('demandee'), 201);
  if (url.includes('/executions/')) return json(execution(statutsExecution.shift() ?? 'terminee'));
  if (url.endsWith('/sujets') && method === 'POST')
    return json(sujet('n1', { type: 'autre' }), 201);
  if (method === 'POST') return json(sujet('s1', { statut: 'traite' }));
  if (url.includes('filtre=traites')) return json(traites());
  return json(liste());
}

const titres = () =>
  [...document.querySelectorAll('.vq-item .vq-titre')].map((b) => b.textContent ?? '');
const posts = () => calls.filter((c) => c.method === 'POST');

describe('Inbox screen', () => {
  beforeEach(() => {
    calls = [];
    simulation = false;
    routineActive = true;
    derniereRoutine = null;
    statutsExecution = [];
    echanges = [];
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('runs the Inbox routine, follows it, then reloads the list', async () => {
    statutsExecution = ['en_cours', 'terminee'];
    const onChange = vi.fn();
    render(<AvecEntete slug="simatis" onChange={onChange} />);
    await screen.findAllByText('Répondre à Hélène');
    fireEvent.click(await screen.findByRole('button', { name: "Mettre à jour l'Inbox" }));
    await waitFor(() =>
      expect(posts().map((c) => c.url)).toContain('/api/i/simatis/routines/inbox/executions'),
    );
    expect(
      (await screen.findByRole('button', { name: 'Mise à jour en cours…' })).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
    await screen.findByText('Inbox mise à jour.', {}, { timeout: 8000 });
    expect(onChange).toHaveBeenCalled();
    expect(calls.filter((c) => c.url.includes('/inbox?')).length).toBeGreaterThan(1);
    expect(
      screen.getByRole('button', { name: "Mettre à jour l'Inbox" }).hasAttribute('disabled'),
    ).toBe(false);
  }, 15000);

  it('shows no entry form and no add button of its own until the + asks for it', async () => {
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    expect(screen.queryByLabelText('Sujet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajouter' })).toBeNull();
  });

  it('sets the priority of a new entry in the form, and changes it on an existing one', async () => {
    render(<AvecEntete slug="simatis" ajoutOuvert onAjoutFerme={() => undefined} />);
    await screen.findAllByText('Répondre à Hélène');
    fireEvent.click(screen.getByRole('button', { name: 'Formulaire' }));
    fireEvent.change(screen.getByLabelText('Sujet'), { target: { value: 'Urgent fictif' } });
    // The form comes first in the page, the detail of the selected entry after it.
    const priorites = screen.getAllByLabelText('Priorité (5 = la plus haute)');
    fireEvent.change(priorites[0]!, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: "Ajouter à l'Inbox" }));
    await screen.findByText(/Entrée ajoutée/);
    expect(posts().find((c) => c.url === '/api/i/simatis/sujets')?.body).toMatchObject({
      titre: 'Urgent fictif',
      priorite: 5,
    });

    // The entry selected by default is the first one of the list (s1). Its fields open with the pencil.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Modifier l’échéance et la priorité' }),
    );
    fireEvent.change(screen.getByLabelText('Priorité (5 = la plus haute)'), {
      target: { value: '2' },
    });
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
        url: '/api/i/simatis/sujets/s1',
        body: { priorite: 2 },
      }),
    );
  });

  it('shows the priority as a gauge from 1 to 5, in the rows and the detail', async () => {
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    // Every entry of the list has its gauge; the detail of the first one has a second one.
    expect(screen.getAllByRole('img', { name: 'Priorité 3 sur 5' }).length).toBeGreaterThan(1);
  });

  it('adds an entry by hand, then reloads the list', async () => {
    const onChange = vi.fn();
    const onAjoutFerme = vi.fn();
    render(
      <AvecEntete slug="simatis" onChange={onChange} ajoutOuvert onAjoutFerme={onAjoutFerme} />,
    );
    await screen.findAllByText('Répondre à Hélène');
    fireEvent.click(screen.getByRole('button', { name: 'Formulaire' }));
    const envoi = screen.getByRole('button', { name: "Ajouter à l'Inbox" });
    expect(envoi.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Sujet'), {
      target: { value: '  Retour au client fictif  ' },
    });
    fireEvent.change(screen.getByLabelText('Détail (facultatif)'), {
      target: { value: 'Supports et visuels' },
    });
    fireEvent.change(screen.getByLabelText('Échéance (facultatif)'), {
      target: { value: '2026-10-23' },
    });
    fireEvent.click(envoi);
    await screen.findByText(/Entrée ajoutée/);
    const ajout = posts().find((c) => c.url === '/api/i/simatis/sujets');
    expect(ajout?.body).toMatchObject({
      titre: 'Retour au client fictif',
      resume: 'Supports et visuels',
    });
    expect((ajout?.body as { echeance: string }).echeance).toMatch(/^2026-10-23T/);
    expect(onChange).toHaveBeenCalled();
    expect(onAjoutFerme).toHaveBeenCalled();
  });

  it('prepares an entry with Claude, shows it, then adds it on click', async () => {
    const brouillon = {
      type: 'devis',
      titre: 'Faire le devis de la société fictive',
      resume: 'À envoyer au dirigeant.',
      echeance: '2026-10-22T10:00:00Z',
    };
    const claude = { de: 'claude', texte: 'Pour quelle échéance exactement ?', at: 'b' };
    echanges = [
      echange('attente_claude'),
      echange('en_cours'),
      echange('attente_pilote', {
        messages: [...echange('').messages, claude],
        brouillon,
      }),
    ];
    const onChange = vi.fn();
    render(<AvecEntete slug="simatis" onChange={onChange} ajoutOuvert />);
    await screen.findAllByText('Répondre à Hélène');
    // Claude is the mode offered first; the form is one click away.
    expect(screen.getByRole('button', { name: 'Avec Claude' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const ajouter = screen.getByRole('button', { name: "Ajouter à l'Inbox" });
    expect(ajouter.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Que faut-il ajouter ?'), {
      target: { value: 'Devis pour la société fictive avant jeudi' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à Claude' }));
    await waitFor(() =>
      expect(posts().find((c) => c.url === '/api/i/simatis/echanges')?.body).toEqual({
        texte: 'Devis pour la société fictive avant jeudi',
      }),
    );
    await screen.findByText('Transmis à Claude…');
    await screen.findByText('Pour quelle échéance exactement ?', {}, { timeout: 8000 });
    expect(screen.getByText('Faire le devis de la société fictive')).toBeTruthy();
    expect(screen.getByText('Échéance 22/10/2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Ajouter à l'Inbox" }));
    await screen.findByText(/Entrée ajoutée/);
    expect(posts().map((c) => c.url)).toContain('/api/i/simatis/echanges/e1/ajouter');
    expect(onChange).toHaveBeenCalled();
  }, 15000);

  it('answers Claude in the same conversation and shows why it failed', async () => {
    echanges = [
      echange('attente_pilote', { erreur: "Claude n'a pas répondu. Réécrivez votre message." }),
    ];
    render(<AvecEntete slug="simatis" ajoutOuvert />);
    await screen.findAllByText('Répondre à Hélène');
    fireEvent.change(screen.getByLabelText('Que faut-il ajouter ?'), {
      target: { value: 'Devis' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à Claude' }));
    await screen.findByText("Claude n'a pas répondu. Réécrivez votre message.");
    fireEvent.change(screen.getByLabelText('Votre réponse'), { target: { value: 'Jeudi 22' } });
    fireEvent.keyDown(screen.getByLabelText('Votre réponse'), { key: 'Enter' });
    await waitFor(() =>
      expect(posts().find((c) => c.url === '/api/i/simatis/echanges/e1/messages')?.body).toEqual({
        texte: 'Jeudi 22',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() =>
      expect(posts().map((c) => c.url)).toContain('/api/i/simatis/echanges/e1/annuler'),
    );
  });

  it('keeps the update button off while the Inbox routine is paused', async () => {
    routineActive = false;
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    expect(
      (await screen.findByRole('button', { name: "Mettre à jour l'Inbox" })).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
    expect(screen.getByText('Routine en pause')).toBeTruthy();
    // A square icon button: the name is for screen readers, nothing is written in it.
    expect(screen.getByRole('button', { name: "Mettre à jour l'Inbox" }).textContent).toBe('');
  });

  it('says the runner does not answer when a request stays untouched', async () => {
    derniereRoutine = execution('demandee');
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    await screen.findByText(/L'exécuteur ne répond pas/);
    expect(
      screen.getByRole('button', { name: 'Mise à jour en cours…' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('shows why an abandoned request failed and lets the button run again', async () => {
    derniereRoutine = {
      ...execution('echouee'),
      rapport: { fait: [], attente: [], echec: ["Abandonnée : l'exécuteur n'a pas répondu."] },
    };
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    await screen.findByText(/Abandonnée : l'exécuteur/);
    expect(
      screen.getByRole('button', { name: "Mettre à jour l'Inbox" }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('groups the list by urgency and filters on a counter', async () => {
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    // s1 is late, s2 is due later, s3 has no due date.
    expect(screen.getByRole('heading', { name: /En retard/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Plus tard/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Sans échéance/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Aujourd/ })).toBeNull();
    expect(screen.getByRole('button', { name: /En retard/ }).textContent).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: /En retard/ }));
    expect(titres()).toEqual(['Répondre à Hélène']);
    expect(screen.queryByRole('heading', { name: /Plus tard/ })).toBeNull();
    // A second click on the same counter shows everything again.
    fireEvent.click(screen.getByRole('button', { name: /En retard/ }));
    expect(titres()).toHaveLength(3);
  });

  it('shows the « Plus tard » urgency chip, so its entries can be found', async () => {
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    expect(screen.getByRole('button', { name: /Plus tard/ })).toBeTruthy();
  });

  it('offers the ways to order the entries in a menu, and no board view', async () => {
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    expect(screen.queryByRole('button', { name: 'Colonnes' })).toBeNull();
    const tri = screen.getByRole('combobox', { name: 'Trier les entrées' });
    expect(within(tri).getAllByRole('option')).toHaveLength(2);
    fireEvent.change(tri, { target: { value: 'arrivee' } });
    expect((tri as HTMLSelectElement).value).toBe('arrivee');
    expect(document.querySelectorAll('.vq-item').length).toBeGreaterThan(0);
  });

  it('shows one subject at a time with previous and next when the step mode is on', async () => {
    const { rerender } = render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    expect(screen.queryByText('1 / 3')).toBeNull();
    rerender(<AvecEntete slug="simatis" pasAPas />);
    expect(document.querySelectorAll('.vq-item')).toHaveLength(0);
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Précédent/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Devis Fonderie' })).toBeTruthy();
  });

  it('filters by type chips', async () => {
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    expect(calls[0]?.url).toBe('/api/i/simatis/inbox?filtre=tout');
    const type = screen.getByRole('combobox', { name: "Type d'entrée" });
    for (const filtre of [
      'mails',
      'devis',
      'diagnostics',
      'comptes_rendus',
      'a_valider',
      'traites',
    ]) {
      fireEvent.change(type, { target: { value: filtre } });
      await waitFor(() => expect(calls.at(-1)?.url).toBe(`/api/i/simatis/inbox?filtre=${filtre}`));
    }
  });

  it('keeps the order given by the server and marks overdue due dates in red', async () => {
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    expect(titres()).toEqual(['Répondre à Hélène', 'Devis Fonderie', 'Votre proposition']);
    const lignes = document.querySelectorAll('.vq-item');
    expect(lignes[0]?.querySelector('.echeance.red')).toBeTruthy();
    expect(lignes[1]?.querySelector('.echeance.red')).toBeNull();
    expect(lignes[0]?.textContent).toContain('Hélène Morvan');
  });

  it('checks a subject and reloads', async () => {
    const onChange = vi.fn();
    render(<AvecEntete slug="simatis" onChange={onChange} />);
    await screen.findAllByText('Répondre à Hélène');
    const cases = screen.getAllByRole('checkbox', { name: 'Marquer comme traité' });
    expect(cases).toHaveLength(2);
    fireEvent.click(cases[0] as HTMLElement);
    await waitFor(() => expect(posts()[0]?.url).toBe('/api/i/simatis/sujets/s1/traite'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(calls.filter((c) => c.url.includes('/inbox?')).length).toBeGreaterThan(1);
  });

  it('sends the action to the subject instance slug in the overview', async () => {
    render(<AvecEntete slug="simatis" />);
    fireEvent.click((await screen.findAllByText('Devis Fonderie'))[0] as HTMLElement);
    const detail = document.querySelector('.inbox-detail') as HTMLElement;
    fireEvent.click(within(detail).getByRole('button', { name: 'Marquer comme traité' }));
    await waitFor(() => expect(posts()[0]?.url).toBe('/api/i/helioval/sujets/s2/traite'));
    expect(document.querySelector('.vq-item .badge-instance')?.textContent).toBe('Helioval');
  });

  it('opens the source link of a subject', async () => {
    render(<AvecEntete slug="simatis" />);
    const lien = await screen.findByRole('link', { name: /Ouvrir la source/ });
    expect(lien.getAttribute('href')).toBe('https://mail.exemple.fr/fil/1');
    expect(lien.getAttribute('target')).toBe('_blank');
  });

  it('never renders a source link that is not a web address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify([sujet('x1', { lien: 'javascript:alert(1)' })])),
        ),
      ),
    );
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Sujet x1');
    expect(screen.queryByRole('link', { name: /Ouvrir la source/ })).toBeNull();
  });

  it('opens the task window prefilled and posts to sujets/:id/tache', async () => {
    render(<AvecEntete slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Transformer en tâche' }));
    expect(screen.getByLabelText<HTMLInputElement>('Intitulé').value).toBe('Répondre à Hélène');
    expect(screen.getByText(/Hélène Morvan/, { selector: '.field span' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(posts()[0]?.url).toBe('/api/i/simatis/sujets/s1/tache'));
    expect(posts()[0]?.body).toMatchObject({
      titre: 'Répondre à Hélène',
      echeance: expect.stringMatching(/^2020-01-02T10:00/) as unknown,
      contactId: 'c1',
    });
    expect(posts()[0]?.body).not.toHaveProperty('hubspot');
  });

  it('shows the simulation message and keeps the subject', async () => {
    simulation = true;
    render(<AvecEntete slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Transformer en tâche' }));
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    expect(await screen.findByText(/Simulation : rien n’a été écrit/)).toBeTruthy();
    expect(titres()).toContain('Répondre à Hélène');
  });

  it('filters the overview by mandate', async () => {
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    fireEvent.change(screen.getByLabelText('Mandat'), { target: { value: 'helioval' } });
    expect(titres()).toEqual(['Devis Fonderie']);
  });

  it('has no mandate filter in a mandate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              sujet('m1', { instance: { slug: 'helioval', nom: 'Helioval', couleur: null } }),
            ]),
          ),
        ),
      ),
    );
    render(<AvecEntete slug="helioval" />);
    await screen.findAllByText('Sujet m1');
    expect(screen.queryByLabelText('Mandat')).toBeNull();
  });

  it('shows treated subjects with their task and puts one back', async () => {
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    fireEvent.change(screen.getByRole('combobox', { name: "Type d'entrée" }), {
      target: { value: 'traites' },
    });
    expect((await screen.findByRole('link', { name: 'Voir la tâche' })).getAttribute('href')).toBe(
      '#/simatis/taches',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remettre à traiter' }));
    await waitFor(() => expect(posts()[0]?.url).toBe('/api/i/simatis/sujets/s4/a-traiter'));
  });

  it('shows a decided proposal with its decision, never to put back', async () => {
    render(<AvecEntete slug="simatis" />);
    await screen.findAllByText('Répondre à Hélène');
    fireEvent.change(screen.getByRole('combobox', { name: "Type d'entrée" }), {
      target: { value: 'traites' },
    });
    fireEvent.click((await screen.findAllByText('Proposition décidée'))[0] as HTMLElement);
    expect(await screen.findByText('Écarté par vous.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remettre à traiter' })).toBeNull();
  });

  it('shows the proposal safely and validates it with the edited text', async () => {
    const { container } = render(<AvecEntete slug="simatis" />);
    fireEvent.click((await screen.findAllByText('Votre proposition'))[0] as HTMLElement);
    expect(await screen.findByText('Créer le brouillon dans la boîte mail')).toBeTruthy();
    expect(container.querySelector('.mail-b')?.innerHTML).toBe('<p>Bonjour Madame Morvan,</p>');
    expect(screen.getByText('Pas de réponse au dernier message')).toBeTruthy();
    fireEvent.click(screen.getByText('Modifier le texte'));
    fireEvent.change(screen.getByLabelText('Texte du brouillon'), {
      target: { value: '<p>Nouveau texte</p>' },
    });
    fireEvent.click(screen.getByText('Créer le brouillon dans la boîte mail'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({
      url: '/api/i/simatis/propositions/p1/decision',
      body: {
        decision: 'valider',
        contenu: { corps: '<p>Nouveau texte</p>', objet: 'Votre proposition' },
      },
    });
  });

  it('discards a proposal without content', async () => {
    render(<AvecEntete slug="simatis" />);
    fireEvent.click((await screen.findAllByText('Votre proposition'))[0] as HTMLElement);
    fireEvent.click(await screen.findByText('Écarter'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toEqual({ decision: 'ecarter' });
  });
});
