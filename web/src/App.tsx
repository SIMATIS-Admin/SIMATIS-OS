import { useEffect, useState } from 'react';
import { fetchInstances } from './api.js';
import { Icon } from './icons.js';
import { allItems, type InstanceSummary } from './nav.js';
import { Bientot } from './pages/Bientot.js';
import { Contacts } from './pages/Contacts.js';
import { Entreprises } from './pages/Entreprises.js';
import { Sidebar } from './shell/Sidebar.js';

const DEFAULT_VIEW = 'entreprises';

// Same URL scheme as the mockup: #/<instance>/<screen>.
function readHash(): { slug: string | null; view: string } {
  const m = /^#\/([\w-]+)\/([\w-]+)/.exec(location.hash);
  return m
    ? { slug: m[1] ?? null, view: m[2] ?? DEFAULT_VIEW }
    : { slug: null, view: DEFAULT_VIEW };
}

export function App() {
  const [instances, setInstances] = useState<InstanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState(readHash);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetchInstances().then(setInstances, (e: unknown) => setError(String(e)));
    const onHash = () => {
      setRoute(readHash());
      setMenuOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (error) return <p className="empty">Impossible de joindre l'OS : {error}</p>;
  if (!instances) return null;
  if (instances.length === 0) return <p className="empty">Aucune instance.</p>;

  const current = instances.find((i) => i.slug === route.slug) ?? instances[0];
  if (!current) return null;
  const view = route.view;
  const title = allItems().find((i) => i.id === view)?.label ?? 'Écran inconnu';

  return (
    <div className="app">
      <Sidebar instances={instances} current={current} view={view} open={menuOpen} />
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
        <div className="content">
          {view === 'entreprises' ? (
            <Entreprises key={current.slug} slug={current.slug} />
          ) : view === 'contacts' ? (
            <Contacts key={current.slug} slug={current.slug} />
          ) : (
            <Bientot view={view} />
          )}
        </div>
      </main>
    </div>
  );
}
