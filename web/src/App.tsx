import { useCallback, useEffect, useState } from 'react';
import {
  fetchCompteurInbox,
  fetchCompteurTaches,
  fetchFavoris,
  fetchInstances,
  saveFavoris,
} from './api.js';
import { Icon } from './icons.js';
import {
  allItems,
  reorderFavoris,
  toggleFavori,
  vueCanonique,
  type InstanceSummary,
} from './nav.js';
import { Inbox } from './pages/Inbox.js';
import { Bientot } from './pages/Bientot.js';
import { Brief } from './pages/Brief.js';
import { Fiche } from './pages/Fiche.js';
import { FicheRdv } from './pages/FicheRdv.js';
import { Barre } from './shell/Barre.js';
import { Console } from './shell/Console.js';
import type { KindFiche } from './api.js';
import { Agenda } from './pages/Agenda.js';
import { RendezVous } from './pages/RendezVous.js';
import { Contacts } from './pages/Contacts.js';
import { Entreprises } from './pages/Entreprises.js';
import { Journal } from './pages/Journal.js';
import { Parametres } from './pages/Parametres.js';
import { Pipeline } from './pages/Pipeline.js';
import { Portefeuille } from './pages/Portefeuille.js';
import { Tableau } from './pages/Tableau.js';
import { Routines } from './pages/Routines.js';
import { Devis } from './pages/Devis.js';
import { Diagnostics } from './pages/Diagnostics.js';
import { SiteWeb } from './pages/SiteWeb.js';
import { Sidebar } from './shell/Sidebar.js';

const DEFAULT_VIEW = 'brief';

// Same URL scheme as the mockup: #/<instance>/<screen>.
// `#/<slug>/<view>`, or `#/<slug>/fiche/<kind>/<id>` for a detail page.
function readHash(): { slug: string | null; view: string; kind?: string; id?: string } {
  const m = /^#\/([\w-]+)\/([\w-]+)(?:\/([\w-]+)\/([^/?#]+))?/.exec(location.hash);
  if (!m) return { slug: null, view: DEFAULT_VIEW };
  const view = vueCanonique(m[2] ?? DEFAULT_VIEW);
  if (m[1] && view !== m[2]) history.replaceState(null, '', `#/${m[1]}/${view}`);
  // A calendar event id is not always plain letters and digits: links carry it encoded.
  let id = m[4];
  try {
    if (id) id = decodeURIComponent(id);
  } catch {
    // Left as written.
  }
  return { slug: m[1] ?? null, view, kind: m[3], id };
}
const KINDS_FICHE = ['affaire', 'contact', 'entreprise'];
const TITRES_FICHE: Record<string, string> = {
  affaire: 'Affaire',
  contact: 'Contact',
  entreprise: 'Organisation',
  rdv: 'Rendez-vous',
};

