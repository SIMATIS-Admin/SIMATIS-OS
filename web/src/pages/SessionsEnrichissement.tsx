import { useEffect, useState } from 'react';
import { fetchSessionsEnrichissement, type SessionEnrichissement } from '../api.js';

const ETATS: Record<SessionEnrichissement['etat'], string> = {
  en_cours: 'En cours',
  terminee: 'Terminée',
  incomplete: 'Incomplète',
  erreur: 'En erreur',
};

const date = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// Les derniers passages d'enrichissement, lancés à la main ou par la routine quotidienne.
export function SessionsEnrichissement({ slug, version }: { slug: string; version?: number }) {
  const [sessions, setSessions] = useState<SessionEnrichissement[] | null>(null);

  useEffect(() => {
    void fetchSessionsEnrichissement(slug).then(setSessions, () => setSessions([]));
  }, [slug, version]);

  return (
    <section className="panel" aria-label="Sessions d'enrichissement">
      <div className="panel-h">
        <h2>Sessions d’enrichissement</h2>
      </div>
      <div className="panel-b">
        {!sessions || sessions.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            {sessions ? 'Aucune session pour l’instant.' : 'Chargement…'}
          </p>
        ) : (
          <table className="tbl small">
            <thead>
              <tr>
                <th>Date</th>
                <th>Session</th>
                <th>Déclenchement</th>
                <th>Statut</th>
                <th className="r">Traités</th>
                <th className="r">Fiches ajoutées</th>
                <th>Détail</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={`${s.nature}-${s.id}`}>
                  <td>{date(s.date)}</td>
                  <td>{s.libelle}</td>
                  <td>{s.mode === 'automatique' ? 'Automatique' : 'Manuel'}</td>
                  <td>{ETATS[s.etat]}</td>
                  <td className="r num">{s.traites}</td>
                  <td className="r num">{s.ajoutees ?? '—'}</td>
                  <td className="muted">{s.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
