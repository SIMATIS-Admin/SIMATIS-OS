import { useEffect, useState } from 'react';
import { fetchJournal, type JournalEntry } from '../api.js';
import { Gauge, Who } from './widgets.js';

const FILTRES = [
  ['tout', 'Tout'],
  ['os', "L'OS"],
  ['pilote', 'Vous'],
  ['agent', 'Agents'],
] as const;
type Filtre = (typeof FILTRES)[number][0];

const matches = (f: Filtre, acteur: string) =>
  f === 'tout' ||
  (f === 'os' && (acteur === 'os' || acteur === 'systeme')) ||
  (f === 'pilote' && acteur === 'pilote') ||
  (f === 'agent' && acteur.startsWith('agent:'));

const dateParis = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function Journal({ slug }: { slug: string }) {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Filtre>('tout');

  useEffect(() => {
    let alive = true;
    fetchJournal(slug).then(
      (rows) => alive && setEntries(rows),
      (e: unknown) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [slug]);

  const shown = entries?.filter((e) => matches(filtre, e.acteur)) ?? [];
  return (
    <>
      <div className="seg" style={{ marginBottom: 14 }}>
        {FILTRES.map(([id, label]) => (
          <button key={id} className={filtre === id ? 'on' : ''} onClick={() => setFiltre(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="panel">
        {error && <div className="empty">{error}</div>}
        {entries && shown.length === 0 && (
          <div className="empty">Aucune entrée pour ce filtre.</div>
        )}
        {shown.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Par</th>
                <th>Action</th>
                <th>Niveau</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td className="num small">{dateParis(e.at)}</td>
                  <td>
                    <Who acteur={e.acteur} />
                  </td>
                  <td>{e.action}</td>
                  <td>{e.niveau && <Gauge niveau={e.niveau} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
