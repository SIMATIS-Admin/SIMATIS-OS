import { useEffect, useState } from 'react';
import {
  creerCampagneFroid,
  creerCampagneRelance,
  fetchCampagne,
  fetchProspection,
  rapprocherEnvoisProspection,
  type CampagneProspection,
  type ResultatCampagne,
  type StatsProspection,
  type VueProspection,
} from '../api.js';
import { Attente } from './prospection/Attente.js';
import { ChoixContactsFroid } from './prospection/ChoixContactsFroid.js';
import { ChoixTaches } from './prospection/ChoixTaches.js';
import { Epuises } from './prospection/Epuises.js';
import { ReglageCampagne } from './prospection/ReglageCampagne.js';
import { Relecture } from './prospection/Relecture.js';
import { Resultat } from './prospection/Resultat.js';

const pluriel = (n: number, mot: string) => `${mot}${n > 1 ? 's' : ''}`;

// Compteur du jour : le même sur l'accueil Prospection et dans le Brief du jour. La jauge est plafonnée
// à 100 % et disparaît quand l'objectif est 0 (pas de pourcentage, donc pas de division par zéro).
export function JaugeJour({ jour, objectif }: Pick<StatsProspection, 'jour' | 'objectif'>) {
  const pct = objectif > 0 ? Math.min(100, Math.round((jour / objectif) * 100)) : 0;
  return (
    <div
      style={{
        background: 'var(--navy)',
        color: '#fff',
        borderRadius: 'var(--r-m)',
        padding: '16px 18px',
      }}
    >
      <div className="small" style={{ opacity: 0.8 }}>
        AUJOURD'HUI
      </div>
      <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }} className="num">
        <span>{jour}</span>{' '}
        <span style={{ fontSize: 16, fontWeight: 400 }}>
          {pluriel(jour, 'mail')}
          {objectif > 0 ? ` sur ${objectif}` : ''}
        </span>
      </div>
      {objectif > 0 && (
        <div
          role="progressbar"
          aria-label="Objectif du jour"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          style={{ background: 'rgba(255,255,255,.25)', height: 8, borderRadius: 4, marginTop: 10 }}
        >
          <div style={{ background: '#9FF7E8', width: `${pct}%`, height: 8, borderRadius: 4 }} />
        </div>
      )}
    </div>
  );
}

const lignes = (o: Record<string, number>, mot?: string) =>
  Object.entries(o).map(([k, v]) => (
    <div key={k}>
      {mot ? `${mot} ${k}` : k} : <b className="num">{v}</b>
    </div>
  ));

