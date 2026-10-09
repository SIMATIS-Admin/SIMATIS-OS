import { useCallback, useEffect, useState } from 'react';
import { fetchBrief, marquerFait, type Brief as BriefData, type Compte } from '../api.js';
import { Icon } from '../icons.js';
import { Tip } from './widgets.js';

const CANAUX = {
  email: ['send', 'Email'],
  appel: ['phone', 'Appel'],
  tache: ['check', 'Tâche'],
} as const;
const FILTRES = [
  ['tout', 'Toutes'],
  ['email', 'Emails'],
  ['appel', 'Appels'],
  ['tache', 'Autres'],
] as const;
type Filtre = (typeof FILTRES)[number][0];

const heure = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  });
const jourCourt = (jour: string) =>
  new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });

function Periode({ titre, sous, c }: { titre: string; sous: string; c: Compte }) {
  return (
    <div className="activ-row">
      <div>
        <b>{titre}</b>
        <div className="small muted">{sous}</div>
      </div>
      <div className="activ-n num">
        {c.total}
        <small>tâches</small>
      </div>
      <div className="activ-d">
        <span>
          <Icon name="send" />
          <b className="num">{c.email}</b> email{c.email > 1 ? 's' : ''}
        </span>
        <span>
          <Icon name="phone" />
          <b className="num">{c.appel}</b> appel{c.appel > 1 ? 's' : ''}
        </span>
        <span className="muted">
          <b className="num">{c.autre}</b> autre{c.autre > 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

export function Brief({ slug }: { slug: string }) {
  const [data, setData] = useState<BriefData | null>(null);
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchBrief(slug).then(setData, (e: unknown) => setMessage(String(e)));
  }, [slug]);
  useEffect(load, [load]);

  if (!data) return message ? <div className="empty">{message}</div> : null;

  const nb = (f: Filtre) => data.taches.filter((t) => f === 'tout' || t.canal === f).length;
  const shown = data.taches.filter((t) => filtre === 'tout' || t.canal === filtre);
  const fait = (id: string) =>
    marquerFait(slug, id).then(
      (r) => {
        setMessage(
          r.simulation
            ? 'Simulation : la tâche est marquée faite ici, HubSpot n’a pas été modifié (écritures réelles désactivées).'
            : null,
        );
        load();
      },
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );
  const veille = data.realisees.veille;

  return (
    <>
      {message && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div>{message}</div>
        </div>
      )}
      <div className="grid g-main">
        <div className="panel">
          <div className="panel-h">
            <h2>
              Votre journée{' '}
              <span className={`badge ${data.source === 'hubspot' ? 'blue' : ''}`}>
                {data.source === 'hubspot' ? 'Tâches HubSpot' : "Tâches de l'OS"}
              </span>
            </h2>
            <span className="muted small">{nb('tout')} à faire</span>
          </div>
          <div className="vq-filter">
            {FILTRES.map(([f, l]) => (
              <button
                key={f}
                className={`chip ${filtre === f ? 'on' : ''}`}
                onClick={() => setFiltre(f)}
              >
                {l} ({nb(f)})
              </button>
            ))}
          </div>
          <div className="panel-b">
            {filtre === 'tout' && data.rdv.length > 0 && (
              <>
                <h4 className="sec-h">Rendez-vous</h4>
                <ul className="tasks">
                  {data.rdv.map((r) => (
                    <li key={`${r.debut}-${r.titre}`}>
                      <span className="canal">
                        <Icon name="cal" />
                      </span>
                      <div>
                        <b>
                          {heure(r.debut)}, {r.titre}
                        </b>
                        {r.lieu && <div className="small muted">{r.lieu}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
                <h4 className="sec-h">Tâches du jour</h4>
              </>
            )}
            {data.rdvEtat === 'erreur' && (
              <p className="small" style={{ color: 'var(--red)' }}>
                Agenda indisponible : {data.rdvErreur}
              </p>
            )}
            {shown.length ? (
              <ul className="tasks">
                {shown.map((t) => {
                  const [ico, lbl] = CANAUX[t.canal];
                  return (
                    <li key={t.id}>
                      <span className="canal" title={lbl}>
                        <Icon name={ico} />
                      </span>
                      <div>
                        <b>{t.titre}</b>
                        <div className="small muted">
                          {t.contact
                            ? `${t.contact}${t.entreprise ? `, ${t.entreprise}` : ''} · `
                            : ''}
                          {t.situation === 'retard' ? (
                            <span className="late">En retard</span>
                          ) : (
                            "Aujourd'hui"
                          )}
                          {t.prepare && (
                            <>
                              {' · '}
                              <span className="badge green">Brouillon prêt dans Gmail</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button className="btn sm" onClick={() => void fait(t.id)}>
                        Marquer fait
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="empty">Aucune tâche pour ce filtre.</div>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h">
            <h2>
              Tâches réalisées{' '}
              <Tip text="Tâches marquées faites, par canal. Les autres tâches regroupent tout ce qui n'est ni un email ni un appel. Jours comptés à l'heure de Paris." />
            </h2>
            {data.realisees.aujourdhui.total > 0 && (
              <span className="small muted">
                Aujourd'hui : <b className="num">{data.realisees.aujourdhui.total}</b>
              </span>
            )}
          </div>
          <div className="panel-b activ">
            <Periode titre="Dernier jour ouvré" sous={jourCourt(veille.jour)} c={veille} />
            <Periode titre="7 derniers jours" sous="avec aujourd'hui" c={data.realisees.semaine} />
            <Periode titre="30 derniers jours" sous="avec aujourd'hui" c={data.realisees.mois} />
          </div>
        </div>
      </div>
    </>
  );
}
