import { useState, type DragEvent } from 'react';
import logo from '../assets/simatis-mark.png';
import { Icon } from '../icons.js';
import {
  NAV,
  allItems,
  allowed,
  groupInstances,
  isBuilt,
  type InstanceSummary,
  type NavItem,
} from '../nav.js';

type Props = {
  instances: InstanceSummary[];
  current: InstanceSummary;
  view: string;
  open: boolean;
  favoris: string[];
  // Red badge per menu entry (Pipedrive: activities overdue or due today).
  compteurs?: Record<string, number>;
  onToggleFavori: (id: string) => void;
  onMoveFavori: (id: string, cibleId: string, apres: boolean) => void;
};

// Own MIME type, so a favourite is never mistaken for a pipeline card.
const FAV_MIME = 'application/x-simatis-fav';
// Which sections are folded, kept on this screen between visits.
const CLE_OUVERTS = 'simatis.nav.ouverts';
// Narrow icon-only bar, also kept on this screen.
const CLE_REDUITE = 'simatis.nav.reduite';
const memoriser = (cle: string, valeur: string) => {
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    // Private window: the choice lasts for this visit only.
  }
};
const lireReduite = () => {
  try {
    return localStorage.getItem(CLE_REDUITE) === '1';
  } catch {
    return false;
  }
};
const lireOuverts = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(CLE_OUVERTS) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
};

export function Sidebar({
  instances,
  current,
  view,
  open,
  favoris,
  compteurs = {},
  onToggleFavori,
  onMoveFavori,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Sections fold and unfold; « Plus tard » starts folded, the others open.
  const [ouverts, setOuverts] = useState(lireOuverts);
  const basculer = (titre: string, ouvert: boolean) => {
    const suivant = { ...ouverts, [titre]: !ouvert };
    setOuverts(suivant);
    memoriser(CLE_OUVERTS, JSON.stringify(suivant));
  };
  const [reduite, setReduite] = useState(lireReduite);
  const basculerReduite = () => {
    setReduite(!reduite);
    memoriser(CLE_REDUITE, reduite ? '0' : '1');
  };

  const link = (it: NavItem, inFavoris = false) => {
    const fav = favoris.includes(it.id);
    const dragProps = inFavoris
      ? {
          draggable: true,
          title: reduite ? it.label : 'Glisser pour réordonner',
          onDragStart: (e: DragEvent) => e.dataTransfer.setData(FAV_MIME, it.id),
          onDragOver: (e: DragEvent) => {
            if (e.dataTransfer.types.includes(FAV_MIME)) e.preventDefault();
          },
          onDrop: (e: DragEvent<HTMLAnchorElement>) => {
            const id = e.dataTransfer.getData(FAV_MIME);
            if (!id) return;
            e.preventDefault();
            const box = e.currentTarget.getBoundingClientRect();
            onMoveFavori(id, it.id, e.clientY > box.top + box.height / 2);
          },
        }
      : {};
    return (
      <a
        key={`${inFavoris ? 'fav-' : ''}${it.id}`}
        href={`#/${current.slug}/${it.id}`}
        className={[view === it.id ? 'on' : '', isBuilt(it.id) ? '' : 'soon'].join(' ')}
        title={reduite ? it.label : undefined}
        {...dragProps}
      >
        <Icon name={it.icon} />
        <span className="lbl">{it.label}</span>
        {(compteurs[it.id] ?? 0) > 0 && <span className="pastille">{compteurs[it.id]}</span>}
        {!isBuilt(it.id) && <span className="soon-tag">Bientôt</span>}
        <span
          className={`fav ${fav ? 'on' : ''}`}
          role="button"
          title={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          onClick={(e) => {
            e.preventDefault();
            onToggleFavori(it.id);
          }}
        >
          <Icon name="star" />
        </span>
      </a>
    );
  };

  const favItems = favoris
    .map((id) => allItems().find((it) => it.id === id))
    .filter((it): it is NavItem => !!it && allowed(it, current.modules));
  const isPortefeuille = view === 'portefeuille';

  return (
    <aside className={['side', open ? 'open' : '', reduite ? 'reduite' : ''].join(' ')}>
      <div className="brand">
        <img className="brand-mark" src={logo} alt="SIMATIS" />
        <div className="brand-name">
          SIMATIS <span>OS</span>
        </div>
        <button
          className="reduire-btn"
          aria-label={reduite ? 'Agrandir le menu' : 'Réduire le menu'}
          title={reduite ? 'Agrandir le menu' : 'Réduire le menu'}
          onClick={basculerReduite}
        >
          <Icon name="panel" />
        </button>
      </div>
      <button
        className="inst-btn"
        aria-expanded={menuOpen}
        title={reduite ? (isPortefeuille ? 'Portefeuille' : current.nom) : undefined}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <span
          className="inst-dot"
          style={{ background: isPortefeuille ? 'var(--mint)' : current.couleur }}
        />
        <span>
          <b>{isPortefeuille ? 'Portefeuille' : current.nom}</b>
          <small>{isPortefeuille ? 'Toutes les instances' : current.sous}</small>
        </span>
        <span className="chev">
          <Icon name="down" />
        </span>
      </button>
      {menuOpen && (
        <div className="inst-menu" role="menu">
          {groupInstances(instances).map((g) => (
            <div key={g.type}>
              <div className="inst-sec">{g.label}</div>
              {g.instances.map((i) => (
                <button
                  key={i.slug}
                  className={i.slug === current.slug && !isPortefeuille ? 'on' : ''}
                  onClick={() => {
                    setMenuOpen(false);
                    location.hash = `#/${i.slug}/${isPortefeuille ? 'entreprises' : view}`;
                  }}
                >
                  <span className="inst-dot" style={{ background: i.couleur }} />
                  <span>
                    <b>{i.nom}</b>
                    <small>{i.sous}</small>
                  </span>
                </button>
              ))}
            </div>
          ))}
          <hr />
          <button
            onClick={() => {
              setMenuOpen(false);
              location.hash = `#/${current.slug}/portefeuille`;
            }}
          >
            <span className="inst-dot" style={{ background: 'var(--navy)' }} />
            <span>
              <b>Portefeuille</b>
              <small>Vue transversale, compteurs seulement</small>
            </span>
          </button>
        </div>
      )}
      <nav className="nav">
        {favItems.length > 0 && (
          <div className="nav-group favs">
            <span>
              <Icon name="star" />
              Favoris
            </span>
            {favItems.map((it) => link(it, true))}
          </div>
        )}
        {NAV.map((g) => {
          const items = g.items.filter((it) => allowed(it, current.modules));
          if (items.length === 0) return null;
          const ouvert = ouverts[g.title] ?? !g.later;
          return (
            <div key={g.title} className={`nav-group ${g.later ? 'later' : ''}`}>
              <button
                className="later-btn"
                aria-expanded={ouvert}
                onClick={() => basculer(g.title, ouvert)}
              >
                {g.title}
                <span className={`chev ${ouvert ? 'open' : ''}`}>
                  <Icon name="down" />
                </span>
              </button>
              {ouvert && items.map((it) => link(it))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
