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
import { lundiDu, periode, type CleePeriode } from './taches/periodes.js';
import { EditionTache, Ensuite, type Enregistrement } from './taches/Edition.js';
import { Tableau } from './listes/Tableau.js';
import { jourParis, memeHeure, titreJour, titreSemaine } from './taches/creneaux.js';
import { Grille } from './taches/Grille.js';
import { COULEUR_RDV, COULEUR_TYPE, MIME_TACHE } from './taches/agenda.js';
import { Panneau } from './taches/Panneau.js';
import { Programme } from './taches/Programme.js';

type Mode = 'jour' | 'semaine' | 'liste' | 'tableau';
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

const MODES: [Mode, string][] = [
  ['jour', 'Jour'],
  ['semaine', 'Semaine'],
  ['liste', 'Liste'],
  ['tableau', 'Tableau'],
];

// What each colour means: meetings are blocks on the calendar, tasks are lines to tick.
function Legende() {
  const point = (couleur: string, libelle: string) => (
    <span key={libelle} style={{ ['--c' as string]: couleur }}>
      {libelle}
    </span>
  );
  return (
    <div className="ag-legende small">
      <b>Rendez-vous</b>
      {/* Google meetings keep the colours set in Google Agenda. */}
      {point(
        `linear-gradient(135deg, ${COULEUR_RDV}, #7986cb, #e67c73, #f6bf26)`,
        'Google Agenda (vos couleurs)',
      )}
      {point(COULEUR_TYPE.reunion, ACTIVITES.reunion[1])}
      {point(COULEUR_TYPE.dejeuner, ACTIVITES.dejeuner[1])}
      <b>Tâches</b>
      {(['appel', 'email', 'tache', 'echeance'] as const).map((t) =>
        point(COULEUR_TYPE[t], ACTIVITES[t][1]),
      )}
    </div>
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
  onModifier,
}: {
  slug: string;
  version: number;
  hubspot: boolean;
  onOpen: (t: TacheVue) => void;
  onFait: (t: TacheVue) => void;
  onModifier: (t: TacheVue, patch: TacheSaisie) => Promise<void>;
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
          <Tableau
            cle="activites"
            lignes={shown}
            titre={(t) => t.titre}
            onOuvrir={onOpen}
            onModifier={(t, champ, v) => onModifier(t, { [champ]: v })}
            colonnes={[
              {
                cle: 'sujet',
                label: 'Sujet',
                valeur: (t) => t.titre,
                edition: { champ: 'titre' },
                affiche: (t) => (
                  <>
                    <input
                      type="checkbox"
                      aria-label={`Marquer faite : ${t.titre}`}
                      checked={t.fait}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onFait(t)}
                    />{' '}
                    <b>{t.titre}</b>
                  </>
                ),
              },
              {
                cle: 'type',
                label: 'Type',
                valeur: (t) => ACTIVITES[t.type][1],
                affiche: (t) => (
                  <span className="badge">
                    <Icon name={ACTIVITES[t.type][0]} /> {ACTIVITES[t.type][1]}
                  </span>
                ),
              },
              { cle: 'affaire', label: 'Affaire', valeur: (t) => t.opportunite?.titre ?? null },
              { cle: 'personne', label: 'Personne', valeur: (t) => t.contact?.nom ?? null },
              {
                cle: 'email',
                label: 'Email',
                valeur: (t) => t.contact?.email ?? null,
                masquee: true,
              },
              {
                cle: 'telephone',
                label: 'Téléphone',
                valeur: (t) => t.contact?.telephone ?? null,
                masquee: true,
              },
              {
                cle: 'organisation',
                label: 'Organisation',
                valeur: (t) => t.entreprise?.nom ?? null,
              },
              {
                cle: 'echeance',
                label: 'Échéance',
                valeur: (t) => t.echeance,
                affiche: (t) => (
                  <span className={vue?.enRetard.includes(t) ? 'late' : ''}>
                    {echeanceLisible(t.echeance)}
                  </span>
                ),
              },
              {
                cle: 'origine',
                label: 'Origine',
                valeur: (t) => (t.origine === 'hubspot' ? 'HubSpot' : 'OS'),
                affiche: (t) => (
                  <span className={`badge ${t.origine === 'hubspot' ? 'blue' : ''}`}>
                    {t.origine === 'hubspot' ? 'HubSpot' : 'OS'}
                  </span>
                ),
              },
            ]}
          />
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
  const [jour, setJour] = useState(() => jourParis(new Date().toISOString()));
  // The Day view moves one day at a time, the others one week; the week follows the day.
  const avancer = (n: number) => {
    if (mode === 'jour') {
      const j = plusJours(jour, n);
      setJour(j);
      setLundi(lundiDu(j));
    } else setLundi((l) => plusJours(l, 7 * n));
  };
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

  const cocher = (t: TacheVue) =>
    void updateTache(slug, t.id, { fait: !t.fait }).then(
      (r) => {
        apres(r);
        if (!t.fait) proposerSuite(t, r);
      },
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );
  const aujourdhui = jourParis(new Date().toISOString());
  const voirJour = (j: string) => {
    setJour(j);
    setLundi(lundiDu(j));
    setMode('jour');
  };

  useEffect(() => {
    if (mode === 'tableau' || edition) return;
    const touche = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') avancer(-1);
      if (e.key === 'ArrowRight') avancer(1);
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  });

  const nav = mode !== 'tableau' && (
    <div className="sem-barre">
      <button
        className="btn sem-nav"
        aria-label={mode === 'jour' ? 'Jour précédent' : 'Semaine précédente'}
        onClick={() => avancer(-1)}
        onDragOver={accepte}
        onDrop={decaler(-7)}
      >
        ‹
      </button>
      <button
        className="btn sem-nav"
        aria-label={mode === 'jour' ? 'Jour suivant' : 'Semaine suivante'}
        onClick={() => avancer(1)}
        onDragOver={accepte}
        onDrop={decaler(7)}
      >
        ›
      </button>
      {mode === 'jour'
        ? jour !== aujourdhui && (
            <button
              className="btn"
              onClick={() => {
                setJour(aujourdhui);
                setLundi(lundiDe(new Date()));
              }}
            >
              Aujourd'hui
            </button>
          )
        : lundi !== lundiDe(new Date()) && (
            <button className="btn" onClick={() => setLundi(lundiDe(new Date()))}>
              Cette semaine
            </button>
          )}
      <h2>{mode === 'jour' ? titreJour(jour) : titreSemaine(lundi)}</h2>
    </div>
  );

  return (
    <>
      <div className="ag-barre">
        {nav || <span />}
        <div className="ag-barre-d">
          <div className="seg" role="group" aria-label="Affichage de l'agenda">
            {MODES.map(([m, l]) => (
              <button
                key={m}
                className={mode === m ? 'on' : ''}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {l}
              </button>
            ))}
          </div>
          <button className="btn primary" onClick={() => setEdition('nouvelle')}>
            Nouvelle tâche
          </button>
        </div>
      </div>
      {mode !== 'tableau' && <Legende />}
      {message && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div>{message}</div>
        </div>
      )}
      {data && data.rdvEtat !== 'ok' && mode !== 'tableau' && (
        <p className="small muted">
          {data.rdvEtat === 'non_configure'
            ? 'Rendez-vous Google non branchés : connectez le compte dans Paramètres > Connexions.'
            : 'Rendez-vous Google indisponibles pour le moment.'}
        </p>
      )}
      {data &&
        (mode === 'tableau' ? (
          <Liste
            slug={slug}
            version={version}
            hubspot={data.hubspot}
            onOpen={setEdition}
            onModifier={modifier}
            onFait={cocher}
          />
        ) : mode === 'liste' ? (
          <Programme
            lundi={lundi}
            data={data}
            slug={slug}
            aujourdhui={aujourdhui}
            onOpen={setEdition}
            onFait={cocher}
          />
        ) : (
          <div className="ag">
            <Grille
              jours={
                mode === 'jour' ? [jour] : Array.from({ length: 7 }, (_, k) => plusJours(lundi, k))
              }
              data={data}
              slug={slug}
              aujourdhui={aujourdhui}
              maintenant={new Date()}
              onOpen={setEdition}
              onPatch={(t, patch) => void modifier(t, patch)}
              onJour={mode === 'semaine' ? voirJour : undefined}
            />
            <Panneau
              jours={
                mode === 'jour' ? [jour] : Array.from({ length: 7 }, (_, k) => plusJours(lundi, k))
              }
              data={data}
              aujourdhui={aujourdhui}
              onOpen={setEdition}
              onFait={cocher}
              onMove={(t, echeance) => void modifier(t, { echeance })}
              onMoveAll={(moves) => void deplacerTout(moves)}
            />
          </div>
        ))}
      {edition && data && (
        <EditionTache
          tache={edition === 'nouvelle' ? null : edition}
          hubspot={data.hubspot}
          slug={slug}
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
