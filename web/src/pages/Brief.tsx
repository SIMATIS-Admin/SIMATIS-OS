import { type ReactNode, useEffect, useState } from 'react';
import {
  fetchBrief,
  fetchCompteurRdv,
  fetchRadar,
  type Brief as BriefData,
  type Compte,
} from '../api.js';
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

export function Brief({ slug, children }: { slug: string; children?: ReactNode }) {
  const [data, setData] = useState<BriefData | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);
  // Contacts qui ont répondu à la prospection (Radar) ; la tuile disparaît si le Radar ne répond pas.
  const [reponses, setReponses] = useState<number | null>(null);
  // Blocs de l'agenda que l'OS n'a pas su classer : la tuile n'existe que s'il y en a.
  const [aConfirmer, setAConfirmer] = useState(0);
  useEffect(() => {
    let actif = true;
    fetchCompteurRdv(slug).then(
      (n) => actif && setAConfirmer(Number.isInteger(n) ? n : 0),
      () => actif && setAConfirmer(0),
    );
    return () => {
      actif = false;
    };
  }, [slug]);
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
  const prochainTexte =
    data.rdvEtat === 'non_configure'
      ? 'Agenda non connecté'
      : data.rdvEtat === 'erreur'
        ? 'Agenda momentanément indisponible'
        : prochain
          ? `${heure(prochain.debut)} · ${prochain.titre}`
          : "Aucun autre rendez-vous aujourd'hui";

  return (
    <div className="brief-focus">
      {message && (
        <p role="status" className="brief-erreur">
          Actualisation impossible. Les dernières données restent affichées.
        </p>
      )}
      <section className="brief-priorite" aria-label="Prochain rendez-vous">
        <span className="brief-agenda-icone" aria-hidden="true">
          <Icon name="cal" />
        </span>
        <div>
          <p>{prochainTexte}</p>
          {prochain?.lieu && <span className="small muted">{prochain.lieu}</span>}
        </div>
        <a className="btn primary" href={`#/${slug}/agenda`}>
          Ouvrir mon agenda
        </a>
      </section>
      <h2 className="brief-reperes-titre">Aujourd’hui</h2>
      <div className="brief-reperes">
        <a className="brief-repere" href={`#/${slug}/agenda`}>
          <span className="v">{data.rdvEtat === 'ok' ? data.rdv.length : '–'}</span>
          <span className="l">Rendez-vous</span>
        </a>
        <a className="brief-repere" href={taches}>
          <span className="v">{jour.total}</span>
          <span className="l">Tâches du jour</span>
        </a>
        <a className={`brief-repere ${retard > 0 ? 'alerte' : ''}`} href={taches}>
          <span className="v">{retard}</span>
          <span className="l">En retard</span>
        </a>
        {aConfirmer > 0 && (
          <a className="brief-repere" href={`#/${slug}/rendez-vous`}>
            <span className="v">{aConfirmer}</span>
            <span className="l">À confirmer</span>
          </a>
        )}
        {reponses !== null && (
          <a className="brief-repere" href={`#/${slug}/radar`}>
            <span className="v">{reponses}</span>
            <span className="l">Ont répondu</span>
          </a>
        )}
      </div>
      {children && <div className="brief-intermede">{children}</div>}
      <div className="brief-details">
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
