import { useState, type DragEvent } from 'react';
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
  onToggleFavori: (id: string) => void;
  onMoveFavori: (id: string, cibleId: string, apres: boolean) => void;
};

// Own MIME type, so a favourite is never mistaken for a pipeline card.
const FAV_MIME = 'application/x-simatis-fav';

export function Sidebar({
  instances,
  current,
  view,
  open,
  favoris,
  onToggleFavori,
  onMoveFavori,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);

  const link = (it: NavItem, inFavoris = false) => {
    const fav = favoris.includes(it.id);
    const dragProps = inFavoris
      ? {
          draggable: true,
          title: 'Glisser pour réordonner',
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
        {...dragProps}
      >
        <Icon name={it.icon} />
        <span className="lbl">{it.label}</span>
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
    <aside className={`side ${open ? 'open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">S</div>
        <div className="brand-name">
          SIMATIS <span>OS</span>
        </div>
      </div>
      <button className="inst-btn" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
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
          if (g.later) {
            const shown = laterOpen || items.some((it) => it.id === view);
            return (
              <div key={g.title} className="nav-group later">
                <button
                  className="later-btn"
                  aria-expanded={shown}
                  onClick={() => setLaterOpen(!laterOpen)}
                >
                  {g.title}
                  <span className={`chev ${shown ? 'open' : ''}`}>
                    <Icon name="down" />
                  </span>
                </button>
                {shown && items.map((it) => link(it))}
              </div>
            );
          }
          return (
            <div key={g.title} className="nav-group">
              <span>{g.title}</span>
              {items.map((it) => link(it))}
            </div>
          );
        })}
      </nav>
      <div className="side-foot">Données fictives de la maquette.</div>
    </aside>
  );
}
