import { useCallback, useEffect, useState } from 'react';
import {
  fetchRoutines,
  fetchSante,
  saveRoutine,
  type EtatControle,
  type RoutineInfo,
  type Sante,
  type SanteRoutine,
} from '../../api.js';
import { Icon } from '../../icons.js';

const HEURES = ['6h00', '6h30', '7h00', '7h30', '8h00', '8h30', '9h00'];
type Champ =
  | { k: string; l: string; t: 'select'; o: string[] }
  | { k: string; l: string; t: 'number'; min: number; max: number; u: string }
  | { k: string; l: string; t: 'checks'; o: [string, string][] }
  | { k: string; l: string; t: 'bool' };

// « Quand » fields come first, then « Quoi ». Same fields and bounds as the server (routines/params.ts, from the mockup's PARAMS_DEF).
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

const QUAND = new Set(['heure', 'jours', 'jour', 'declenchement']);

const FEU: Record<EtatControle, { badge: string; texte: string; couleur: string }> = {
  ok: { badge: 'green', texte: 'Prête', couleur: 'var(--green)' },
  attention: { badge: 'amber', texte: 'Partielle', couleur: 'var(--amber, #c98a12)' },
  manque: { badge: 'red', texte: 'Ne peut pas tourner', couleur: 'var(--red)' },
};
const PICTO: Record<EtatControle, string> = { ok: 'check', attention: 'info', manque: 'x' };

