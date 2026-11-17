import { useEffect, useState } from 'react';
import { fetchEnregistrements, type EnregistrementListe } from '../api.js';

const etat = (e: EnregistrementListe) =>
  e.aResume
    ? 'Résumé prêt'
    : e.statut === 'en_cours'
      ? 'En cours'
      : e.statut === 'clos'
        ? 'Transcription en cours'
        : e.statut === 'transcrit'
          ? 'Transcrit'
          : 'Échec';

const quand = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });

// Les derniers enregistrements de visio, dans le cockpit. Rien d'affiché tant qu'il n'y en a pas.
export function Enregistrements({ slug }: { slug: string }) {
  const [liste, setListe] = useState<EnregistrementListe[]>([]);
  useEffect(() => {
    const lire = () => fetchEnregistrements(slug).then(setListe, () => undefined);
    void lire();
    // Un enregistrement en cours passe de « en cours » à « résumé prêt » sans que l'écran bouge.
    const t = setInterval(() => void lire(), 15_000);
    return () => clearInterval(t);
  }, [slug]);
  if (liste.length === 0) return null;
  return (
    <section className="panel" aria-label="Enregistrements">
      <div className="panel-h">
        <h2>Enregistrements</h2>
      </div>
      <ul className="panel-b stack" style={{ listStyle: 'none', margin: 0, padding: 12 }}>
        {liste.slice(0, 6).map((e) => (
          <li key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <a href={`#/${slug}/fiche/rdv/${encodeURIComponent(e.rdvId)}`}>{e.titre}</a>
            <span className="small muted">
              {quand(e.debutAt)} · <span className="badge">{etat(e)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
