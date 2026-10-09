import { useCallback, useEffect, useState } from 'react';
import { fetchRoutines, saveRoutine, type RoutineInfo } from '../../api.js';

const HEURES = ['6h00', '6h30', '7h00', '7h30', '8h00', '8h30', '9h00'];
type Champ =
  | { k: string; l: string; t: 'select'; o: string[] }
  | { k: string; l: string; t: 'number'; min: number; max: number; u: string }
  | { k: string; l: string; t: 'checks'; o: [string, string][] }
  | { k: string; l: string; t: 'bool' };

// Same fields and bounds as the server (routines/params.ts, from the mockup's PARAMS_DEF).
const CHAMPS: Record<string, Champ[]> = {
  quotidienne: [
    { k: 'heure', l: 'Heure de lancement', t: 'select', o: HEURES },
    {
      k: 'jours',
      l: 'Jours',
      t: 'select',
      o: ['Jours ouvrés', 'Du lundi au jeudi', 'Tous les jours'],
    },
    {
      k: 'canaux',
      l: 'Tâches traitées',
      t: 'checks',
      o: [
        ['email', 'Relances par email'],
        ['appel', 'Appels'],
      ],
    },
    {
      k: 'retard',
      l: 'Reprendre les tâches en retard depuis au plus',
      t: 'number',
      min: 0,
      max: 90,
      u: 'jours',
    },
    {
      k: 'max',
      l: 'Brouillons au plus par exécution',
      t: 'number',
      min: 1,
      max: 50,
      u: 'brouillons',
    },
    {
      k: 'creneaux',
      l: 'Créneaux proposés dans chaque email',
      t: 'number',
      min: 0,
      max: 3,
      u: 'créneaux',
    },
    {
      k: 'delai',
      l: 'Premier créneau proposé au plus tôt dans',
      t: 'number',
      min: 1,
      max: 15,
      u: 'jours ouvrés',
    },
    {
      k: 'plages',
      l: 'Plages horaires des créneaux',
      t: 'select',
      o: ['9h30-12h00 et 14h00-17h00', '9h00-12h00 seulement', '14h00-18h00 seulement'],
    },
  ],
  nettoyage: [
    {
      k: 'declenchement',
      l: 'Déclenchement',
      t: 'select',
      o: ['Après chaque envoi de relances', 'Chaque jour à 18h00', 'À la demande seulement'],
    },
    { k: 'suivi', l: 'Tâche de suivi proposée à', t: 'number', min: 1, max: 60, u: 'jours' },
  ],
  hebdo: [
    { k: 'jour', l: 'Jour', t: 'select', o: ['Lundi', 'Vendredi'] },
    { k: 'heure', l: 'Heure', t: 'select', o: HEURES },
  ],
  evenement: [
    {
      k: 'devis',
      l: 'Relancer un devis sans réponse après',
      t: 'number',
      min: 3,
      max: 30,
      u: 'jours',
    },
    { k: 'stop', l: "Arrêter la séquence dès qu'un contact répond", t: 'bool' },
  ],
};

function Formulaire({ slug, r, onSaved }: { slug: string; r: RoutineInfo; onSaved: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const save = (k: string, v: unknown) =>
    saveRoutine(slug, r.cle, { params: { [k]: v } }).then(
      () => {
        setMessage('Enregistré.');
        onSaved();
      },
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );
  return (
    <div className="panel">
      <div className="panel-h">
        <div>
          <h2>{r.nom}</h2>
          <div className="small muted">
            {r.rythme} · skill <code>{r.skill}</code>
          </div>
        </div>
      </div>
      <div className="panel-b stack">
        {(CHAMPS[r.cle] ?? []).map((f) => {
          const v = r.params[f.k];
          if (f.t === 'select') {
            return (
              <label key={f.k} className="field">
                <span>{f.l}</span>
                <select
                  className="input"
                  value={String(v)}
                  onChange={(e) => void save(f.k, e.target.value)}
                >
                  {f.o.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
            );
          }
          if (f.t === 'number') {
            return (
              <label key={f.k} className="field">
                <span>
                  {f.l} ({f.u})
                </span>
                <input
                  className="input num"
                  type="number"
                  min={f.min}
                  max={f.max}
                  defaultValue={Number(v)}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (n !== Number(v)) void save(f.k, n);
                  }}
                />
              </label>
            );
          }
          if (f.t === 'checks') {
            const liste = Array.isArray(v) ? (v as string[]) : [];
            return (
              <div key={f.k} className="field">
                <span>{f.l}</span>
                {f.o.map(([val, lib]) => (
                  <label key={val} className="check">
                    <input
                      type="checkbox"
                      checked={liste.includes(val)}
                      onChange={(e) =>
                        void save(
                          f.k,
                          e.target.checked ? [...liste, val] : liste.filter((x) => x !== val),
                        )
                      }
                    />
                    <span>{lib}</span>
                  </label>
                ))}
              </div>
            );
          }
          return (
            <label key={f.k} className="check">
              <input
                type="checkbox"
                checked={v === true}
                onChange={(e) => void save(f.k, e.target.checked)}
              />
              <span>{f.l}</span>
            </label>
          );
        })}
        {message && <p className="small muted">{message}</p>}
      </div>
    </div>
  );
}

export function RoutinesParametres({ slug }: { slug: string }) {
  const [list, setList] = useState<RoutineInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchRoutines(slug).then(setList, (e: unknown) => setError(String(e)));
  }, [slug]);
  useEffect(load, [load]);
  if (error) return <div className="empty">{error}</div>;
  if (!list) return null;
  return (
    <>
      <div className="grid g2">
        {list.map((r) => (
          <Formulaire key={r.cle} slug={slug} r={r} onSaved={load} />
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>
        Les règles de rédaction restent dans les skills Claude ; ici, seulement ce qui change d'un
        mandat à l'autre.
      </p>
    </>
  );
}
