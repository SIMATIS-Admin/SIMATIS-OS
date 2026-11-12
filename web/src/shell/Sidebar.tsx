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
// Rubriques à pastille de notification : l'étoile n'y est pas proposée (elle chevauchait le compteur).
const SANS_ETOILE = ['agenda', 'cockpit', 'rendez-vous'];
// Prospection et Bases vivantes s'ouvrent depuis le Radar : lui seul est allumé dans le menu.
const SOUS_ECRANS_RADAR = ['prospection', 'bases'];
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
  // Sections fold and unfold; « Plus » starts folded, the others open.
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

  const actif = (it: NavItem) =>
    view === it.id || (it.id === 'radar' && SOUS_ECRANS_RADAR.includes(view));
  const link = (it: NavItem, inFavoris = false, index = -1) => {
    const fav = favoris.includes(it.id);
    const dragProps = inFavoris
      ? {
          draggable: true,
          title: reduite ? it.label : 'Glisser pour réordonner',
          onDragStart: (e: DragEvent) => e.dataTransfer.setData(FAV_MIME, it.id),
          onDragOver: (e: DragEvent) => {
            if (e.dataTransfer.types.includes(FAV_MIME)) e.preventDefault();
          },
          onDrop: (e: DragEvent<HTMLDivElement>) => {
            const id = e.dataTransfer.getData(FAV_MIME);
            if (!id) return;
            e.preventDefault();
            const box = e.currentTarget.getBoundingClientRect();
            onMoveFavori(id, it.id, e.clientY > box.top + box.height / 2);
          },
        }
      : {};
    return (
      <div key={`${inFavoris ? 'fav-' : ''}${it.id}`} className="nav-entry" {...dragProps}>
        <a
          href={`#/${current.slug}/${it.id}`}
          className={[actif(it) ? 'on' : '', isBuilt(it.id) ? '' : 'soon'].join(' ')}
          title={reduite ? it.label : undefined}
          aria-current={actif(it) ? 'page' : undefined}
        >
          <Icon name={it.icon} />
          <span className="lbl">{it.label}</span>
          {it.beta && <span className="beta">Bêta</span>}
          {(compteurs[it.id] ?? 0) > 0 && <span className="pastille">{compteurs[it.id]}</span>}
          {!isBuilt(it.id) && <span className="soon-tag">Bientôt</span>}
        </a>
        {!SANS_ETOILE.includes(it.id) && (
          <button
            type="button"
            className={`fav ${fav ? 'on' : ''}`}
            aria-label={fav ? `Retirer ${it.label} des favoris` : `Ajouter ${it.label} aux favoris`}
            title={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            onClick={() => onToggleFavori(it.id)}
          >
            <Icon name="star" />
          </button>
        )}
        {inFavoris && index > 0 && (
          <button
            type="button"
            className="fav-order up"
            aria-label={`Monter ${it.label}`}
            onClick={() => onMoveFavori(it.id, favItems[index - 1]!.id, false)}
          >
            <Icon name="down" />
          </button>
        )}
        {inFavoris && index < favItems.length - 1 && (
          <button
            type="button"
            className="fav-order down"
            aria-label={`Descendre ${it.label}`}
            onClick={() => onMoveFavori(it.id, favItems[index + 1]!.id, true)}
          >
            <Icon name="down" />
          </button>
        )}
      </div>
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
          className="recharger-btn"
          aria-label="Recharger l'OS"
          title="Recharger l'OS (récupérer la dernière version)"
          onClick={() => window.location.reload()}
        >
          <Icon name="refresh" />
        </button>
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
      <nav className="nav" aria-label="Navigation principale">
        {favItems.length > 0 && (
          <div className="nav-group favs">
            <span>
              <Icon name="star" />
              Mes raccourcis
            </span>
            {favItems.map((it, index) => link(it, true, index))}
          </div>
        )}
        {NAV.map((g) => {
          const items = g.items.filter(
            (it) =>
              allowed(it, current.modules) && !it.masque && !favItems.some((f) => f.id === it.id),
          );
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
      {current.type === 'propre' &&
        (current.modules.includes('cerveau') || current.modules.includes('gestion')) && (
          <div className="nav side-feuille">
            {current.modules.includes('gestion') && (
              <a
                href={`#/${current.slug}/gestion`}
                className={view === 'gestion' ? 'on' : ''}
                title={reduite ? 'Gestion' : undefined}
              >
                <Icon name="wallet" />
                <span className="lbl">Gestion</span>
              </a>
            )}
            {current.modules.includes('cerveau') && (
              <a
                href={`#/${current.slug}/feuille-de-route-os`}
                className={view === 'feuille-de-route-os' ? 'on' : ''}
                title={reduite ? 'Feuille de route de l’OS' : undefined}
              >
                <Icon name="map" />
                <span className="lbl">Feuille de route de l’OS</span>
              </a>
            )}
          </div>
        )}
    </aside>
  );
}
