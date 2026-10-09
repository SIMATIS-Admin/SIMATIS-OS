import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchExecution,
  fetchRoutines,
  lancerRoutine,
  saveRoutine,
  type Execution,
  type RoutineInfo,
} from '../api.js';
import { Icon } from '../icons.js';

const OUVERTE = new Set(['demandee', 'en_cours']);
const quand = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'jamais';

function Suivi({ e }: { e: Execution }) {
  if (e.statut === 'demandee') {
    return (
      <div className="alert blue">
        <Icon name="clock" />
        <div>
          En attente de l'exécuteur sur l'ordinateur de l'OS : il lance Claude dans quelques
          secondes s'il tourne.
        </div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <ol className="rt-steps run">
        {e.etapes.map((s) => (
          <li
            key={s.etape}
            className={s.statut === 'fait' ? 'done' : s.statut === 'echec' ? 'blocked' : 'cur'}
          >
            {s.etape}
          </li>
        ))}
      </ol>
      {e.statut === 'en_cours' && <p className="small muted">Claude travaille…</p>}
    </div>
  );
}

function Rapport({ e }: { e: Execution }) {
  const r = e.rapport;
  if (!r) return null;
  return (
    <>
      <h4>Fait</h4>
      <ul>{r.fait.length ? r.fait.map((f) => <li key={f}>{f}</li>) : <li>Rien</li>}</ul>
      {r.attente.length > 0 && (
        <>
          <h4>En attente de validation</h4>
          <ul>
            {r.attente.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}
      {r.echec.length > 0 && (
        <>
          <h4>Échecs</h4>
          <ul>
            {r.echec.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Carte({ slug, r, onChange }: { slug: string; r: RoutineInfo; onChange: () => void }) {
  const [execution, setExecution] = useState<Execution | null>(r.derniere);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const suivre = useCallback(
    (id: string) => {
      clearInterval(timer.current);
      timer.current = setInterval(() => {
        fetchExecution(slug, id).then(
          (e) => {
            setExecution(e);
            if (!OUVERTE.has(e.statut)) {
              clearInterval(timer.current);
              onChange();
            }
          },
          () => clearInterval(timer.current),
        );
      }, 2000);
    },
    [slug, onChange],
  );
  useEffect(() => {
    setExecution(r.derniere);
    if (r.derniere && OUVERTE.has(r.derniere.statut)) suivre(r.derniere.id);
    return () => clearInterval(timer.current);
  }, [r.derniere, suivre]);

  const lancer = () => {
    setError(null);
    lancerRoutine(slug, r.cle).then(
      (e) => {
        setExecution(e);
        suivre(e.id);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };
  const ouverte = execution && OUVERTE.has(execution.statut);

  return (
    <div className="panel">
      <div className="panel-h">
        <div>
          <h2>{r.nom}</h2>
          <div className="small muted">{r.rythme}</div>
        </div>
        <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={r.actif}
            onChange={(ev) => {
              saveRoutine(slug, r.cle, { actif: ev.target.checked }).then(onChange, (e: unknown) =>
                setError(String(e)),
              );
            }}
          />
          {r.actif ? 'Active' : 'En pause'}
        </label>
      </div>
      <div className="panel-b report-col">
        {ouverte && execution ? (
          <Suivi e={execution} />
        ) : (
          <>
            <h4 style={{ marginTop: 0 }}>Ce que fait la routine</h4>
            <ol className="rt-steps">
              {r.etapes.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ol>
            <div className="small muted" style={{ marginTop: 10 }}>
              Dernière exécution : {quand(execution?.fin ?? execution?.createdAt ?? null)}
            </div>
            {execution && <Rapport e={execution} />}
          </>
        )}
        {error && (
          <p className="small" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}
      </div>
      <div className="decision">
        <button className="btn primary sm" disabled={!r.actif || !!ouverte} onClick={lancer}>
          <Icon name="play" />
          Lancer maintenant
        </button>
        <span className="hint">Rien n'est envoyé : tout attend dans À valider.</span>
      </div>
    </div>
  );
}

export function Routines({ slug }: { slug: string }) {
  const [list, setList] = useState<RoutineInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchRoutines(slug).then(setList, (e: unknown) => setError(String(e)));
  }, [slug]);
  useEffect(load, [load]);
  if (error) return <div className="empty">{error}</div>;
  if (!list) return null;
  return (
    <div className="grid g2">
      {list.map((r) => (
        <Carte key={r.cle} slug={slug} r={r} onChange={load} />
      ))}
    </div>
  );
}
