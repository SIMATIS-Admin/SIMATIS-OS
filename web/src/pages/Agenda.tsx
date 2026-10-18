import { useState } from 'react';
import { RendezVous } from './RendezVous.js';
import { Taches } from './Taches.js';

// The Agenda gathers the tasks and the calendar meetings. « Tout » shows the meetings above the tasks.
type Vue = 'tout' | 'taches' | 'rdv';
const VUES: [Vue, string][] = [
  ['tout', 'Tout'],
  ['taches', 'Tâches'],
  ['rdv', 'Rendez-vous'],
];

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
      {vue !== 'taches' && <RendezVous slug={slug} />}
      {vue !== 'rdv' && <Taches slug={slug} />}
    </>
  );
}
