import { useCallback, useEffect, useState, type DragEvent } from 'react';
import {
  createTache,
  fetchOptions,
  fetchTaches,
  saveOptions,
  updateTache,
  type SemaineTaches,
  type TacheSaisie,
  type TacheVue,
} from '../api.js';
import { Icon } from '../icons.js';
import { ACTIVITES, ORDRE_ACTIVITES, lundiDe, plusJours } from './taches/commun.js';
import { periode, type CleePeriode } from './taches/periodes.js';
import { EditionTache, Ensuite, type Enregistrement } from './taches/Edition.js';
import { jourParis, memeHeure, titreSemaine } from './taches/creneaux.js';
import { MIME_TACHE, Semaine } from './taches/Semaine.js';

type Mode = 'semaine' | 'liste';
type FiltreStatut = 'a_faire' | 'faites';
type FiltreOrigine = 'tout' | TacheVue['origine'];

const echeanceLisible = (e: string | null) =>
  e
    ? new Date(e).toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Sans échéance';

export const estSimulation = (r: unknown): r is { simulation: true; message: string } =>
  typeof r === 'object' && r !== null && 'simulation' in r;

export function Pastilles({ t }: { t: TacheVue }) {
  const [ico, lbl] = ACTIVITES[t.type];
  return (
    <>
      <span className="badge">
        <Icon name={ico} /> {lbl}
      </span>{' '}
      <span className={`badge ${t.origine === 'hubspot' ? 'blue' : ''}`}>
        {t.origine === 'hubspot' ? 'HubSpot' : 'OS'}
      </span>
    </>
  );
}

const PERIODES: [CleePeriode | 'plage', string][] = [
  ['retard', 'En retard'],
  ['aujourdhui', "Aujourd'hui"],
  ['demain', 'Demain'],
  ['semaine', 'Cette semaine'],
  ['prochaine', 'Semaine prochaine'],
  ['plage', 'Plage'],
];

