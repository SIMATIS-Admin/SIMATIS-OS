import type { ReactNode } from 'react';
import { Icon } from '../icons.js';

// Side drawer and centred modal, same markup as the mockup (core.js overlay).
export function Drawer({
  head,
  label,
  onClose,
  children,
}: {
  head: ReactNode;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={label}>
        <div className="drawer-h">
          <div>{head}</div>
          <button className="btn ghost" aria-label="Fermer" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="drawer-b">{children}</div>
      </aside>
    </>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-label={title}>
        <div className="panel-h">
          <h2>{title}</h2>
          <button className="btn ghost" aria-label="Fermer" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="panel-b">{children}</div>
      </div>
    </>
  );
}