function Champ({ f, v, save }: { f: Champ; v: unknown; save: (k: string, v: unknown) => void }) {
  if (f.t === 'select') {
    return (
      <label className="field">
        <span>{f.l}</span>
        <select className="input" value={String(v)} onChange={(e) => save(f.k, e.target.value)}>
          {f.o.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  }
  if (f.t === 'number') {
    return (
      <label className="field">
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
            if (n !== Number(v)) save(f.k, n);
          }}
        />
      </label>
    );
  }
  if (f.t === 'checks') {
    const liste = Array.isArray(v) ? (v as string[]) : [];
    return (
      <div className="field">
        <span>{f.l}</span>
        {f.o.map(([val, lib]) => (
          <label key={val} className="check">
            <input
              type="checkbox"
              checked={liste.includes(val)}
              onChange={(e) =>
                save(f.k, e.target.checked ? [...liste, val] : liste.filter((x) => x !== val))
              }
            />
            <span>{lib}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <label className="check">
      <input type="checkbox" checked={v === true} onChange={(e) => save(f.k, e.target.checked)} />
      <span>{f.l}</span>
    </label>
  );
}

function AideExecuteur() {
  return (
    <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
      <li>
        Créer son jeton :{' '}
        <code>
          docker compose exec app node dist/admin/main.js token:create --nom runner --runner
        </code>
        , puis le mettre dans <code>.env</code> (<code>RUNNER_TOKEN=…</code>).
      </li>
      <li>
        Le lancer dans le dossier de l'OS : <code>npm run runner</code> (ou au démarrage du Mac,
        voir docs/EXPLOITATION.md).
      </li>
    </ol>
  );
}

function Carte({
  slug,
  r,
  sante,
  onChange,
  onConnexions,
}: {
  slug: string;
  r: RoutineInfo;
  sante: SanteRoutine;
  onChange: () => void;
  onConnexions: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [aide, setAide] = useState<string | null>(null);
  const feu = FEU[sante.feu];
  const save = (change: { actif?: boolean; params?: Record<string, unknown> }) =>
    saveRoutine(slug, r.cle, change).then(
      () => {
        setMessage('Enregistré.');
        onChange();
      },
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );
  const champ = (k: string, v: unknown) => void save({ params: { [k]: v } });
  const champs = CHAMPS[r.cle] ?? [];

  return (
    <div className="panel" style={{ borderTop: `4px solid ${feu.couleur}` }}>
      <div className="panel-h">
        <div>
          <h2>{r.nom}</h2>
          <div className="small muted">
            skill <code>{r.skill}</code>
          </div>
        </div>
        <span className={`badge ${feu.badge}`}>{feu.texte}</span>
      </div>
      <div className="panel-b stack">
        <p style={{ margin: 0 }}>
          <b>{sante.resume}</b>
        </p>

        <div>
          <h4 style={{ margin: '4px 0 6px' }}>Ce qu'il faut pour qu'elle tourne</h4>
          <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0 }}>
            {sante.controles.map((c) => (
              <li key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <span className="pico" style={{ color: FEU[c.etat].couleur }}>
                  <Icon name={PICTO[c.etat]} />
                </span>
                <div>
                  <div>{c.libelle}</div>
                  <div className="small muted">{c.detail}</div>
                  {c.etat !== 'ok' && c.action === 'connexions' && (
                    <button className="btn sm" style={{ marginTop: 4 }} onClick={onConnexions}>
                      Brancher dans Connexions
                    </button>
                  )}
                  {c.etat !== 'ok' && c.action === 'activer' && (
                    <button
                      className="btn sm"
                      style={{ marginTop: 4 }}
                      onClick={() => void save({ actif: true })}
                    >
                      Activer
                    </button>
                  )}
                  {c.etat !== 'ok' && (c.action === 'executeur' || c.action === 'claude') && (
                    <>
                      <button
                        className="btn sm ghost"
                        style={{ marginTop: 4 }}
                        onClick={() => setAide(aide === c.id ? null : c.id)}
                      >
                        Comment faire ?
                      </button>
                      {aide === c.id &&
                        (c.action === 'claude' ? (
                          <p className="small" style={{ margin: '6px 0 0' }}>
                            Installer Claude Code sur l'ordinateur de l'OS et s'y connecter une fois
                            (<code>claude</code> dans un terminal), puis relancer l'exécuteur.
                          </p>
                        ) : (
                          <AideExecuteur />
                        ))}
                    </>
                  )}
                  {c.etat !== 'ok' && c.action === 'skill' && (
                    <p className="small" style={{ margin: '4px 0 0' }}>
                      À créer dans <code>~/.claude/skills/{r.skill}/</code> ; elle utilise les
                      outils MCP simatis (voir docs/EXPLOITATION.md).
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 style={{ margin: '4px 0 6px' }}>Ce qu'elle fait</h4>
          <ol className="rt-steps">
            {sante.etapes.map((e) => (
              <li key={e.texte} className={e.bloquee ? 'blocked' : ''}>
                {e.texte}
                {e.bloquee && (
                  <span className="small muted">
                    {' '}
                    — s'arrête ici : {e.besoin === 'agenda' ? 'agenda' : 'messagerie'} non branchée
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>

        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Régler la routine</summary>
          <div className="grid g2" style={{ marginTop: 10 }}>
            <div className="stack">
              <h4 style={{ margin: 0 }}>Quand</h4>
              <label className="check">
                <input
                  type="checkbox"
                  checked={r.actif}
                  onChange={(e) => void save({ actif: e.target.checked })}
                />
                <span>{r.actif ? 'Active' : 'En pause'}</span>
              </label>
              {champs
                .filter((f) => QUAND.has(f.k))
                .map((f) => (
                  <Champ key={f.k} f={f} v={r.params[f.k]} save={champ} />
                ))}
            </div>
            <div className="stack">
              <h4 style={{ margin: 0 }}>Quoi</h4>
              {champs
                .filter((f) => !QUAND.has(f.k))
                .map((f) => (
                  <Champ key={f.k} f={f} v={r.params[f.k]} save={champ} />
                ))}
            </div>
          </div>
        </details>
        {message && <p className="small muted">{message}</p>}
      </div>
    </div>
  );
}

export function RoutinesParametres({
  slug,
  onConnexions = () => undefined,
}: {
  slug: string;
  onConnexions?: () => void;
}) {
  const [list, setList] = useState<RoutineInfo[] | null>(null);
  const [sante, setSante] = useState<Sante | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchRoutines(slug).then(setList, (e: unknown) => setError(String(e)));
    fetchSante(slug).then(setSante, (e: unknown) => setError(String(e)));
  }, [slug]);
  useEffect(load, [load]);
  if (error) return <div className="empty">{error}</div>;
  if (!list || !sante) return null;
  const pretes = sante.routines.filter((r) => r.feu === 'ok').length;
  return (
    <>
      <div
        className={`alert ${sante.executeur.actif ? 'green' : 'amber'}`}
        style={{ marginBottom: 18 }}
      >
        <Icon name={sante.executeur.actif ? 'check' : 'info'} />
        <div>
          <b>
            {pretes} routine{pretes > 1 ? 's' : ''} sur {sante.routines.length} prête
            {pretes > 1 ? 's' : ''}.
          </b>{' '}
          {sante.executeur.actif
            ? `L'exécuteur tourne sur ${sante.executeur.poste ?? 'ce poste'} : les routines partent à l'heure.`
            : "L'exécuteur ne tourne pas sur l'ordinateur de l'OS : les routines sont demandées mais personne ne les lance."}
          {!sante.executeur.actif && <AideExecuteur />}
        </div>
      </div>
      <div className="grid g2">
        {list.map((r) => {
          const s = sante.routines.find((x) => x.cle === r.cle);
          return s ? (
            <Carte
              key={r.cle}
              slug={slug}
              r={r}
              sante={s}
              onChange={load}
              onConnexions={onConnexions}
            />
          ) : null;
        })}
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>
        Les règles de rédaction restent dans les skills Claude ; ici, seulement ce qui change d'un
        mandat à l'autre.
      </p>
    </>
  );
}
