import { useEffect, useState } from 'react';
import { fetchBrief, fetchRadar, type Brief as BriefData, type Compte } from '../api.js';
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
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);
  // Contacts qui ont répondu à la prospection (Radar) ; la tuile disparaît si le Radar ne répond pas.
  const [reponses, setReponses] = useState<number | null>(null);
  useEffect(() => {
    let actif = true;
    fetchRadar(slug)
      .then((r) => r.ontRepondu.total)
      .then(
        (n) => actif && setReponses(n),
        () => actif && setReponses(null),
      );
    return () => {
      actif = false;
    };
  }, [slug]);

  useEffect(() => {
    let actif = true;
    const charger = () =>
      fetchBrief(slug).then(
        (d) => {
          if (actif) {
            setData(d);
            setMessage(null);
            setMaintenant(Date.now());
          }
        },
        (e: unknown) => {
          if (actif) setMessage(String(e));
        },
      );
    void charger();
    const intervalle = window.setInterval(() => {
      setMaintenant(Date.now());
      void charger();
    }, 60_000);
    return () => {
      actif = false;
      window.clearInterval(intervalle);
    };
  }, [slug]);

  if (!data)
    return (
      <div className="empty" role="status">
        {message ?? 'Ton brief se prépare…'}
      </div>
    );

  const { retard, jour } = data.aFaire;
  const taches = `#/${slug}/taches`;
  const veille = data.realisees.veille;
  const prochain =
    data.rdvEtat === 'ok'
      ? data.rdv
          .filter((r) => !r.journee && new Date(r.fin).getTime() > maintenant)
          .sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut))[0]
      : undefined;
  const faites = data.realisees.aujourdhui.total;
  const total = faites + jour.total + retard;
  const priorite =
    retard > 0
      ? {
          titre: 'Reprendre le fil.',
          texte: `${retard} ${pluriel(retard, 'tâche')} en retard. Choisis la prochaine action à faire avancer.`,
          action: 'Voir mes actions',
          lien: taches,
        }
      : prochain
        ? {
            titre: 'Un rendez-vous bien préparé.',
            texte: `${heure(prochain.debut)} · ${prochain.titre}`,
            action: 'Ouvrir mon agenda',
            lien: `#/${slug}/agenda`,
          }
        : jour.total > 0
          ? {
              titre: 'Une action, puis la suivante.',
              texte: `${jour.total} ${pluriel(jour.total, 'tâche')} à faire aujourd’hui. Commence par celle qui compte le plus.`,
              action: 'Choisir ma prochaine action',
              lien: taches,
            }
          : {
              titre: 'De la place pour avancer.',
              texte:
                'Aucune tâche prévue aujourd’hui. Le plus utile : faire avancer la prospection.',
              action: 'Prospecter',
              lien: `#/${slug}/prospection`,
            };

  return (
    <div className="brief-focus">
      <p className="brief-date">
        {new Date(maintenant).toLocaleDateString('fr-FR', {
          timeZone: 'Europe/Paris',
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      </p>
      {message && (
        <p role="status" className="brief-erreur">
          Actualisation impossible. Les dernières données restent affichées.
        </p>
      )}
      <section className="brief-priorite" aria-label="Priorité proposée">
        <div>
          <h2>{priorite.titre}</h2>
          <p>{priorite.texte}</p>
        </div>
        <a className="btn primary" href={priorite.lien}>
          {priorite.action}
          <Icon name="play" />
        </a>
        {total > 0 && (
          <div className="brief-progression">
            <span>
              {faites} / {total} tâches
            </span>
            <progress
              aria-label="Tâches terminées sur les tâches terminées, du jour et en retard"
              value={faites}
              max={total}
            />
          </div>
        )}
      </section>
      <div className="brief-reperes">
        <a className="panel kpi kpi-link" href={`#/${slug}/agenda`}>
          <span className="l">
            <Icon name="cal" /> Rendez-vous et réunions
          </span>
          <span className="v">{data.rdvEtat === 'ok' ? data.rdv.length : '–'}</span>
          <span className="small muted">
            {data.rdvEtat === 'non_configure'
              ? 'Agenda non connecté'
              : data.rdvEtat === 'erreur'
                ? 'Agenda indisponible'
                : "Aujourd'hui"}
          </span>
        </a>
        <a className="panel kpi kpi-link" href={taches}>
          <span className="l">
            <Icon name="list" /> Tâches du jour
          </span>
          <span className="v">{jour.total}</span>
          <span className="small muted">
            {jour.email} {pluriel(jour.email, 'email')} · {jour.appel}{' '}
            {pluriel(jour.appel, 'appel')} · {jour.autre} {pluriel(jour.autre, 'action')}
          </span>
        </a>
        <a className={`panel kpi kpi-link ${retard > 0 ? 'alerte' : ''}`} href={taches}>
          <span className="l">
            <Icon name="clock" /> Tâches en retard
          </span>
          <span className="v">{retard}</span>
          <span className="small muted">
            {data.source === 'hubspot' ? 'Tâches HubSpot' : "Tâches de l'OS"}
          </span>
        </a>
        {reponses !== null && (
          <a className="panel kpi kpi-link" href={`#/${slug}/radar`}>
            <span className="l">
              <Icon name="mail" /> Ont répondu
            </span>
            <span className="v">{reponses}</span>
            <span className="small muted">Prospection</span>
          </a>
        )}
      </div>
      <div className="brief-details">
        <details className="panel brief-historique">
          <summary>
            Rendez-vous et réunions du jour <Icon name="down" />
          </summary>
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
        </details>
        <details className="panel brief-historique">
          <summary>
            Mon activité récente <Icon name="down" />
          </summary>
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
        </details>
      </div>
      <div className="brief-details">
        <PanneauProspection slug={slug} />
      </div>
    </div>
  );
}
