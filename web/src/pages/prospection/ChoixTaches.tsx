import { useEffect, useState } from 'react';
import { fetchTachesRelance, type TacheRelance } from '../../api.js';

const echeance = (iso: string | null) => {
  if (!iso) return '—';
  const jour = new Date(iso).toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'short',
  });
  return Date.parse(iso) < Date.now() - 86400_000 ? `en retard, ${jour}` : jour;
};

export function ChoixTaches({
  slug,
  onContinuer,
}: {
  slug: string;
  onContinuer: (tacheIds: string[]) => void;
}) {
  const [taches, setTaches] = useState<TacheRelance[] | null>(null);
  const [choix, setChoix] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetchTachesRelance(slug).then(setTaches, (e: unknown) =>
      setErreur(e instanceof Error ? e.message : String(e)),
    );
  }, [slug]);

  if (erreur) return <div className="empty">{erreur}</div>;
  if (!taches) return null;
  const utilisables = taches.filter((t) => t.utilisable);
  const toutes = utilisables.length > 0 && utilisables.every((t) => choix.includes(t.id));
  const bascule = (id: string, coche: boolean) =>
    setChoix((c) => (coche ? [...new Set([...c, id])] : c.filter((x) => x !== id)));

  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Quelles tâches relancer ?</h2>
        <label className="small">
          <input
            type="checkbox"
            aria-label="Tout sélectionner"
            checked={toutes}
            onChange={(e) => setChoix(e.target.checked ? utilisables.map((t) => t.id) : [])}
          />{' '}
          Tout sélectionner
        </label>
      </div>
      <div className="panel-b">
        {taches.length === 0 ? (
          <div className="empty">Aucune tâche de relance par mail à traiter.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th />
                <th>Contact</th>
                <th>Société</th>
                <th>Échéance</th>
                <th>Prochaine touche</th>
              </tr>
            </thead>
            <tbody>
              {taches.map((t) => (
                <tr key={t.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Choisir ${t.titre}`}
                      disabled={!t.utilisable}
                      checked={choix.includes(t.id)}
                      onChange={(e) => bascule(t.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <b>{t.contactNom ?? t.titre}</b>
                    {!t.utilisable && (
                      <div>
                        <span className="badge amber">Sans contact ou sans adresse mail</span>
                      </div>
                    )}
                  </td>
                  <td>{t.societe ?? '—'}</td>
                  <td className="small">{echeance(t.echeance)}</td>
                  <td className="num">{t.touche}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 14 }}>
          <button
            className="btn primary"
            disabled={choix.length === 0}
            onClick={() => onContinuer(choix)}
          >
            Continuer avec {choix.length} {choix.length > 1 ? 'tâches' : 'tâche'}
          </button>
          {choix.length === 0 && <span className="small muted"> Rien n'est sélectionné.</span>}
        </div>
      </div>
    </div>
  );
}
