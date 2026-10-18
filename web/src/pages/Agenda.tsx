import { useEffect, useState } from 'react';
import { fetchRendezVous, type RendezVousReponse } from '../api.js';
import { quand } from './RendezVous.js';
import { Taches } from './Taches.js';

// The Agenda gathers the tasks and the calendar meetings. A meeting opens its row in Rendez-vous,
// where it is prepared and its compte rendu written.
type Vue = 'tout' | 'taches' | 'rdv';
const VUES: [Vue, string][] = [
  ['tout', 'Tout'],
  ['taches', 'Tâches'],
  ['rdv', 'Rendez-vous'],
];

function Evenements({ slug }: { slug: string }) {
  const [data, setData] = useState<RendezVousReponse | null>(null);
  useEffect(() => {
    fetchRendezVous(slug).then(setData, () =>
      setData({ etat: 'erreur', erreur: 'Rendez-vous indisponibles', rdv: [] }),
    );
  }, [slug]);
  if (!data) return null;
  if (data.etat === 'non_configure') {
    return (
      <div className="empty">
        Agenda non branché : connectez le compte Google dans Paramètres &gt; Connexions.
      </div>
    );
  }
  if (data.etat === 'erreur') return <div className="empty">{data.erreur}</div>;
  if (data.rdv.length === 0) {
    return (
      <div className="empty">Aucun rendez-vous entre la semaine passée et les deux prochaines.</div>
    );
  }
  return (
    <div className="panel">
      <ul className="checks">
        {data.rdv.map((r) => (
          <li key={r.id} style={{ alignItems: 'center' }}>
            <span className="num" style={{ minWidth: 150 }}>
              {quand(r.debut)}
            </span>
            <b style={{ flex: 1 }}>{r.titre}</b>
            <span className="small muted">{r.contact?.nom ?? 'Hors CRM'}</span>
            <a className="btn sm" href={`#/${slug}/rendez-vous/ouvrir/${r.id}`}>
              Ouvrir dans Rendez-vous
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Agenda({ slug }: { slug: string }) {
  const [vue, setVue] = useState<Vue>('tout');
  return (
    <>
      <div className="page-actions">
        <div className="seg" role="group" aria-label="Affichage de l'agenda">
          {VUES.map(([v, libelle]) => (
            <button
              key={v}
              className={vue === v ? 'on' : ''}
              aria-pressed={vue === v}
              onClick={() => setVue(v)}
            >
              {libelle}
            </button>
          ))}
        </div>
      </div>
      {vue !== 'taches' && <Evenements slug={slug} />}
      {vue !== 'rdv' && <Taches slug={slug} />}
    </>
  );
}
