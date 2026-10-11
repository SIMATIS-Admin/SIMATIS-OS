import { useState, type DragEvent } from 'react';
import type { SemaineTaches, TacheVue } from '../../api.js';
import { Icon } from '../../icons.js';
import { TYPES, plusJours } from './commun.js';
import { anciennete, heureParis, heuresParDefaut, jourParis, memeHeure } from './creneaux.js';

export const MIME_TACHE = 'application/x-simatis-tache';
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
const ORDRE: TacheVue['canal'][] = ['appel', 'email', 'tache'];
const REPLI = 5;

function Carte({
  t,
  heure,
  onOpen,
}: {
  t: TacheVue;
  heure: string | null;
  onOpen: (t: TacheVue) => void;
}) {
  return (
    <div
      className={`sem-tache ${t.origine}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(MIME_TACHE, t.id)}
      onClick={() => onOpen(t)}
      title={t.titre}
    >
      <b>{t.titre}</b>
      {heure && <small>{heure}</small>}
    </div>
  );
}

function Groupe({
  canal,
  taches,
  heure,
  onOpen,
}: {
  canal: TacheVue['canal'];
  taches: TacheVue[];
  heure: (t: TacheVue) => string | null;
  onOpen: (t: TacheVue) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [ico, lbl] = TYPES[canal];
  const shown = ouvert ? taches : taches.slice(0, REPLI);
  return (
    <div className="sem-groupe">
      <h4>
        <Icon name={ico} />
        {`${lbl} (${taches.length})`}
      </h4>
      {shown.map((t) => (
        <Carte key={t.id} t={t} heure={heure(t)} onOpen={onOpen} />
      ))}
      {taches.length > REPLI && (
        <button className="lien" onClick={() => setOuvert(!ouvert)}>
          {ouvert ? 'Replier' : `+ ${taches.length - REPLI} autres`}
        </button>
      )}
    </div>
  );
}

function EnRetard({
  taches,
  aujourdhui,
  onOpen,
  onMove,
  onMoveAll,
}: {
  taches: TacheVue[];
  aujourdhui: string;
  onOpen: (t: TacheVue) => void;
  onMove: (t: TacheVue, echeance: string) => void;
  onMoveAll: (moves: [TacheVue, string][]) => void;
}) {
  const [replie, setReplie] = useState(false);
  const titre = `En retard (${taches.length})`;
  if (replie)
    return (
      <button className="btn sem-retard-replie" onClick={() => setReplie(false)}>
        {titre}
      </button>
    );
  const versAujourdhui = (t: TacheVue): [TacheVue, string] => [
    t,
    memeHeure(t.echeance, aujourdhui),
  ];
  const toutReporter = () => {
    if (confirm(`Reporter les ${taches.length} tâches en retard à aujourd’hui ?`))
      onMoveAll(taches.map(versAujourdhui));
  };
  return (
    <aside className="panel sem-retard" aria-label="En retard">
      <div className="panel-h">
        <h2>{titre}</h2>
        <button
          className="btn ghost sm"
          aria-label="Replier la colonne En retard"
          onClick={() => setReplie(true)}
        >
          ‹
        </button>
      </div>
      <div className="panel-b">
        <button className="btn sm" onClick={toutReporter}>
          Tout reporter à aujourd’hui
        </button>
        <ul>
          {taches.map((t) => (
            <li key={t.id}>
              <Carte t={t} heure={null} onOpen={onOpen} />
              <div className="small sem-retard-actions">
                <span className="late">{t.echeance ? anciennete(t.echeance) : ''}</span>
                <button className="btn sm" onClick={() => onMove(...versAujourdhui(t))}>
                  Aujourd’hui
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

// One column per day (weekend together); tasks are to-dos of the day, grouped by type, without
// an hour grid: HubSpot gives most of them the same default time.
export function Semaine({
  lundi,
  data,
  onOpen,
  onMove,
  onMoveAll,
}: {
  lundi: string;
  data: SemaineTaches;
  onOpen: (t: TacheVue) => void;
  onMove: (t: TacheVue, echeance: string) => void;
  onMoveAll: (moves: [TacheVue, string][]) => void;
}) {
  const toutes = [...data.enRetard, ...data.taches, ...data.sansEcheance];
  const jours = Array.from({ length: 6 }, (_, j) => plusJours(lundi, j));
  const colonne = (jour: string) => {
    const k = jours.indexOf(jour);
    return k === -1 ? 5 : k;
  };
  const ouvertes = data.taches.filter((t) => !t.fait && t.echeance);
  const parDefaut = heuresParDefaut(ouvertes.map((t) => t.echeance));
  const heure = (t: TacheVue) => {
    if (!t.echeance) return null;
    const h = heureParis(t.echeance);
    return parDefaut.has(h) || h === '00:00' ? null : h;
  };

  const accepte = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(MIME_TACHE)) e.preventDefault();
  };
  const depose = (jour: string) => (e: DragEvent) => {
    e.preventDefault();
    const t = toutes.find((x) => x.id === e.dataTransfer.getData(MIME_TACHE));
    if (t) onMove(t, memeHeure(t.echeance, jour));
  };

  return (
    <div className="sem2">
      {data.enRetard.length > 0 && (
        <EnRetard
          taches={[...data.enRetard].sort((a, b) =>
            (a.echeance ?? '').localeCompare(b.echeance ?? ''),
          )}
          aujourdhui={jourParis(new Date().toISOString())}
          onOpen={onOpen}
          onMove={onMove}
          onMoveAll={onMoveAll}
        />
      )}
      <div className="sem-jours">
        {jours.map((jour, j) => {
          const ici = ouvertes
            .filter((t) => t.echeance && colonne(jourParis(t.echeance)) === j)
            .sort((a, b) => (a.echeance ?? '').localeCompare(b.echeance ?? ''));
          const rdv = data.rdv
            .filter((r) => colonne(jourParis(r.debut)) === j)
            .sort((a, b) => a.debut.localeCompare(b.debut));
          return (
            <section
              key={jour}
              className="panel sem-jour"
              data-jour={jour}
              onDragOver={accepte}
              onDrop={depose(jour)}
            >
              <h3>{j < 5 ? `${JOURS[j]} ${Number(jour.slice(8))}` : 'Week-end'}</h3>
              {rdv.map((r) => (
                <div key={`${r.debut}-${r.titre}`} className="rdv">
                  <small>{heureParis(r.debut)}</small> <span>{r.titre}</span>
                </div>
              ))}
              {ORDRE.map((canal) => {
                const groupe = ici.filter((t) => t.canal === canal);
                return groupe.length ? (
                  <Groupe key={canal} canal={canal} taches={groupe} heure={heure} onOpen={onOpen} />
                ) : null;
              })}
              {ici.length === 0 && rdv.length === 0 && <p className="small muted">Rien de prévu</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
