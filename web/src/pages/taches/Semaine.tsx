import type { DragEvent } from 'react';
import type { SemaineTaches, TacheVue } from '../../api.js';
import { Icon } from '../../icons.js';
import { TYPES, plusJours } from './commun.js';
import { COLONNES, LIGNES, creneau, vers } from './creneaux.js';

const MIME = 'application/x-simatis-tache';
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
const HAUTEUR = 28; // px per half hour, kept in sync with .sem-cell in styles.css

const heureDeLigne = (l: number) => `${8 + Math.floor(l / 2)}h${l % 2 ? '30' : ''}`;

function Carte({ t, onOpen }: { t: TacheVue; onOpen: (t: TacheVue) => void }) {
  return (
    <div
      className={`sem-tache ${t.origine} ${t.fait ? 'fait' : ''}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(MIME, t.id)}
      onClick={() => onOpen(t)}
      title={t.titre}
    >
      <Icon name={TYPES[t.canal][0]} />
      <b>{t.titre}</b>
    </div>
  );
}

export function Semaine({
  lundi,
  data,
  onOpen,
  onMove,
}: {
  lundi: string;
  data: SemaineTaches;
  onOpen: (t: TacheVue) => void;
  onMove: (t: TacheVue, echeance: string) => void;
}) {
  const toutes = [...data.enRetard, ...data.taches, ...data.sansEcheance];
  const ici = new Map<string, TacheVue[]>();
  for (const t of data.taches) {
    if (!t.echeance) continue;
    const { jour, ligne } = creneau(t.echeance);
    const k = `${jour}:${ligne}`;
    ici.set(k, [...(ici.get(k) ?? []), t]);
  }
  const rdv = new Map<string, SemaineTaches['rdv']>();
  for (const r of data.rdv) {
    const { jour, ligne } = creneau(r.debut);
    const k = `${jour}:${Math.max(ligne, 0)}`;
    rdv.set(k, [...(rdv.get(k) ?? []), r]);
  }

  const over = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(MIME)) e.preventDefault();
  };
  const drop = (jour: number, ligne: number) => (e: DragEvent) => {
    e.preventDefault();
    const t = toutes.find((x) => x.id === e.dataTransfer.getData(MIME));
    if (t) onMove(t, vers(lundi, jour, ligne));
  };
  const cellule = (jour: number, ligne: number) => (
    <div
      key={`${jour}:${ligne}`}
      className={`sem-cell ${ligne === -1 ? 'journee' : ''}`}
      data-jour={jour}
      data-ligne={ligne}
      onDragOver={over}
      onDrop={drop(jour, ligne)}
    >
      {(rdv.get(`${jour}:${ligne}`) ?? []).map((r) => {
        const duree = Math.max(
          1,
          Math.round((Date.parse(r.fin) - Date.parse(r.debut)) / 1_800_000),
        );
        return (
          <div
            key={`${r.debut}-${r.titre}`}
            className="rdv"
            style={{ height: duree * HAUTEUR - 2 }}
          >
            {r.titre}
          </div>
        );
      })}
      {(ici.get(`${jour}:${ligne}`) ?? []).map((t) => (
        <Carte key={t.id} t={t} onOpen={onOpen} />
      ))}
    </div>
  );

  const entetes = Array.from({ length: COLONNES }, (_, j) =>
    j < 5 ? `${JOURS[j]} ${Number(plusJours(lundi, j).slice(8))}` : 'Week-end',
  );
  return (
    <>
      {data.enRetard.length > 0 && (
        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-h">
            <h2>En retard</h2>
          </div>
          <div className="panel-b sem-retard">
            {data.enRetard.map((t) => (
              <Carte key={t.id} t={t} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
      {data.rdvEtat === 'non_configure' && (
        <p className="small muted">
          Branchez Google Agenda dans Paramètres pour voir vos rendez-vous dans la semaine.
        </p>
      )}
      <div className="panel sem">
        <div className="sem-grille">
          <div />
          {entetes.map((h) => (
            <div key={h} className="sem-entete">
              {h}
            </div>
          ))}
          <div className="sem-heure">Journée</div>
          {Array.from({ length: COLONNES }, (_, j) => cellule(j, -1))}
          {Array.from({ length: LIGNES }, (_, l) => [
            <div key={`h${l}`} className="sem-heure">
              {l % 2 === 0 ? heureDeLigne(l) : ''}
            </div>,
            ...Array.from({ length: COLONNES }, (_, j) => cellule(j, l)),
          ])}
        </div>
      </div>
    </>
  );
}
