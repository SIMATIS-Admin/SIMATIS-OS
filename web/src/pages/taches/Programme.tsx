import type { SemaineTaches, TacheVue } from '../../api.js';
import { Icon } from '../../icons.js';
import { COULEUR_TYPE, couleurRdv, estCreneau, estRendezVous, joursCouverts } from './agenda.js';
import { ACTIVITES, plusJours } from './commun.js';
import { anciennete, heureParis, jourParis } from './creneaux.js';
import { LigneTache, heureReelle, nomJour, tachesDuJour } from './Panneau.js';

type Rendezvous = {
  cle: string;
  debut: string | null;
  heures: string;
  titre: string;
  detail: string | null;
  couleur: string;
  icone: string | null;
  lien?: string;
  tache?: TacheVue;
};

// The week day by day: meetings with their hours on one side, the day's tasks on the other.
export function Programme({
  lundi,
  data,
  slug,
  aujourdhui,
  onOpen,
  onFait,
}: {
  lundi: string;
  data: SemaineTaches;
  slug: string;
  aujourdhui: string;
  onOpen: (t: TacheVue) => void;
  onFait: (t: TacheVue) => void;
}) {
  const heure = heureReelle(data);
  const jours = Array.from({ length: 7 }, (_, k) => plusJours(lundi, k));

  const rendezVous = (jour: string): Rendezvous[] =>
    [
      ...data.rdv
        .filter((r) => !r.journee && !estCreneau(r) && jourParis(r.debut) === jour)
        .map((r) => ({
          cle: `${r.agenda}:${r.id}`,
          debut: r.debut,
          heures: `${heureParis(r.debut)} – ${heureParis(r.fin)}`,
          titre: r.titre,
          detail: r.lieu,
          couleur: couleurRdv(r),
          icone: null,
          lien: `#/${slug}/rendez-vous/ouvrir/${r.id}`,
        })),
      ...data.taches
        .filter((t) => t.echeance && estRendezVous(t) && jourParis(t.echeance) === jour)
        .map((t) => ({
          cle: t.id,
          debut: t.echeance,
          heures: heureParis(t.echeance ?? ''),
          titre: t.titre,
          detail: [t.contact?.nom, t.opportunite?.titre].filter(Boolean).join(' · ') || null,
          couleur: COULEUR_TYPE[t.type],
          icone: ACTIVITES[t.type][0],
          tache: t,
        })),
    ].sort((a, b) => (a.debut ?? '').localeCompare(b.debut ?? ''));

  const enRetard = [...data.enRetard].sort((a, b) =>
    (a.echeance ?? '').localeCompare(b.echeance ?? ''),
  );

  return (
    <div className="ag-programme">
      {enRetard.length > 0 && (
        <section className="panel ag-jour retard" aria-label="En retard">
          <header>
            <h3>{`En retard (${enRetard.length})`}</h3>
          </header>
          <ul className="ag-liste">
            {enRetard.map((t) => (
              <LigneTache key={t.id} t={t} heure={null} onOpen={onOpen} onFait={onFait}>
                <span className="late small">{t.echeance ? anciennete(t.echeance) : ''}</span>
              </LigneTache>
            ))}
          </ul>
        </section>
      )}
      {jours.map((jour, k) => {
        const rdv = rendezVous(jour);
        const taches = tachesDuJour(data, jour);
        // All-day events (holidays, trade fairs) are labels of the day, not appointments.
        const journee = data.rdv.filter((r) => r.journee && joursCouverts(r).includes(jour));
        // Slots of more than two hours are bookings: shown beside the date, not as meetings.
        const creneaux = data.rdv.filter((r) => estCreneau(r) && jourParis(r.debut) === jour);
        // The weekend only shows when something is planned.
        if (k >= 5 && rdv.length === 0 && taches.length === 0) return null;
        return (
          <section
            key={jour}
            className={`panel ag-jour ${jour === aujourdhui ? 'auj' : ''}`}
            aria-label={nomJour(jour, true)}
          >
            <header>
              <h3>{nomJour(jour, true)}</h3>
              {jour === aujourdhui && <span className="badge green">Aujourd’hui</span>}
              {journee.map((r) => (
                <span
                  key={`${r.agenda}:${r.id}`}
                  className="gr-jentier"
                  style={{ ['--c' as string]: couleurRdv(r) }}
                  title="Journée entière"
                >
                  {r.titre}
                </span>
              ))}
              {creneaux.map((r) => (
                <span
                  key={`${r.agenda}:${r.id}`}
                  className="ag-plage"
                  style={{ ['--c' as string]: couleurRdv(r) }}
                  title="Créneau réservé (plus de 2 h)"
                >
                  {`${heureParis(r.debut)}–${heureParis(r.fin)} ${r.titre}`}
                </span>
              ))}
            </header>
            <div className="ag-jour-corps">
              <div>
                <h4>Rendez-vous</h4>
                {rdv.length ? (
                  <ul className="ag-liste">
                    {rdv.map((r) => (
                      <li
                        key={r.cle}
                        className="ag-rdv-ligne"
                        style={{ ['--c' as string]: r.couleur }}
                      >
                        <span className="num ag-heures">{r.heures}</span>
                        <span className="ag-rdv-texte">
                          <b>
                            {r.icone && <Icon name={r.icone} />} {r.titre}
                          </b>
                          {r.detail && <small>{r.detail}</small>}
                        </span>
                        {r.lien ? (
                          <a className="btn sm" href={r.lien}>
                            Préparer
                          </a>
                        ) : (
                          r.tache && (
                            <button className="btn sm" onClick={() => onOpen(r.tache as TacheVue)}>
                              Ouvrir
                            </button>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ag-vide">Aucun rendez-vous</p>
                )}
              </div>
              <div>
                <h4>Tâches</h4>
                {taches.length ? (
                  <ul className="ag-liste">
                    {taches.map((t) => (
                      <LigneTache
                        key={t.id}
                        t={t}
                        heure={heure(t)}
                        onOpen={onOpen}
                        onFait={onFait}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="ag-vide">Aucune tâche</p>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
