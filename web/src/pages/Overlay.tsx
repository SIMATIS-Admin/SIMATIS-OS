import type { ReactNode } from 'react';
import { Icon } from '../icons.js';
import { useDialogFocus } from './useDialogFocus.js';

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
  const ref = useDialogFocus<HTMLElement>(onClose);
  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <aside
        ref={ref}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
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
  large = false,
  children,
}: {
  title: string;
  onClose: () => void;
  large?: boolean;
  children: ReactNode;
}) {
  const ref = useDialogFocus<HTMLDivElement>(onClose);
  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        className={large ? 'modal large' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
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
