import { type ReactNode } from 'react';
import { useDialogFocus } from './useDialogFocus.js';

// A native <dialog> would do the same, but jsdom does not implement showModal: this keeps the
// windows testable. Escape and a click outside close it; focus moves in and goes back on close.
export function Fenetre({
  titre,
  sousTitre,
  onFermer,
  tiroir = false,
  large = false,
  children,
  pied,
}: {
  titre: string;
  sousTitre?: ReactNode;
  onFermer: () => void;
  tiroir?: boolean;
  large?: boolean;
  children: ReactNode;
  pied?: ReactNode;
}) {
  const ref = useDialogFocus<HTMLDivElement>(onFermer);

  return (
    <div
      className="bv-voile"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFermer();
      }}
    >
      <div
        ref={ref}
        className={`bv-fenetre ${tiroir ? 'tiroir' : ''} ${large ? 'large' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        tabIndex={-1}
      >
        <div className="bv-fenetre-tete">
          <div>
            <h2>{titre}</h2>
            {sousTitre && <p>{sousTitre}</p>}
          </div>
          <button className="bv-fermer" aria-label="Fermer" onClick={onFermer}>
            ×
          </button>
        </div>
        <div className="bv-fenetre-corps">{children}</div>
        {pied && <div className="bv-fenetre-pied">{pied}</div>}
      </div>
    </div>
  );
}