export function App() {
  const [instances, setInstances] = useState<InstanceSummary[] | null>(null);
  const [favoris, setFavoris] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState(readHash);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadInstances = useCallback(() => {
    fetchInstances().then(setInstances, (e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    loadInstances();
    fetchFavoris().then(setFavoris, () => setFavoris([]));
    const onHash = () => {
      setRoute(readHash());
      setMenuOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [loadInstances]);

  const slugCourant = instances
    ? (instances.find((i) => i.slug === route.slug) ?? instances[0])?.slug
    : undefined;
  const [compteurs, setCompteurs] = useState<Record<string, number>>({});
  // Bumped by the Inbox after an action, so the menu counter follows at once.
  const [recharge, setRecharge] = useState(0);
  // The « + » beside the Inbox title opens the manual entry form; it never stays open across screens.
  const [ajoutInbox, setAjoutInbox] = useState(false);
  useEffect(() => setAjoutInbox(false), [route.view, slugCourant]);
  // Subject by subject mode of the Inbox, switched by the button beside the « + ».
  const [pasAPasInbox, setPasAPasInbox] = useState(false);
  // Header slots of the Inbox: the update button goes left of the title, the mandate filter right of « Pas à pas ».
  const [enteteGauche, setEnteteGauche] = useState<HTMLSpanElement | null>(null);
  const [enteteDroite, setEnteteDroite] = useState<HTMLSpanElement | null>(null);
  useEffect(() => setPasAPasInbox(false), [route.view, slugCourant]);
  useEffect(() => {
    if (!slugCourant || route.view === 'portefeuille') return setCompteurs({});
    const charger = () =>
      Promise.all([
        fetchCompteurTaches(slugCourant).catch(() => 0),
        fetchCompteurInbox(slugCourant).catch(() => 0),
      ]).then(([taches, inbox]) => setCompteurs({ agenda: taches, inbox }));
    void charger();
    const minuteur = window.setInterval(() => void charger(), 5 * 60_000);
    return () => window.clearInterval(minuteur);
  }, [slugCourant, route.view, recharge]);

  // Optimistic: the menu changes at once, then follows what the server kept.
  const updateFavoris = (next: string[]) => {
    setFavoris(next);
    saveFavoris(next).then(setFavoris, () => undefined);
  };

  if (error) return <p className="empty">Impossible de joindre l'OS : {error}</p>;
  if (!instances) return null;
  if (instances.length === 0) return <p className="empty">Aucune instance.</p>;

  const current = instances.find((i) => i.slug === route.slug) ?? instances[0];
  if (!current) return null;
  const view = route.view;
  const title =
    view === 'portefeuille'
      ? 'Portefeuille'
      : view === 'fiche'
        ? (TITRES_FICHE[route.kind ?? ''] ?? 'Fiche')
        : (allItems().find((i) => i.id === view)?.label ?? 'Écran inconnu');

  const page = () => {
    switch (view) {
      case 'entreprises':
        return <Entreprises key={current.slug} slug={current.slug} />;
      case 'contacts':
        return <Contacts key={current.slug} slug={current.slug} />;
      case 'brief':
        return <Brief key={current.slug} slug={current.slug} />;
      case 'inbox':
        return (
          <Inbox
            key={current.slug}
            slug={current.slug}
            onChange={() => setRecharge((n) => n + 1)}
            ajoutOuvert={ajoutInbox}
            onAjoutFerme={() => setAjoutInbox(false)}
            pasAPas={pasAPasInbox}
            entete={{ gauche: enteteGauche, droite: enteteDroite }}
          />
        );
      case 'pipeline':
        return <Pipeline key={current.slug} slug={current.slug} />;
      case 'routines':
        return <Routines key={current.slug} slug={current.slug} />;
      case 'agenda':
        return <Agenda key={current.slug} slug={current.slug} />;
      case 'rendez-vous':
        // « ouvrir » + identifiant : la ligne du rendez-vous s'ouvre directement.
        return (
          <RendezVous
            key={current.slug}
            slug={current.slug}
            ouvrir={route.kind === 'ouvrir' ? route.id : undefined}
          />
        );
      case 'devis':
        return <Devis key={current.slug} slug={current.slug} />;
      case 'diagnostics':
        return <Diagnostics key={current.slug} slug={current.slug} />;
      case 'siteweb':
        return <SiteWeb key={current.slug} slug={current.slug} />;
      case 'tableau':
        return <Tableau key={current.slug} slug={current.slug} />;
      case 'journal':
        return <Journal key={current.slug} slug={current.slug} />;
      case 'parametres':
        return <Parametres key={current.slug} slug={current.slug} onRenamed={loadInstances} />;
      case 'fiche':
        if (route.kind === 'rdv' && route.id)
          return (
            <FicheRdv key={`${current.slug}-rdv-${route.id}`} slug={current.slug} id={route.id} />
          );
        return route.kind && KINDS_FICHE.includes(route.kind) && route.id ? (
          <Fiche
            key={`${current.slug}-${route.kind}-${route.id}`}
            slug={current.slug}
            kind={route.kind as KindFiche}
            id={route.id}
          />
        ) : (
          <Bientot view={view} />
        );
      case 'portefeuille':
        return <Portefeuille instances={instances} onCreated={loadInstances} />;
      default:
        return <Bientot view={view} />;
    }
  };

  return (
    <div className="app">
      <Sidebar
        instances={instances}
        current={current}
        view={view}
        open={menuOpen}
        favoris={favoris}
        compteurs={compteurs}
        onToggleFavori={(id) => updateFavoris(toggleFavori(favoris, id))}
        onMoveFavori={(id, cible, apres) =>
          updateFavoris(reorderFavoris(favoris, id, cible, apres))
        }
      />
      <main className="main">
        <div className="top">
          <div>
            <button
              className="btn ghost menu-btn"
              aria-label="Menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Icon name="menu" />
            </button>
            {view === 'inbox' && <span className="entete-slot" ref={setEnteteGauche} />}
            <h1>{title}</h1>
            {view === 'inbox' && (
              <button
                className="btn carre"
                aria-label="Ajouter une entrée à l'Inbox"
                title="Ajouter une entrée"
                onClick={() => setAjoutInbox(true)}
              >
                <Icon name="inbox" />
                <span className="carre-plus" aria-hidden="true">
                  +
                </span>
              </button>
            )}
            {view === 'inbox' && (
              <button
                className={`btn sm ${pasAPasInbox ? '' : 'primary'}`}
                aria-pressed={pasAPasInbox}
                onClick={() => setPasAPasInbox(!pasAPasInbox)}
              >
                {pasAPasInbox ? 'Quitter le pas à pas' : 'Pas à pas'}
              </button>
            )}
            {view === 'inbox' && <span className="entete-slot" ref={setEnteteDroite} />}
          </div>
          {view !== 'portefeuille' && <Barre key={current.slug} slug={current.slug} />}
        </div>
        <div className="content">{page()}</div>
        {view !== 'portefeuille' && <Console key={current.slug} slug={current.slug} />}
      </main>
    </div>
  );
}
