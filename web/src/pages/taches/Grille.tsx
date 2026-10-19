import type { CSSProperties, DragEvent } from 'react';
import type { RdvAgenda, SemaineTaches, TacheSaisie, TacheVue } from '../../api.js';
import { Icon } from '../../icons.js';
import { COULEUR_TYPE, MIME_TACHE, couleurRdv, estRendezVous, joursCouverts } from './agenda.js';
import { ACTIVITES } from './commun.js';
import { heureParis, jourParis, memeHeure } from './creneaux.js';
import { DEBUT, LIGNES, placer, versCreneau } from './placement.js';

const HAUTEUR = 24; // px per half hour, kept in sync with .gr-creneau in styles.css
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const couleur = (c: string) => ({ ['--c' as string]: c }) as CSSProperties;

// Hour grid of the meetings only: Google events and the CRM's timed meetings and lunches, each
// in its colour. All-day events sit in the band at the top; tasks live in the panel beside.
export function Grille({
  jours,
  data,
  slug,
  aujourdhui,
  maintenant,
  onOpen,
  onPatch,
  onJour,
}: {
  jours: string[];
  data: SemaineTaches;
  slug: string;
  aujourdhui: string;
  maintenant: Date;
  onOpen: (t: TacheVue) => void;
  onPatch: (t: TacheVue, patch: TacheSaisie) => void;
  onJour?: (jour: string) => void;
}) {
  const toutes = [...data.enRetard, ...data.taches, ...data.sansEcheance];
  const reunions = data.taches.filter((t) => t.echeance && estRendezVous(t));

  const accepte = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(MIME_TACHE)) e.preventDefault();
  };
  const tache = (e: DragEvent) => {
    e.preventDefault();
    return toutes.find((x) => x.id === e.dataTransfer.getData(MIME_TACHE));
  };
  // A meeting dropped on a slot takes that time; a task only changes day (it has no hour).
  const versCreneauDrop = (jour: string, ligne: number) => (e: DragEvent) => {
    const t = tache(e);
    if (!t) return;
    if (t.type === 'reunion' || t.type === 'dejeuner') {
      onPatch(t, { echeance: versCreneau(jour, ligne), avecHeure: true });
    } else if (!t.echeance || jourParis(t.echeance) !== jour) {
      onPatch(t, { echeance: memeHeure(t.echeance, jour) });
    }
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

  const colonne = (jour: string) => {
    const rdv = data.rdv.filter((r) => !r.journee && jourParis(r.debut) === jour);
    const activites = reunions.filter((t) => jourParis(t.echeance ?? '') === jour);
    // Meetings and CRM activities share the width when they overlap.
    const places = placer([
      ...rdv.map((r, k) => ({
        id: `r${k}`,
        debut: r.debut,
        minutes: Math.max(30, (Date.parse(r.fin) - Date.parse(r.debut)) / 60_000),
      })),
      ...activites.map((t) => ({
        id: `t${t.id}`,
        debut: t.echeance ?? '',
        minutes: t.dureeMinutes ?? 30,
      })),
    ]);
    const position = (id: string, ligne: number) => {
      const p = places.get(id);
      if (p?.ligne !== ligne) return null;
      return {
        height: p.hauteur * HAUTEUR - 2,
        left: `${(p.colonne / p.colonnes) * 100}%`,
        width: `${100 / p.colonnes}%`,
      };
    };
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
          const pos = position(`r${k}`, ligne);
          return pos ? (
            <a
              key={`${r.agenda}:${r.id}`}
              className="gr-rdv"
              style={{ ...pos, ...couleur(couleurRdv(r)) }}
              href={`#/${slug}/rendez-vous/ouvrir/${r.id}`}
              title={`${heureParis(r.debut)} – ${heureParis(r.fin)} · ${r.titre}${r.lieu ? ` · ${r.lieu}` : ''}`}
            >
              <small>{heureParis(r.debut)}</small> <b>{r.titre}</b>
              {r.lieu && <span className="gr-lieu">{r.lieu}</span>}
            </a>
          ) : null;
        })}
        {activites.map((t) => {
          const pos = position(`t${t.id}`, ligne);
          if (!pos) return null;
          return (
            <div
              key={t.id}
              className="gr-rdv gr-activite"
              style={{ ...pos, ...couleur(COULEUR_TYPE[t.type]) }}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(MIME_TACHE, t.id)}
              onClick={() => onOpen(t)}
              title={t.titre}
            >
              <small>{heureParis(t.echeance ?? '')}</small> <Icon name={ACTIVITES[t.type][0]} />
              <b>{t.titre}</b>
            </div>
          );
        })}
      </div>
    ));
  };

  // Where "now" falls in today's column, if within the grid's hours.
  const minutes = (() => {
    const [h, m] = heureParis(maintenant.toISOString()).split(':').map(Number) as [number, number];
    return (h - DEBUT) * 60 + m;
  })();
  const ligneMaintenant = minutes >= 0 && minutes < LIGNES * 30 ? (minutes / 30) * HAUTEUR : null;

  const journee = (jour: string): RdvAgenda[] =>
    data.rdv.filter((r) => r.journee && joursCouverts(r).includes(jour));

  return (
    <div className="panel gr" style={{ ['--gr-jours' as string]: jours.length }}>
      <div className="gr-grille">
        <div />
        {jours.map((jour) => {
          const j = (new Date(`${jour}T12:00:00Z`).getUTCDay() + 6) % 7;
          const libelle = `${JOURS[j]} ${Number(jour.slice(8))}`;
          return (
            <div key={jour} className={`gr-entete ${jour === aujourdhui ? 'auj' : ''}`}>
              {onJour ? (
                <button
                  className="lien"
                  title="Voir cette journée"
                  onClick={() => onJour(jour)}
                  onDragOver={accepte}
                  onDrop={versJournee(jour)}
                >
                  {libelle}
                </button>
              ) : (
                libelle
              )}
            </div>
          );
        })}
        <div className="gr-heure">Journée</div>
        {jours.map((jour) => (
          <div
            key={jour}
            className="gr-journee"
            data-journee={jour}
            onDragOver={accepte}
            onDrop={versJournee(jour)}
          >
            {journee(jour).map((r) => (
              <span
                key={`${r.agenda}:${r.id}`}
                className="gr-jentier"
                style={couleur(couleurRdv(r))}
                title={r.titre}
              >
                {r.titre}
              </span>
            ))}
          </div>
        ))}
        <div className="gr-heures">
          {Array.from({ length: LIGNES }, (_, l) => (
            <div key={l} className="gr-heure" style={{ height: HAUTEUR }}>
              {l % 2 === 0 ? `${DEBUT + l / 2} h` : ''}
            </div>
          ))}
        </div>
        {jours.map((jour) => (
          <div key={jour} className={`gr-colonne ${jour === aujourdhui ? 'auj' : ''}`}>
            {colonne(jour)}
            {jour === aujourdhui && ligneMaintenant !== null && (
              <div className="gr-maintenant" style={{ top: ligneMaintenant }} aria-hidden />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
