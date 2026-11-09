import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  fetchCompteurInbox,
  fetchCompteurRdv,
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
import { Barre } from './shell/Barre.js';
import { Console } from './shell/Console.js';
import type { KindFiche } from './api.js';
import { Contacts } from './pages/Contacts.js';
import { Entreprises } from './pages/Entreprises.js';
import { Pipeline } from './pages/Pipeline.js';
import { Sidebar } from './shell/Sidebar.js';

const Agenda = lazy(() => import('./pages/Agenda.js').then((m) => ({ default: m.Agenda })));
const Atelier = lazy(() => import('./pages/Atelier.js').then((m) => ({ default: m.Atelier })));
const Bases = lazy(() => import('./pages/Bases.js').then((m) => ({ default: m.Bases })));
const Bientot = lazy(() => import('./pages/Bientot.js').then((m) => ({ default: m.Bientot })));
const Brief = lazy(() => import('./pages/Brief.js').then((m) => ({ default: m.Brief })));
const Cerveau = lazy(() => import('./pages/Cerveau.js').then((m) => ({ default: m.Cerveau })));
const Devis = lazy(() => import('./pages/Devis.js').then((m) => ({ default: m.Devis })));
const Diagnostics = lazy(() =>
  import('./pages/Diagnostics.js').then((m) => ({ default: m.Diagnostics })),
);
const FeuilleDeRouteOS = lazy(() =>
  import('./pages/FeuilleDeRouteOS.js').then((m) => ({ default: m.FeuilleDeRouteOS })),
);
const Fiche = lazy(() => import('./pages/Fiche.js').then((m) => ({ default: m.Fiche })));
const FicheRdv = lazy(() => import('./pages/FicheRdv.js').then((m) => ({ default: m.FicheRdv })));
const Gestion = lazy(() => import('./pages/Gestion.js').then((m) => ({ default: m.Gestion })));
const Inbox = lazy(() => import('./pages/Inbox.js').then((m) => ({ default: m.Inbox })));
const Journal = lazy(() => import('./pages/Journal.js').then((m) => ({ default: m.Journal })));
const Parametres = lazy(() =>
  import('./pages/Parametres.js').then((m) => ({ default: m.Parametres })),
);
const Portefeuille = lazy(() =>
  import('./pages/Portefeuille.js').then((m) => ({ default: m.Portefeuille })),
);
const PresentationDiagnostic = lazy(() =>
  import('./pages/PresentationDiagnostic.js').then((m) => ({ default: m.PresentationDiagnostic })),
);
const Prospection = lazy(() =>
  import('./pages/Prospection.js').then((m) => ({ default: m.Prospection })),
);
const RendezVous = lazy(() =>
  import('./pages/RendezVous.js').then((m) => ({ default: m.RendezVous })),
);
const Routines = lazy(() => import('./pages/Routines.js').then((m) => ({ default: m.Routines })));
const SiteWeb = lazy(() => import('./pages/SiteWeb.js').then((m) => ({ default: m.SiteWeb })));
const Tableau = lazy(() => import('./pages/Tableau.js').then((m) => ({ default: m.Tableau })));

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
  // Un outil ouvert (diagnostic, test) donne son nom à l'en-tête à la place de celui de la section.
  const [titreOutil, setTitreOutil] = useState<string | null>(null);
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
        fetchCompteurRdv(slugCourant).catch(() => 0),
      ]).then(([taches, inbox, rdv]) =>
        setCompteurs({ agenda: taches, inbox, 'rendez-vous': rdv }),
      );
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
  if (!instances)
    return (
      <p className="empty" role="status" aria-live="polite">
        Chargement de SIMATIS OS…
      </p>
    );
  if (instances.length === 0) return <p className="empty">Aucune instance.</p>;

  const current = instances.find((i) => i.slug === route.slug) ?? instances[0];
  if (!current) return null;
  const view = route.view;
  const title =
    view === 'portefeuille'
      ? 'Portefeuille'
      : view === 'fiche'
        ? (TITRES_FICHE[route.kind ?? ''] ?? 'Fiche')
        : view === 'presentation-diagnostic'
          ? 'Diagnostic d’endurance commerciale : présentation'
          : view === 'feuille-de-route-os'
            ? 'Feuille de route de l’OS'
            : view === 'gestion'
              ? 'Gestion'
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
        return (
          <Diagnostics
            key={`${current.slug}-${route.id ?? ''}`}
            slug={current.slug}
            ouvrirTest={route.kind === 'test' ? route.id : undefined}
            ouvrir={route.kind === 'ouvrir' ? route.id : undefined}
            onTitre={setTitreOutil}
          />
        );
      case 'atelier':
        return (
          <Atelier
            key={`${current.slug}-${route.kind === 'ouvrir' ? route.id : ''}`}
            slug={current.slug}
            ouvrir={route.kind === 'ouvrir' ? route.id : undefined}
            onTitre={setTitreOutil}
          />
        );
      case 'presentation-diagnostic':
        return <PresentationDiagnostic />;
      case 'bases':
        return <Bases key={current.slug} slug={current.slug} />;
      case 'prospection':
        return (
          <Prospection
            key={`${current.slug}-${route.kind === 'ouvrir' ? route.id : ''}`}
            slug={current.slug}
            ouvrir={route.kind === 'ouvrir' ? route.id : undefined}
          />
        );
      case 'siteweb':
        return <SiteWeb key={current.slug} slug={current.slug} />;
      case 'tableau':
        return <Tableau key={current.slug} slug={current.slug} />;
      case 'cerveau':
        return (
          <Cerveau key={current.slug} slug={current.slug} seulPartage={current.type !== 'propre'} />
        );
      case 'gestion':
        return (
          <Gestion
            key={current.slug}
            slug={current.slug}
            autorise={current.type === 'propre' && current.modules.includes('gestion')}
            mandats={instances
              .filter((i) => i.type === 'mandat')
              .map((i) => ({ slug: i.slug, nom: i.nom }))}
          />
        );
      case 'feuille-de-route-os':
        return (
          <FeuilleDeRouteOS
            key={current.slug}
            slug={current.slug}
            autorise={current.type === 'propre' && current.modules.includes('cerveau')}
          />
        );
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
    <div className="app" data-view={view}>
      <Sidebar
        instances={instances}
        current={current}
        view={
          view === 'fiche'
            ? ({
                contact: 'contacts',
                entreprise: 'entreprises',
                affaire: 'pipeline',
                rdv: 'rendez-vous',
              }[route.kind ?? ''] ?? view)
            : view
        }
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
            <h1>
              {(view === 'diagnostics' || view === 'atelier') && titreOutil ? titreOutil : title}
            </h1>
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
        <div className="content">
          <Suspense
            fallback={
              <div className="empty" role="status" aria-live="polite">
                Chargement de l’espace…
              </div>
            }
          >
            {page()}
          </Suspense>
        </div>
        {view !== 'portefeuille' && <Console key={current.slug} slug={current.slug} />}
      </main>
    </div>
  );
}
