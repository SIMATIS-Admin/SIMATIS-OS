import { useEffect, useState } from 'react';
import { fetchBrief, type Brief as BriefData, type Compte } from '../api.js';
import { Icon } from '../icons.js';
import { PanneauProspection } from './Prospection.js';
import { Tip } from './widgets.js';

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
const pluriel = (n: number, mot: string) => `${mot}${n > 1 ? 's' : ''}`;

function Periode({
  titre,
  sous,
  c,
  rdv,
}: {
  titre: string;
  sous: string;
  c: Compte;
  rdv: number | null;
}) {
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
          <b className="num">{c.email}</b> {pluriel(c.email, 'email')}
        </span>
        <span>
          <Icon name="phone" />
          <b className="num">{c.appel}</b> {pluriel(c.appel, 'appel')}
        </span>
        <span className="muted">
          <b className="num">{c.autre}</b> {pluriel(c.autre, 'action')}
        </span>
        {rdv !== null && (
          <span>
            <Icon name="cal" />
            <b className="num">{rdv}</b> {pluriel(rdv, 'RDV tenu')}
          </span>
        )}
      </div>
    </div>
  );
}

export function Brief({ slug }: { slug: string }) {
  const [data, setData] = useState<BriefData | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchBrief(slug).then(setData, (e: unknown) => setMessage(String(e)));
  }, [slug]);

  if (!data) return message ? <div className="empty">{message}</div> : null;

  const { retard, jour } = data.aFaire;
  const taches = `#/${slug}/taches`;
  const veille = data.realisees.veille;

  return (
    <>
      <div className="grid g3">
        <a className={`panel kpi kpi-link ${retard > 0 ? 'alerte' : ''}`} href={taches}>
          <span className="l">Tâches en retard</span>
          <span className="v">{retard}</span>
          <span className="small muted">
            {data.source === 'hubspot' ? 'Tâches HubSpot' : "Tâches de l'OS"}
          </span>
        </a>
        <a className="panel kpi kpi-link" href={taches}>
          <span className="l">Tâches du jour</span>
          <span className="v">{jour.total}</span>
          <span className="activ-d">
            <span>
              <Icon name="send" />
              <b className="num">{jour.email}</b> {pluriel(jour.email, 'email')}
            </span>
            <span>
              <Icon name="phone" />
              <b className="num">{jour.appel}</b> {pluriel(jour.appel, 'appel')}
            </span>
            <span className="muted">
              <b className="num">{jour.autre}</b> {pluriel(jour.autre, 'action')}
            </span>
          </span>
        </a>
        <a className="panel kpi kpi-link" href={`#/${slug}/agenda`}>
          <span className="l">Rendez-vous et réunions</span>
          <span className="v">{data.rdvEtat === 'ok' ? data.rdv.length : '–'}</span>
          <span className="small muted">
            {data.rdvEtat === 'non_configure'
              ? 'Agenda non connecté'
              : data.rdvEtat === 'erreur'
                ? 'Agenda indisponible'
                : "Aujourd'hui"}
          </span>
        </a>
      </div>
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-h">
            <h2>Rendez-vous et réunions du jour</h2>
          </div>
          <div className="panel-b">
            {data.rdvEtat === 'erreur' && (
              <p className="small" style={{ color: 'var(--red)' }}>
                Agenda indisponible : {data.rdvErreur}
              </p>
            )}
            {data.rdv.length ? (
              <ul className="tasks">
                {data.rdv.map((r) => (
                  <li key={`${r.debut}-${r.titre}`}>
                    <span className="canal">
                      <Icon name="cal" />
                    </span>
                    <div>
                      <b>
                        {r.journee ? 'Toute la journée' : heure(r.debut)}, {r.titre}
                      </b>
                      {r.lieu && <div className="small muted">{r.lieu}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">
                {data.rdvEtat === 'non_configure'
                  ? 'Connectez Google Agenda dans Paramètres pour voir vos rendez-vous.'
                  : "Aucun rendez-vous aujourd'hui."}
              </div>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h">
            <h2>
              Activité{' '}
              <Tip text="Tâches marquées faites, par canal, et rendez-vous tenus : terminés, avec au moins un invité, hors événements sur la journée entière. Jours comptés à l'heure de Paris." />
            </h2>
            {data.realisees.aujourdhui.total > 0 && (
              <span className="small muted">
                Aujourd'hui : <b className="num">{data.realisees.aujourdhui.total}</b>
              </span>
            )}
          </div>
          <div className="panel-b activ">
            <Periode
              titre="Dernier jour ouvré"
              sous={jourCourt(veille.jour)}
              c={veille}
              rdv={data.rdvTenus?.veille ?? null}
            />
            <Periode
              titre="7 derniers jours"
              sous="avec aujourd'hui"
              c={data.realisees.semaine}
              rdv={data.rdvTenus?.semaine ?? null}
            />
            <Periode
              titre="30 derniers jours"
              sous="avec aujourd'hui"
              c={data.realisees.mois}
              rdv={data.rdvTenus?.mois ?? null}
            />
          </div>
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        <PanneauProspection slug={slug} />
      </div>
    </>
  );
}
