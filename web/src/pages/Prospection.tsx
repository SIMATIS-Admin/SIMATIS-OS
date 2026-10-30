import { useEffect, useState } from 'react';
import { fetchProspection, type StatsProspection } from '../api.js';

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

export function Prospection({ slug }: { slug: string }) {
  const [stats, setStats] = useState<StatsProspection | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchProspection(slug).then(
      (v) => setStats(v.stats),
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );
  }, [slug]);

  if (!stats) return message ? <div className="empty">{message}</div> : null;

  return (
    <div className="stack">
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
            <h2 style={{ marginTop: 0 }}>
              Relancer des tâches <span className="badge amber">Bientôt</span>
            </h2>
            <p className="small muted">
              Vous choisissez des tâches de relance, l'OS rédige un mail par tâche dans le style du
              premier contact.
            </p>
            <p className="small">
              <b className="num">{stats.relancesRestantes}</b>{' '}
              {pluriel(stats.relancesRestantes, 'tâche')} de relance à traiter
            </p>
            <button className="btn primary" disabled>
              Choisir les tâches
            </button>
          </div>
        </div>
        <div className="panel" style={{ border: '2px solid var(--teal)' }}>
          <div className="panel-b">
            <h2 style={{ marginTop: 0 }}>
              Prospecter à froid <span className="badge amber">Bientôt</span>
            </h2>
            <p className="small muted">
              Vous tirez un échantillon de la base vivante, l'OS rédige un mail par contact.
            </p>
            <button className="btn go" disabled>
              Tirer un échantillon
            </button>
          </div>
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
