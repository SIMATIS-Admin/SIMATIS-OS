import type { SemaineTaches, TacheVue } from '../../api.js';
import { Icon } from '../../icons.js';
import { estRendezVous, joursCouverts } from '../taches/agenda.js';
import { heureParis, jourParis } from '../taches/creneaux.js';

export function JourneeCommerciale({
  jour,
  data,
  onRdv,
  onTache,
}: {
  jour: string;
  data: SemaineTaches;
  onRdv: (id: string) => void;
  onTache: (t: TacheVue) => void;
}) {
  const rdv = data.rdv.filter((r) => joursCouverts(r).includes(jour));
  const taches = data.taches.filter(
    (t) => t.echeance && jourParis(t.echeance) === jour && estRendezVous(t),
  );
  const evenements = [
    ...rdv.map((r) => ({
      id: `rdv-${r.agenda}-${r.id}`,
      titre: r.titre || 'Rendez-vous',
      debut: r.debut,
      journee: r.journee,
      sous: [r.agenda, r.lieu].filter(Boolean).join(' · '),
      fin: r.fin,
      ouvrir: () => onRdv(r.id),
      fait: false,
    })),
    ...taches.map((t) => ({
      id: `tache-${t.instance?.slug ?? ''}-${t.id}`,
      titre: t.titre,
      debut: t.echeance!,
      journee: !t.avecHeure,
      sous: [t.contact?.nom, t.opportunite?.titre, t.instance?.nom].filter(Boolean).join(' · '),
      fin: null,
      ouvrir: () => onTache(t),
      fait: t.fait,
    })),
  ].sort((a, b) => Number(b.journee) - Number(a.journee) || a.debut.localeCompare(b.debut));
  return (
    <section className="panel com-planning" aria-label="Planning du jour">
      <header className="panel-h">
        <h2>Mon planning</h2>
        <span className="small muted">
          {evenements.length} événement{evenements.length > 1 ? 's' : ''}
        </span>
      </header>
      {evenements.length === 0 ? (
        <p className="empty">Aucun rendez-vous prévu ce jour.</p>
      ) : (
        <ol className="com-planning-liste">
          {evenements.map((r) => (
            <li key={r.id}>
              <span className="com-planning-heure">
                {r.journee ? 'Journée' : heureParis(r.debut)}
                {!r.journee && r.fin && <small>{heureParis(r.fin)}</small>}
              </span>
              <button
                className={`com-planning-evenement ${r.fait ? 'faite' : ''}`}
                onClick={r.ouvrir}
              >
                <Icon name="cal" />
                <span>
                  <strong>{r.titre}</strong>
                  {r.sous && <small>{r.sous}</small>}
                  {r.fait && <small>Terminée</small>}
                </span>
                <Icon name="panel" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
