import { useState } from 'react';
import { Icon } from '../icons.js';
import { NAV, allowed, groupInstances, isBuilt, type InstanceSummary } from '../nav.js';

type Props = {
  instances: InstanceSummary[];
  current: InstanceSummary;
  view: string;
  open: boolean;
};

export function Sidebar({ instances, current, view, open }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);

  const link = (id: string, label: string, icon: string) => (
    <a
      key={id}
      href={`#/${current.slug}/${id}`}
      className={[view === id ? 'on' : '', isBuilt(id) ? '' : 'soon'].join(' ')}
    >
      <Icon name={icon} />
      <span className="lbl">{label}</span>
      {!isBuilt(id) && <span className="soon-tag">Bientôt</span>}
    </a>
  );

  return (
    <aside className={`side ${open ? 'open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">S</div>
        <div className="brand-name">
          SIMATIS <span>OS</span>
        </div>
      </div>
      <button className="inst-btn" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
        <span className="inst-dot" style={{ background: current.couleur }} />
        <span>
          <b>{current.nom}</b>
          <small>{current.sous}</small>
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
                  className={i.slug === current.slug ? 'on' : ''}
                  onClick={() => {
                    setMenuOpen(false);
                    location.hash = `#/${i.slug}/${view}`;
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
        </div>
      )}
      <nav className="nav">
        {NAV.map((g) => {
          const items = g.items.filter((it) => allowed(it, current.modules));
          if (items.length === 0) return null;
          if (g.later) {
            return (
              <div key={g.title} className="nav-group later">
                <button
                  className="later-btn"
                  aria-expanded={laterOpen}
                  onClick={() => setLaterOpen(!laterOpen)}
                >
                  {g.title}
                  <span className={`chev ${laterOpen ? 'open' : ''}`}>
                    <Icon name="down" />
                  </span>
                </button>
                {laterOpen && items.map((it) => link(it.id, it.label, it.icon))}
              </div>
            );
          }
          return (
            <div key={g.title} className="nav-group">
              <span>{g.title}</span>
              {items.map((it) => link(it.id, it.label, it.icon))}
            </div>
          );
        })}
      </nav>
      <div className="side-foot">Itération 1 : données fictives de la maquette.</div>
    </aside>
  );
}
