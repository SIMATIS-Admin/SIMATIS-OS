import { useEffect, useState } from 'react';
import {
  confirmerEpuisesProspection,
  fetchEpuises,
  garderContactsProspection,
  type ContactAConfirmer,
} from '../../api.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Contacts qui ont reçu toutes leurs touches sans répondre : rien n'est marqué sans l'accord de Marc,
// un par un ou en lot.
export function Epuises({ slug }: { slug: string }) {
  const [liste, setListe] = useState<ContactAConfirmer[] | null>(null);
  const [choix, setChoix] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = () => fetchEpuises(slug).then(setListe, (e: unknown) => setErreur(message(e)));
  useEffect(() => {
    void charger();
  }, [slug]);

  const agir = (action: (s: string, ids: string[]) => Promise<unknown>, ids: string[]) =>
    action(slug, ids).then(
      () => {
        setChoix([]);
        return charger();
      },
      (e: unknown) => setErreur(message(e)),
    );

  if (!liste) return erreur ? <div className="empty">{erreur}</div> : null;
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Contacts épuisés à confirmer</h2>
        <span className="small muted">Aucun contact n'est marqué sans votre accord.</span>
      </div>
      <div className="panel-b">
        {erreur && (
          <p className="small" role="alert" style={{ color: 'var(--red)' }}>
            {erreur}
          </p>
        )}
        {liste.length === 0 ? (
          <div className="empty">Aucun contact à confirmer.</div>
        ) : (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th />
                  <th>Contact</th>
                  <th>Société</th>
                  <th className="r">Touches</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {liste.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Choisir ${c.nom}`}
                        checked={choix.includes(c.id)}
                        onChange={(e) =>
                          setChoix((l) =>
                            e.target.checked ? [...l, c.id] : l.filter((x) => x !== c.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <b>{c.nom}</b>
                    </td>
                    <td>{c.entreprise}</td>
                    <td className="r num">
                      {c.touches} sur {c.touchesMax}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn sm"
                        aria-label={`Marquer ${c.nom} épuisé`}
                        onClick={() => void agir(confirmerEpuisesProspection, [c.id])}
                      >
                        Marquer épuisé
                      </button>{' '}
                      <button
                        className="btn sm ghost"
                        aria-label={`Garder ${c.nom}`}
                        onClick={() => void agir(garderContactsProspection, [c.id])}
                      >
                        Garder
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12 }}>
              <button
                className="btn primary"
                disabled={choix.length === 0}
                onClick={() => void agir(confirmerEpuisesProspection, choix)}
              >
                Marquer épuisés ({choix.length})
              </button>
            </div>
            <p className="small muted">
              « Garder » accorde une touche de plus au contact : il reste dans la prospection.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
