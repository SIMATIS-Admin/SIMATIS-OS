import { useState, type DragEvent, type ReactNode } from 'react';
import type { SemaineTaches, TacheVue } from '../../api.js';
import { Icon } from '../../icons.js';
import { COULEUR_TYPE, MIME_TACHE, estRendezVous } from './agenda.js';
import { ACTIVITES } from './commun.js';
import { anciennete, heureParis, heuresParDefaut, jourParis, memeHeure } from './creneaux.js';

const JOURS_LONGS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export function nomJour(jour: string, mois = false): string {
  const d = new Date(`${jour}T12:00:00Z`);
  const nom = `${JOURS_LONGS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}`;
  return mois ? `${nom} ${MOIS[d.getUTCMonth()]}` : nom;
}

// The tasks of a day, open first then done, in due order; meetings stay on the grid.
export function tachesDuJour(data: SemaineTaches, jour: string): TacheVue[] {
  return data.taches
    .filter((t) => t.echeance && !estRendezVous(t) && jourParis(t.echeance) === jour)
    .sort(
      (a, b) =>
        Number(a.fait) - Number(b.fait) || (a.echeance ?? '').localeCompare(b.echeance ?? ''),
    );
}

// HubSpot gives most tasks the same default time: only a real time is worth showing.
export function heureReelle(data: SemaineTaches) {
  const parDefaut = heuresParDefaut(data.taches.filter((t) => !t.fait).map((t) => t.echeance));
  return (t: TacheVue) => {
    if (!t.echeance || !t.avecHeure) return null;
    const h = heureParis(t.echeance);
    return parDefaut.has(h) || h === '00:00' ? null : h;
  };
}

export function LigneTache({
  t,
  heure,
  onOpen,
  onFait,
  children,
}: {
  t: TacheVue;
  heure: string | null;
  onOpen: (t: TacheVue) => void;
  onFait: (t: TacheVue) => void;
  children?: ReactNode;
}) {
  const [ico, lbl] = ACTIVITES[t.type];
  const qui = [t.contact?.nom, t.opportunite?.titre].filter(Boolean).join(' · ');
  return (
    <li
      className={`ag-tache ${t.fait ? 'faite' : ''}`}
      style={{ ['--c' as string]: COULEUR_TYPE[t.type] }}
      draggable={!t.fait}
      onDragStart={(e) => e.dataTransfer.setData(MIME_TACHE, t.id)}
    >
      <input
        type="checkbox"
        aria-label={`Marquer faite : ${t.titre}`}
        checked={t.fait}
        onChange={() => onFait(t)}
      />
      <span className="ag-ico" title={lbl}>
        <Icon name={ico} />
      </span>
      <button className="ag-titre" onClick={() => onOpen(t)} title={t.titre}>
        <span>{t.titre}</span>
        {qui && <small>{qui}</small>}
      </button>
      {heure && <small className="num ag-heure">{heure}</small>}
      {children}
    </li>
  );
}

// Tasks beside the calendar: overdue first, then each day shown, then those without a date.
// A task dropped on a day moves there, keeping its time.
export function Panneau({
  jours,
  data,
  aujourdhui,
  onOpen,
  onFait,
  onMove,
  onMoveAll,
}: {
  jours: string[];
  data: SemaineTaches;
  aujourdhui: string;
  onOpen: (t: TacheVue) => void;
  onFait: (t: TacheVue) => void;
  onMove: (t: TacheVue, echeance: string) => void;
  onMoveAll: (moves: [TacheVue, string][]) => void;
}) {
  const [retardOuvert, setRetardOuvert] = useState(true);
  const [sansDateOuvert, setSansDateOuvert] = useState(false);
  const heure = heureReelle(data);
  const toutes = [...data.enRetard, ...data.taches, ...data.sansEcheance];
  const enRetard = [...data.enRetard].sort((a, b) =>
    (a.echeance ?? '').localeCompare(b.echeance ?? ''),
  );
  const versAujourdhui = (t: TacheVue): [TacheVue, string] => [
    t,
    memeHeure(t.echeance, aujourdhui),
  ];

  const accepte = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(MIME_TACHE)) e.preventDefault();
  };
  const depose = (jour: string) => (e: DragEvent) => {
    e.preventDefault();
    const t = toutes.find((x) => x.id === e.dataTransfer.getData(MIME_TACHE));
    if (t && (!t.echeance || jourParis(t.echeance) !== jour))
      onMove(t, memeHeure(t.echeance, jour));
  };
  const ligne = (t: TacheVue, extra?: ReactNode) => (
    <LigneTache key={t.id} t={t} heure={heure(t)} onOpen={onOpen} onFait={onFait}>
      {extra}
    </LigneTache>
  );

  return (
    <aside className="panel ag-panneau" aria-label="Tâches">
      <div className="panel-h">
        <h2>Tâches</h2>
      </div>
      {enRetard.length > 0 && (
        <section className="ag-groupe retard" aria-label="En retard">
          <h3>
            <button
              className="lien"
              aria-expanded={retardOuvert}
              onClick={() => setRetardOuvert(!retardOuvert)}
            >
              {`En retard (${enRetard.length})`}
            </button>
            {retardOuvert && (
              <button
                className="btn sm"
                onClick={() => {
                  if (confirm(`Reporter les ${enRetard.length} tâches en retard à aujourd’hui ?`))
                    onMoveAll(enRetard.map(versAujourdhui));
                }}
              >
                Tout reporter à aujourd’hui
              </button>
            )}
          </h3>
          {retardOuvert && (
            <ul>
              {enRetard.map((t) =>
                ligne(
                  t,
                  <span className="ag-retard">
                    <span className="late">{t.echeance ? anciennete(t.echeance) : ''}</span>
                    <button
                      className="btn sm"
                      title="Reporter à aujourd’hui"
                      onClick={() => onMove(...versAujourdhui(t))}
                    >
                      Aujourd’hui
                    </button>
                  </span>,
                ),
              )}
            </ul>
          )}
        </section>
      )}
      {jours.map((jour) => {
        const liste = tachesDuJour(data, jour);
        const ouvertes = liste.filter((t) => !t.fait).length;
        return (
          <section
            key={jour}
            className={`ag-groupe ${jour === aujourdhui ? 'auj' : ''}`}
            data-taches-jour={jour}
            onDragOver={accepte}
            onDrop={depose(jour)}
          >
            <h3>
              <span>
                {nomJour(jour)}
                {jour === aujourdhui && <span className="badge green">Aujourd’hui</span>}
              </span>
              {ouvertes > 0 && <span className="muted small">{ouvertes}</span>}
            </h3>
            {liste.length ? (
              <ul>{liste.map((t) => ligne(t))}</ul>
            ) : (
              <p className="ag-vide">Aucune tâche</p>
            )}
          </section>
        );
      })}
      {data.sansEcheance.length > 0 && (
        <section className="ag-groupe">
          <h3>
            <button
              className="lien"
              aria-expanded={sansDateOuvert}
              onClick={() => setSansDateOuvert(!sansDateOuvert)}
            >
              {`Sans échéance (${data.sansEcheance.length})`}
            </button>
          </h3>
          {sansDateOuvert && <ul>{data.sansEcheance.map((t) => ligne(t))}</ul>}
        </section>
      )}
    </aside>
  );
}
