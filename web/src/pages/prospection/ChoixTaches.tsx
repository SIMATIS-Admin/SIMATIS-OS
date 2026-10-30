import { useEffect, useState } from 'react';
import { fetchRecherche, fetchTachesRelance, type TacheRelance } from '../../api.js';

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
  onContinuer: (tacheIds: string[], liens: Record<string, string>) => void;
}) {
  const [taches, setTaches] = useState<TacheRelance[] | null>(null);
  const [choix, setChoix] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  // Contact choisi pour une tâche que le CRM ne relie à personne.
  const [liens, setLiens] = useState<Record<string, { id: string; nom: string }>>({});
  const [recherche, setRecherche] = useState<{
    tacheId: string;
    q: string;
    trouves: { id: string; nom: string; entreprise: string | null }[];
  } | null>(null);

  useEffect(() => {
    fetchTachesRelance(slug).then(setTaches, (e: unknown) =>
      setErreur(e instanceof Error ? e.message : String(e)),
    );
  }, [slug]);

  if (erreur) return <div className="empty">{erreur}</div>;
  if (!taches) return null;
  const choisissable = (t: TacheRelance) => t.utilisable || !!liens[t.id];
  const utilisables = taches.filter(choisissable);
  const lier = (tacheId: string, contact: { id: string; nom: string }) => {
    setLiens((l) => ({ ...l, [tacheId]: contact }));
    setChoix((c) => [...new Set([...c, tacheId])]);
    setRecherche(null);
  };
  const delier = (tacheId: string) => {
    setLiens((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== tacheId)));
    setChoix((c) => c.filter((x) => x !== tacheId));
  };
  const chercher = (tacheId: string, q: string) => {
    setRecherche({ tacheId, q, trouves: [] });
    if (q.trim().length < 2) return;
    fetchRecherche(slug, q.trim()).then(
      (r) =>
        setRecherche((cur) =>
          cur && cur.tacheId === tacheId && cur.q === q
            ? { ...cur, trouves: r.personnes.slice(0, 6) }
            : cur,
        ),
      () => undefined,
    );
  };
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
                      disabled={!choisissable(t)}
                      checked={choix.includes(t.id)}
                      onChange={(e) => bascule(t.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <b>{t.contactNom ?? t.titre}</b>
                    {!t.utilisable && liens[t.id] && (
                      <div className="small">
                        Contact choisi : <b>{liens[t.id]?.nom}</b>{' '}
                        <button className="btn sm ghost" onClick={() => delier(t.id)}>
                          Changer
                        </button>
                      </div>
                    )}
                    {!t.utilisable && !liens[t.id] && (
                      <div className="small">
                        <span className="badge amber">Sans contact ou sans adresse mail</span>
                        {t.suggestion && (
                          <div style={{ marginTop: 4 }}>
                            <button
                              className="btn sm primary"
                              aria-label={`Utiliser ${t.suggestion.contactNom} pour ${t.titre}`}
                              onClick={() =>
                                t.suggestion &&
                                lier(t.id, {
                                  id: t.suggestion.contactId,
                                  nom: t.suggestion.contactNom,
                                })
                              }
                            >
                              Utiliser {t.suggestion.contactNom}
                              {t.suggestion.societe ? `, ${t.suggestion.societe}` : ''}
                            </button>
                          </div>
                        )}
                        {recherche?.tacheId === t.id ? (
                          <div style={{ marginTop: 4 }}>
                            <input
                              className="input"
                              autoFocus
                              aria-label={`Chercher un contact pour ${t.titre}`}
                              placeholder="Nom du contact"
                              value={recherche.q}
                              onChange={(e) => chercher(t.id, e.target.value)}
                            />
                            {recherche.trouves.map((p) => (
                              <div key={p.id}>
                                <button
                                  className="btn sm"
                                  onClick={() => lier(t.id, { id: p.id, nom: p.nom })}
                                >
                                  {p.nom}
                                  {p.entreprise ? `, ${p.entreprise}` : ''}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ marginTop: 4 }}>
                            <button
                              className="btn sm"
                              aria-label={`Choisir un contact pour ${t.titre}`}
                              onClick={() => setRecherche({ tacheId: t.id, q: '', trouves: [] })}
                            >
                              Choisir un contact
                            </button>
                          </div>
                        )}
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
            onClick={() =>
              onContinuer(
                choix,
                Object.fromEntries(
                  Object.entries(liens)
                    .filter(([k]) => choix.includes(k))
                    .map(([k, c]) => [k, c.id]),
                ),
              )
            }
          >
            Continuer avec {choix.length} {choix.length > 1 ? 'tâches' : 'tâche'}
          </button>
          {choix.length === 0 && <span className="small muted"> Rien n'est sélectionné.</span>}
        </div>
      </div>
    </div>
  );
}
