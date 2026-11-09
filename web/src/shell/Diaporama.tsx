import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useModePresentation } from './modePresentation.js';
import './diaporama.css';

export type Slide = { cle: string; classe?: string; contenu: ReactNode };

// Une idée par slide, des petits ronds pour se repérer, les flèches du clavier pour avancer.
// Les slides masquées restent dans la page mais sortent de l'arbre d'accessibilité.
export function Diaporama({
  nom,
  slides,
  actions,
}: {
  nom: string;
  slides: Slide[];
  // Boutons propres à la présentation, à gauche de la barre de commande (retour, lien…).
  actions?: ReactNode;
}) {
  const [courant, setCourant] = useState(0);
  const { actif, basculer } = useModePresentation();
  const dernier = slides.length - 1;
  const aller = useCallback(
    (n: number) => setCourant(Math.max(0, Math.min(dernier, n))),
    [dernier],
  );

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const cible = e.target instanceof HTMLElement ? e.target : null;
      if (cible?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') aller(courant + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') aller(courant - 1);
      else if (e.key === 'p' || e.key === 'P') basculer();
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, [courant, aller, basculer]);

  return (
    <div className="diaporama" role="region" aria-roledescription="diaporama" aria-label={nom}>
      <div className="dia-scene">
        {slides.map((s, i) => (
          <section
            key={s.cle}
            className={`dia-slide ${s.classe ?? ''} ${i === courant ? 'on' : i < courant ? 'avant' : ''}`}
            aria-hidden={i !== courant}
            aria-label={`Slide ${i + 1} sur ${slides.length}`}
          >
            {s.contenu}
          </section>
        ))}
      </div>
      <div className="dia-progres" aria-hidden="true">
        <span style={{ width: `${((courant + 1) / slides.length) * 100}%` }} />
      </div>
      <div className="dia-commande">
        <div className="dia-actions">{actions}</div>
        <div className="dia-nav">
          <button
            className="btn sm"
            type="button"
            aria-label="Slide précédente"
            disabled={courant === 0}
            onClick={() => aller(courant - 1)}
          >
            ←
          </button>
          <div className="dia-ronds" role="group" aria-label="Aller à une slide">
            {slides.map((s, i) => (
              <button
                key={s.cle}
                type="button"
                className={i === courant ? 'on' : ''}
                aria-label={`Slide ${i + 1}`}
                aria-current={i === courant ? 'step' : undefined}
                onClick={() => aller(i)}
              />
            ))}
          </div>
          <span className="dia-compteur">
            {courant + 1} / {slides.length}
          </span>
          <button
            className="btn sm"
            type="button"
            aria-label="Slide suivante"
            disabled={courant === dernier}
            onClick={() => aller(courant + 1)}
          >
            →
          </button>
        </div>
        <div className="dia-actions droite">
          <button className="btn sm primary" type="button" aria-pressed={actif} onClick={basculer}>
            {actif ? 'Quitter la présentation' : 'Mode présentation'}
          </button>
        </div>
      </div>
    </div>
  );
}