// Pipedrive list: type toggles and a period of its own, independent of the week shown.
function Liste({
  slug,
  version,
  hubspot,
  onOpen,
  onFait,
}: {
  slug: string;
  version: number;
  hubspot: boolean;
  onOpen: (t: TacheVue) => void;
  onFait: (t: TacheVue) => void;
}) {
  const [types, setTypes] = useState<Set<TacheVue['type']>>(new Set(ORDRE_ACTIVITES));
  const [cle, setCle] = useState<CleePeriode | 'plage'>('semaine');
  const [plage, setPlage] = useState({ du: '', au: '' });
  const [statut, setStatut] = useState<FiltreStatut>('a_faire');
  const [origine, setOrigine] = useState<FiltreOrigine>('tout');
  const [vue, setVue] = useState<{ taches: TacheVue[]; enRetard: TacheVue[] } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const p = cle === 'plage' ? plage : periode(cle);
    // Overdue: what is late before today, read with today as the period.
    const bornes = p === 'retard' ? (periode('aujourdhui') as { du: string; au: string }) : p;
    if (!bornes.du || !bornes.au) return;
    fetchTaches(slug, bornes.du, bornes.au).then(
      (d) =>
        setVue(
          p === 'retard'
            ? { taches: [], enRetard: d.enRetard }
            : cle === 'semaine'
              ? { taches: [...d.taches, ...d.sansEcheance], enRetard: d.enRetard }
              : { taches: d.taches, enRetard: [] },
        ),
      (e: unknown) => setErreur(e instanceof Error ? e.message : String(e)),
    );
  }, [slug, cle, plage, version]);

  const basculer = (t: TacheVue['type']) =>
    setTypes((cur) => {
      // All on: a click isolates that type (Pipedrive); otherwise it toggles it.
      if (cur.size === ORDRE_ACTIVITES.length) return new Set([t]);
      const next = new Set(cur);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next.size ? next : new Set(ORDRE_ACTIVITES);
    });
  const toutes = vue ? [...vue.enRetard, ...vue.taches] : [];
  const shown = toutes
    .filter((t) => (statut === 'faites' ? t.fait : !t.fait))
    .filter((t) => types.has(t.type))
    .filter((t) => origine === 'tout' || t.origine === origine)
    .sort(
      (a, b) =>
        (a.echeance ? Date.parse(a.echeance) : Infinity) -
        (b.echeance ? Date.parse(b.echeance) : Infinity),
    );
  const chip = <T extends string>(v: T, cur: T, set: (v: T) => void, label: string) => (
    <button key={v} className={`chip ${cur === v ? 'on' : ''}`} onClick={() => set(v)}>
      {label}
    </button>
  );
  return (
    <div className="panel">
      <div className="vq-filter">
        <button
          className={`chip ${types.size === ORDRE_ACTIVITES.length ? 'on' : ''}`}
          onClick={() => setTypes(new Set(ORDRE_ACTIVITES))}
        >
          Tous
        </button>
        {ORDRE_ACTIVITES.map((t) => {
          const [ico, lbl] = ACTIVITES[t];
          const actif = types.has(t) && types.size < ORDRE_ACTIVITES.length;
          return (
            <button
              key={t}
              className={`chip ${actif ? 'on' : ''}`}
              aria-label={lbl}
              aria-pressed={actif}
              title={lbl}
              onClick={() => basculer(t)}
            >
              <Icon name={ico} />
            </button>
          );
        })}
        <span className="muted">·</span>
        {chip<FiltreStatut>('a_faire', statut, setStatut, 'À faire')}
        {chip<FiltreStatut>('faites', statut, setStatut, 'Faites')}
        {hubspot && (
          <>
            <span className="muted">·</span>
            {chip<FiltreOrigine>('tout', origine, setOrigine, 'Toutes origines')}
            {chip<FiltreOrigine>('hubspot', origine, setOrigine, 'HubSpot')}
            {chip<FiltreOrigine>('os', origine, setOrigine, 'OS')}
          </>
        )}
      </div>
      <div className="vq-filter">
        {PERIODES.map(([v, l]) => chip(v, cle, setCle, l))}
        {cle === 'plage' && (
          <>
            <label className="small">
              Du{' '}
              <input
                className="input"
                type="date"
                aria-label="Du"
                value={plage.du}
                onChange={(e) => setPlage({ ...plage, du: e.target.value })}
              />
            </label>
            <label className="small">
              Au{' '}
              <input
                className="input"
                type="date"
                aria-label="Au"
                value={plage.au}
                onChange={(e) => setPlage({ ...plage, au: e.target.value })}
              />
            </label>
          </>
        )}
      </div>
      <div className="panel-b">
        {erreur && (
          <p className="small" style={{ color: 'var(--red)' }}>
            {erreur}
          </p>
        )}
        {shown.length ? (
          <ul className="tasks">
            {shown.map((t) => (
              <li key={t.id} className="tache-ligne">
                <input
                  type="checkbox"
                  aria-label={`Marquer faite : ${t.titre}`}
                  checked={t.fait}
                  onChange={() => onFait(t)}
                />
                <div style={{ cursor: 'pointer' }} onClick={() => onOpen(t)}>
                  <b>{t.titre}</b>
                  <div className="small muted">
                    {t.contact ? `${t.contact.nom} · ` : ''}
                    <span className={vue?.enRetard.includes(t) ? 'late' : ''}>
                      {echeanceLisible(t.echeance)}
                    </span>{' '}
                    <Pastilles t={t} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">Aucune activité pour ces filtres.</div>
        )}
      </div>
    </div>
  );
}

export function Taches({ slug }: { slug: string }) {
  const [mode, setMode] = useState<Mode>('semaine');
  const [lundi, setLundi] = useState(() => lundiDe(new Date()));
  const [data, setData] = useState<SemaineTaches | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [edition, setEdition] = useState<TacheVue | 'nouvelle' | null>(null);
  const [ensuite, setEnsuite] = useState<TacheVue | null>(null);
  const [proposer, setProposer] = useState(true);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => {
    setVersion((v) => v + 1);
    fetchTaches(slug, lundi, plusJours(lundi, 6)).then(setData, (e: unknown) =>
      setMessage(e instanceof Error ? e.message : String(e)),
    );
  }, [slug, lundi]);
  useEffect(load, [load]);
  useEffect(() => {
    fetchOptions().then(
      (o) => setProposer(o.ensuite),
      () => undefined,
    );
  }, []);

  // Pipedrive: once an activity is really done, offer the next one (not on a closed deal).
  const proposerSuite = (t: TacheVue, r: unknown) => {
    if (proposer && !estSimulation(r) && !t.opportunite?.clos) setEnsuite(t);
  };
  const creer = async ({ hubspot, ...saisie }: Enregistrement) => {
    apres(await createTache(slug, { ...saisie, hubspot }));
  };

  const apres = (r: unknown) => {
    setMessage(estSimulation(r) ? r.message : null);
    load();
  };
  const modifier = (t: TacheVue, patch: TacheSaisie) =>
    updateTache(slug, t.id, patch).then(apres, (e: unknown) =>
      setMessage(e instanceof Error ? e.message : String(e)),
    );
  // Several moves, then one reload: the message keeps the first simulation or error.
  const deplacerTout = async (moves: [TacheVue, string][]) => {
    let note: string | null = null;
    for (const [t, echeance] of moves) {
      try {
        const r = await updateTache(slug, t.id, { echeance });
        if (estSimulation(r)) note ??= r.message;
      } catch (e) {
        note ??= e instanceof Error ? e.message : String(e);
      }
    }
    setMessage(note);
    load();
  };

  const toutes = data ? [...data.enRetard, ...data.taches, ...data.sansEcheance] : [];
  const accepte = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(MIME_TACHE)) e.preventDefault();
  };
  const decaler = (jours: number) => (e: DragEvent) => {
    e.preventDefault();
    const t = toutes.find((x) => x.id === e.dataTransfer.getData(MIME_TACHE));
    if (!t) return;
    const jour = t.echeance ? jourParis(t.echeance) : lundi;
    void modifier(t, { echeance: memeHeure(t.echeance, plusJours(jour, jours)) });
  };

  useEffect(() => {
    if (mode !== 'semaine' || edition) return;
    const touche = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') setLundi((l) => plusJours(l, -7));
      if (e.key === 'ArrowRight') setLundi((l) => plusJours(l, 7));
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [mode, edition]);

  return (
    <>
      <div className="page-actions">
        <div className="seg">
          <button className={mode === 'semaine' ? 'on' : ''} onClick={() => setMode('semaine')}>
            Semaine
          </button>
          <button className={mode === 'liste' ? 'on' : ''} onClick={() => setMode('liste')}>
            Liste
          </button>
        </div>
        <button className="btn primary" onClick={() => setEdition('nouvelle')}>
          Nouvelle tâche
        </button>
      </div>
      {mode === 'semaine' && (
        <div className="sem-barre">
          <button
            className="btn sem-nav"
            aria-label="Semaine précédente"
            onClick={() => setLundi(plusJours(lundi, -7))}
            onDragOver={accepte}
            onDrop={decaler(-7)}
          >
            ‹
          </button>
          <h2>{titreSemaine(lundi)}</h2>
          <button
            className="btn sem-nav"
            aria-label="Semaine suivante"
            onClick={() => setLundi(plusJours(lundi, 7))}
            onDragOver={accepte}
            onDrop={decaler(7)}
          >
            ›
          </button>
          {lundi !== lundiDe(new Date()) && (
            <button className="btn" onClick={() => setLundi(lundiDe(new Date()))}>
              Cette semaine
            </button>
          )}
        </div>
      )}
      {message && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div>{message}</div>
        </div>
      )}
      {data &&
        (mode === 'liste' ? (
          <Liste
            slug={slug}
            version={version}
            hubspot={data.hubspot}
            onOpen={setEdition}
            onFait={(t) =>
              void updateTache(slug, t.id, { fait: !t.fait }).then(
                (r) => {
                  apres(r);
                  if (!t.fait) proposerSuite(t, r);
                },
                (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
              )
            }
          />
        ) : (
          <Semaine
            lundi={lundi}
            data={data}
            onOpen={setEdition}
            onMove={(t, echeance) => void modifier(t, { echeance })}
            onMoveAll={(moves) => void deplacerTout(moves)}
          />
        ))}
      {edition && data && (
        <EditionTache
          tache={edition === 'nouvelle' ? null : edition}
          hubspot={data.hubspot}
          onClose={() => setEdition(null)}
          onSave={async ({ hubspot, ...saisie }) => {
            if (edition === 'nouvelle') {
              await creer({ ...saisie, hubspot });
              setEdition(null);
              return;
            }
            const r = await updateTache(slug, edition.id, saisie);
            setEdition(null);
            apres(r);
            if (saisie.fait && !edition.fait) proposerSuite(edition, r);
          }}
        />
      )}
      {ensuite && data && (
        <Ensuite
          apres={ensuite}
          hubspot={data.hubspot}
          onPlanifier={creer}
          onFermer={(plusJamais) => {
            setEnsuite(null);
            if (plusJamais) {
              setProposer(false);
              void saveOptions({ ensuite: false });
            }
          }}
        />
      )}
    </>
  );
}
