import { useCallback, useEffect, useState } from 'react';
import { fetchFavoris, fetchInstances, saveFavoris } from './api.js';
import { Icon } from './icons.js';
import { allItems, reorderFavoris, toggleFavori, type InstanceSummary } from './nav.js';
import { AValider } from './pages/AValider.js';
import { Bientot } from './pages/Bientot.js';
import { Brief } from './pages/Brief.js';
import { Taches } from './pages/Taches.js';
import { Contacts } from './pages/Contacts.js';
import { Entreprises } from './pages/Entreprises.js';
import { Journal } from './pages/Journal.js';
import { Parametres } from './pages/Parametres.js';
import { Pipeline } from './pages/Pipeline.js';
import { Portefeuille } from './pages/Portefeuille.js';
import { Tableau } from './pages/Tableau.js';
import { Routines } from './pages/Routines.js';
import { Devis } from './pages/Devis.js';
import { RendezVous } from './pages/RendezVous.js';
import { Sidebar } from './shell/Sidebar.js';

const DEFAULT_VIEW = 'brief';

// Same URL scheme as the mockup: #/<instance>/<screen>.
function readHash(): { slug: string | null; view: string } {
  const m = /^#\/([\w-]+)\/([\w-]+)/.exec(location.hash);
  return m
    ? { slug: m[1] ?? null, view: m[2] ?? DEFAULT_VIEW }
    : { slug: null, view: DEFAULT_VIEW };
}

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
      : (allItems().find((i) => i.id === view)?.label ?? 'Écran inconnu');

  const page = () => {
    switch (view) {
      case 'entreprises':
        return <Entreprises key={current.slug} slug={current.slug} />;
      case 'contacts':
        return <Contacts key={current.slug} slug={current.slug} />;
      case 'taches':
        return <Taches key={current.slug} slug={current.slug} />;
      case 'brief':
        return <Brief key={current.slug} slug={current.slug} />;
      case 'validations':
        return <AValider key={current.slug} slug={current.slug} />;
      case 'pipeline':
        return <Pipeline key={current.slug} slug={current.slug} />;
      case 'routines':
        return <Routines key={current.slug} slug={current.slug} />;
      case 'agenda':
        return <RendezVous key={current.slug} slug={current.slug} />;
      case 'devis':
        return <Devis key={current.slug} slug={current.slug} />;
      case 'tableau':
        return <Tableau key={current.slug} slug={current.slug} />;
      case 'journal':
        return <Journal key={current.slug} slug={current.slug} />;
      case 'parametres':
        return <Parametres key={current.slug} slug={current.slug} onRenamed={loadInstances} />;
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
            <h1>{title}</h1>
          </div>
        </div>
        <div className="content">{page()}</div>
      </main>
    </div>
  );
}