type Etape =
  | { nom: 'accueil' }
  | { nom: 'choix' }
  | { nom: 'choix-froid' }
  | { nom: 'epuises' }
  | { nom: 'reglage'; mode: 'relance' | 'froid'; ids: string[]; liens: Record<string, string> }
  | { nom: 'attente'; id: string }
  | { nom: 'relecture'; campagne: CampagneProspection }
  | { nom: 'fin'; campagne: CampagneProspection; resultat: ResultatCampagne };

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Prospection({ slug, ouvrir }: { slug: string; ouvrir?: string | undefined }) {
  const [vue, setVue] = useState<VueProspection | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [etape, setEtape] = useState<Etape>({ nom: 'accueil' });
  const [lancement, setLancement] = useState<{ enCours: boolean; erreur: string | null }>({
    enCours: false,
    erreur: null,
  });

  const charger = () =>
    fetchProspection(slug).then(setVue, (e: unknown) => setMessage(messageErreur(e)));

  useEffect(() => {
    // Lien « Rédiger la réponse » de l'Inbox : la campagne s'ouvre directement.
    if (ouvrir) {
      fetchCampagne(slug, ouvrir).then(
        (c) =>
          setEtape(
            c.statut === 'relecture'
              ? { nom: 'relecture', campagne: c }
              : { nom: 'attente', id: c.id },
          ),
        (e: unknown) => setMessage(messageErreur(e)),
      );
    }
    void charger();
    // Les mails que Marc a envoyés depuis sa messagerie : constatés au passage, sans bloquer l'écran.
    rapprocherEnvoisProspection(slug).then(
      (r) => r.envoyes > 0 && void charger(),
      () => undefined,
    );
  }, [slug]);

  if (!vue) return message ? <div className="empty">{message}</div> : null;
  const { stats } = vue;
  const accueil = () => {
    setEtape({ nom: 'accueil' });
    void charger();
  };
  const retour = (
    <p>
      <button className="btn" onClick={accueil}>
        ← Retour à la prospection
      </button>
    </p>
  );

  if (etape.nom === 'choix') {
    return (
      <>
        {retour}
        <ChoixTaches
          slug={slug}
          onContinuer={(ids, liens) => setEtape({ nom: 'reglage', mode: 'relance', ids, liens })}
        />
      </>
    );
  }
  if (etape.nom === 'choix-froid') {
    return (
      <>
        {retour}
        <ChoixContactsFroid
          slug={slug}
          onContinuer={(ids) => setEtape({ nom: 'reglage', mode: 'froid', ids, liens: {} })}
        />
      </>
    );
  }
  if (etape.nom === 'epuises') {
    return (
      <>
        {retour}
        <Epuises slug={slug} />
      </>
    );
  }
  if (etape.nom === 'reglage') {
    const { mode, ids, liens } = etape;
    return (
      <>
        {retour}
        <ReglageCampagne
          mode={mode}
          nbTaches={ids.length}
          signatures={vue.signatures}
          enCours={lancement.enCours}
          erreur={lancement.erreur}
          onLancer={(reglage) => {
            setLancement({ enCours: true, erreur: null });
            (mode === 'froid'
              ? creerCampagneFroid(slug, ids, reglage)
              : creerCampagneRelance(slug, ids, reglage, liens)
            ).then(
              (r) => {
                setLancement({ enCours: false, erreur: null });
                setEtape({ nom: 'attente', id: r.campagneId });
              },
              (e: unknown) => setLancement({ enCours: false, erreur: messageErreur(e) }),
            );
          }}
        />
      </>
    );
  }
  if (etape.nom === 'attente') {
    return (
      <>
        {retour}
        <Attente
          slug={slug}
          id={etape.id}
          onPret={(campagne) =>
            setEtape(
              campagne.statut === 'terminee' ? { nom: 'accueil' } : { nom: 'relecture', campagne },
            )
          }
        />
      </>
    );
  }
  if (etape.nom === 'relecture') {
    const { campagne } = etape;
    return (
      <>
        {retour}
        <Relecture
          key={campagne.id}
          slug={slug}
          campagne={campagne}
          signatures={vue.signatures}
          envoiPossible={vue.envoiPossible && campagne.mode !== 'reponse'}
          onTermine={(resultat) => setEtape({ nom: 'fin', campagne, resultat })}
        />
      </>
    );
  }
  if (etape.nom === 'fin') {
    const { campagne, resultat } = etape;
    return (
      <>
        {retour}
        <Resultat
          mode={campagne.mode}
          resultat={resultat}
          onRetour={accueil}
          onRevenir={() =>
            void fetchCampagne(slug, campagne.id).then(
              (c) => setEtape({ nom: 'relecture', campagne: c }),
              (e: unknown) => setMessage(messageErreur(e)),
            )
          }
        />
      </>
    );
  }

  const reprendre = () => {
    if (!vue.enCours) return;
    void fetchCampagne(slug, vue.enCours).then(
      (c) =>
        setEtape(
          c.statut === 'relecture'
            ? { nom: 'relecture', campagne: c }
            : { nom: 'attente', id: c.id },
        ),
      (e: unknown) => setMessage(messageErreur(e)),
    );
  };

  return (
    <div className="stack">
      {message && (
        <div className="alert amber">
          <div>{message}</div>
        </div>
      )}
      {vue.enCours && (
        <div className="alert blue">
          <div>
            Une campagne est en cours.{' '}
            <button className="btn sm primary" onClick={reprendre}>
              Reprendre la campagne en cours
            </button>
          </div>
        </div>
      )}
      <div className="grid g3" style={{ gridTemplateColumns: '1.3fr 1fr 1fr' }}>
        <JaugeJour jour={stats.jour} objectif={stats.objectif} />
        <div className="panel">
          <div className="panel-b">
            <div className="small muted">CETTE SEMAINE</div>
            <div style={{ fontSize: 28, fontWeight: 700 }} className="num">
              {stats.semaine} {pluriel(stats.semaine, 'envoyé')}
            </div>
            <div className="small muted">
              {stats.reponses} {pluriel(stats.reponses, 'réponse')} · {stats.rdv}{' '}
              {pluriel(stats.rdv, 'rendez-vous')}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-b">
            <div className="small muted">PAR THÈME ET PAR TOUCHE</div>
            <div className="small" style={{ lineHeight: 1.7, marginTop: 4 }}>
              {stats.semaine === 0 ? (
                <span className="muted">Rien cette semaine</span>
              ) : (
                <>
                  {lignes(stats.parTheme)}
                  <div>
                    {Object.entries(stats.parTouche).map(([k, v], i) => (
                      <span key={k}>
                        {i > 0 && ' · '}Touche {k} : <b className="num">{v}</b>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid g2">
        <div className="panel" style={{ border: '2px solid var(--navy)' }}>
          <div className="panel-b">
            <h2 style={{ marginTop: 0 }}>Relancer des tâches</h2>
            <p className="small muted">
              Vous choisissez des tâches de relance, l'OS rédige un mail par tâche dans le style du
              premier contact.
            </p>
            <p className="small">
              <b className="num">{stats.relancesRestantes}</b>{' '}
              {pluriel(stats.relancesRestantes, 'tâche')} de relance à traiter
            </p>
            <button className="btn primary" onClick={() => setEtape({ nom: 'choix' })}>
              Choisir les tâches
            </button>
          </div>
        </div>
        <div className="panel" style={{ border: '2px solid var(--teal)' }}>
          <div className="panel-b">
            <h2 style={{ marginTop: 0 }}>Prospecter à froid</h2>
            <p className="small muted">
              Vous tirez un échantillon de la base vivante, l'OS rédige un mail par contact.
            </p>
            <p className="small">
              <b className="num">{vue.froid.disponibles}</b>{' '}
              {pluriel(vue.froid.disponibles, 'contact')} jamais sollicité
              {vue.froid.disponibles > 1 ? 's' : ''} · <b className="num">{vue.froid.aRelancer}</b>{' '}
              à relancer
            </p>
            <button className="btn go" onClick={() => setEtape({ nom: 'choix-froid' })}>
              Tirer un échantillon
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          <h2>Campagnes récentes</h2>
          <span className="small muted">Ce qui a été lancé, et ce que ça a donné</span>
        </div>
        <div className="panel-b">
          {vue.recentes.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Aucune campagne pour l'instant.
            </p>
          ) : (
            <table className="tbl small">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Campagne</th>
                  <th className="r">Brouillons</th>
                </tr>
              </thead>
              <tbody>
                {vue.recentes.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {new Date(c.creeLe).toLocaleDateString('fr-FR', {
                        timeZone: 'Europe/Paris',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </td>
                    <td>{c.mode === 'relance' ? 'Relance de tâches' : 'Prospection à froid'}</td>
                    <td className="r num">{c.resultat?.brouillons ?? c.brouillons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small" style={{ marginBottom: 0 }}>
            {stats.aConfirmer > 0 ? (
              <button className="link strong" onClick={() => setEtape({ nom: 'epuises' })}>
                Contacts épuisés à confirmer ({stats.aConfirmer})
              </button>
            ) : (
              <span className="muted">Aucun contact épuisé à confirmer.</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// Panneau du Brief du jour : mêmes chiffres que l'accueil. Il disparaît si l'API ne répond pas :
// le Brief reste utilisable sans lui.
export function PanneauProspection({ slug }: { slug: string }) {
  const [stats, setStats] = useState<StatsProspection | null>(null);

  useEffect(() => {
    fetchProspection(slug).then(
      (v) => setStats(v.stats),
      () => setStats(null),
    );
  }, [slug]);

  if (!stats) return null;
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Prospection du jour</h2>
        <a className="btn sm" href={`#/${slug}/prospection`}>
          Ouvrir
        </a>
      </div>
      <div className="panel-b">
        <JaugeJour jour={stats.jour} objectif={stats.objectif} />
        <p className="small" style={{ margin: '10px 0 0' }}>
          Relances faites aujourd'hui : <b className="num">{stats.relancesFaites}</b> · restantes :{' '}
          <b className="num">{stats.relancesRestantes}</b>
          <br />
          Cette semaine : <b className="num">{stats.semaine}</b> {pluriel(stats.semaine, 'mail')},{' '}
          <b className="num">{stats.reponses}</b> {pluriel(stats.reponses, 'réponse')}
        </p>
      </div>
    </div>
  );
}
