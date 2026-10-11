import { useState, type DragEvent } from 'react';
import type { SemaineTaches, TacheSaisie, TacheVue } from '../../api.js';
import { Icon } from '../../icons.js';
import { ACTIVITES } from './commun.js';
import { heureParis, jourParis, memeHeure } from './creneaux.js';
import { DEBUT, LIGNES, placer, versCreneau } from './placement.js';
import { Carte, MIME_TACHE } from './Semaine.js';

const HAUTEUR = 24; // px per half hour, kept in sync with .gr-creneau in styles.css
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Pipedrive-like hour grid: timed activities on their duration, the others counted in a « day »
// band at the top of each day, so twelve to-dos never pile up in the same hour.
export function Grille({
  jours,
  data,
  onOpen,
  onPatch,
}: {
  jours: string[];
  data: SemaineTaches;
  onOpen: (t: TacheVue) => void;
  onPatch: (t: TacheVue, patch: TacheSaisie) => void;
}) {
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());
  const toutes = [...data.enRetard, ...data.taches, ...data.sansEcheance];
  const ouvertes = data.taches.filter((t) => !t.fait && t.echeance);
  const duJour = (jour: string) => ouvertes.filter((t) => jourParis(t.echeance ?? '') === jour);

  const accepte = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(MIME_TACHE)) e.preventDefault();
  };
  const tache = (e: DragEvent) => {
    e.preventDefault();
    return toutes.find((x) => x.id === e.dataTransfer.getData(MIME_TACHE));
  };
  const versCreneauDrop = (jour: string, ligne: number) => (e: DragEvent) => {
    const t = tache(e);
    if (t) onPatch(t, { echeance: versCreneau(jour, ligne), avecHeure: true });
  };
  const versJournee = (jour: string) => (e: DragEvent) => {
    const t = tache(e);
    if (!t) return;
    const memeJour = t.echeance && jourParis(t.echeance) === jour;
    onPatch(
      t,
      memeJour ? { avecHeure: false } : { echeance: memeHeure(t.echeance, jour), avecHeure: false },
    );
  };
  const basculer = (jour: string) =>
    setOuverts((cur) => {
      const next = new Set(cur);
      if (next.has(jour)) next.delete(jour);
      else next.add(jour);
      return next;
    });

  const colonne = (jour: string) => {
    const timed = duJour(jour).filter((t) => t.avecHeure);
    const places = placer(
      timed.map((t) => ({ id: t.id, debut: t.echeance ?? '', minutes: t.dureeMinutes ?? 30 })),
    );
    const rdv = data.rdv.filter((r) => jourParis(r.debut) === jour);
    const rdvPlaces = placer(
      rdv.map((r, k) => ({
        id: String(k),
        debut: r.debut,
        minutes: Math.max(30, (Date.parse(r.fin) - Date.parse(r.debut)) / 60_000),
      })),
    );
    return Array.from({ length: LIGNES }, (_, ligne) => (
      <div
        key={`${jour}:${ligne}`}
        className={`gr-creneau ${ligne % 2 ? '' : 'heure'}`}
        data-jour={jour}
        data-ligne={ligne}
        onDragOver={accepte}
        onDrop={versCreneauDrop(jour, ligne)}
      >
        {rdv.map((r, k) => {
          const p = rdvPlaces.get(String(k));
          return p?.ligne === ligne ? (
            <div
              key={`${r.debut}-${r.titre}`}
              className="gr-rdv"
              style={{ height: p.hauteur * HAUTEUR - 2 }}
            >
              <small>{heureParis(r.debut)}</small> <span>{r.titre}</span>
            </div>
          ) : null;
        })}
        {timed.map((t) => {
          const p = places.get(t.id);
          if (p?.ligne !== ligne) return null;
          const [ico] = ACTIVITES[t.type];
          return (
            <div
              key={t.id}
              className={`gr-activite ${t.origine} ${t.occupe ? 'occupe' : ''}`}
              style={{
                height: p.hauteur * HAUTEUR - 2,
                left: `${(p.colonne / p.colonnes) * 100}%`,
                width: `${100 / p.colonnes}%`,
              }}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(MIME_TACHE, t.id)}
              onClick={() => onOpen(t)}
              title={t.titre}
            >
              <Icon name={ico} />
              <b>{t.titre}</b>
              <small>{heureParis(t.echeance ?? '')}</small>
            </div>
          );
        })}
      </div>
    ));
  };

  return (
    <div className="panel gr" style={{ ['--gr-jours' as string]: jours.length }}>
      <div className="gr-grille">
        <div />
        {jours.map((jour, j) => (
          <div key={jour} className="gr-entete">
            {jours.length > 1 ? `${JOURS[j]} ${Number(jour.slice(8))}` : ''}
          </div>
        ))}
        <div className="gr-heure">Journée</div>
        {jours.map((jour) => {
          const liste = duJour(jour).filter((t) => !t.avecHeure);
          return (
            <div
              key={jour}
              className="gr-journee"
              data-journee={jour}
              onDragOver={accepte}
              onDrop={versJournee(jour)}
            >
              {liste.length > 0 && (
                <button className="lien" onClick={() => basculer(jour)}>
                  {`${liste.length} activité${liste.length > 1 ? 's' : ''}`}
                </button>
              )}
              {ouverts.has(jour) &&
                liste.map((t) => <Carte key={t.id} t={t} heure={null} onOpen={onOpen} />)}
            </div>
          );
        })}
        <div className="gr-heures">
          {Array.from({ length: LIGNES }, (_, l) => (
            <div key={l} className="gr-heure" style={{ height: HAUTEUR }}>
              {l % 2 === 0 ? `${DEBUT + l / 2} h` : ''}
            </div>
          ))}
        </div>
        {jours.map((jour) => (
          <div key={jour} className="gr-colonne">
            {colonne(jour)}
          </div>
        ))}
      </div>
    </div>
  );
}
