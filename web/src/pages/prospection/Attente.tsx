import { useEffect, useRef, useState } from 'react';
import { fetchCampagne, relancerRedaction, type CampagneProspection } from '../../api.js';

// Attend que l'exécuteur du poste et Claude aient rédigé les brouillons : la page interroge la
// campagne toutes les 3 secondes. Fermer la page n'arrête rien, la campagne se rouvre à l'accueil.
export function Attente({
  slug,
  id,
  intervalleMs = 3000,
  onPret,
}: {
  slug: string;
  id: string;
  intervalleMs?: number;
  onPret: (c: CampagneProspection) => void;
}) {
  const [campagne, setCampagne] = useState<CampagneProspection | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tour, setTour] = useState(0);
  const pret = useRef(onPret);
  pret.current = onPret;

  useEffect(() => {
    let actif = true;
    const lire = () =>
      fetchCampagne(slug, id).then(
        (c) => {
          if (!actif) return;
          setCampagne(c);
          if (c.statut === 'relecture' || c.statut === 'terminee') pret.current(c);
        },
        (e: unknown) => actif && setMessage(e instanceof Error ? e.message : String(e)),
      );
    void lire();
    const t = setInterval(() => void lire(), intervalleMs);
    return () => {
      actif = false;
      clearInterval(t);
    };
  }, [slug, id, intervalleMs, tour]);

  if (campagne?.statut === 'erreur') {
    return (
      <div className="panel">
        <div className="panel-b">
          <div className="alert amber">
            <div>{campagne.erreur ?? 'La rédaction a échoué.'}</div>
          </div>
          <p>
            <button
              className="btn primary"
              onClick={() =>
                void relancerRedaction(slug, id).then(
                  () => {
                    setCampagne(null);
                    setTour((n) => n + 1);
                  },
                  (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
                )
              }
            >
              Relancer la rédaction
            </button>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="panel-b">
        <h2 style={{ marginTop: 0 }}>Claude rédige les brouillons…</h2>
        <p className="muted">
          Il lit chaque fil et prépare un mail par tâche : comptez une à deux minutes. Vous pouvez
          quitter cette page, la campagne vous attendra sur l'accueil de la Prospection.
        </p>
        {message && (
          <p className="small" role="alert" style={{ color: 'var(--red)' }}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
