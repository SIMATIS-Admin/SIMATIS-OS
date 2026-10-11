import { useCallback, useEffect, useState, type DragEvent } from 'react';
import {
  createTache,
  fetchTaches,
  updateTache,
  type SemaineTaches,
  type TacheSaisie,
  type TacheVue,
} from '../api.js';
import { Icon } from '../icons.js';
import { Modal } from './Overlay.js';
import { TYPES, iso, lundiDe, plusJours } from './taches/commun.js';
import { jourParis, memeHeure, titreSemaine } from './taches/creneaux.js';
import { MIME_TACHE, Semaine } from './taches/Semaine.js';

type Mode = 'semaine' | 'liste';
type FiltreType = 'tout' | TacheVue['canal'];
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
// <input type="datetime-local"> works in the browser's time (Paris for the pilot).
const versSaisie = (e: string | null) => {
  if (!e) return '';
  const d = new Date(e);
  return `${iso(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const depuisSaisie = (v: string) => (v ? new Date(v).toISOString() : null);

export const estSimulation = (r: unknown): r is { simulation: true; message: string } =>
  typeof r === 'object' && r !== null && 'simulation' in r;

export function Pastilles({ t }: { t: TacheVue }) {
  const [ico, lbl] = TYPES[t.canal];
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

// Create (no task) or edit a task; `hubspot` shows the "Créer aussi dans HubSpot" box.
export function EditionTache({
  tache,
  hubspot,
  onSave,
  onClose,
}: {
  tache: TacheVue | null;
  hubspot: boolean;
  onSave: (saisie: TacheSaisie & { hubspot: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [titre, setTitre] = useState(tache?.titre ?? '');
  const [notes, setNotes] = useState(tache?.notes ?? '');
  const [echeance, setEcheance] = useState(versSaisie(tache?.echeance ?? null));
  const [fait, setFait] = useState(tache?.fait ?? false);
  const [versHubspot, setVersHubspot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    setError(null);
    const saisie = {
      titre: titre.trim(),
      notes: notes.trim() ? notes : null,
      echeance: depuisSaisie(echeance),
      ...(tache ? { fait } : {}),
      hubspot: versHubspot,
    };
    onSave(saisie)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal title={tache ? 'Modifier la tâche' : 'Nouvelle tâche'} onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        <label className="field">
          <span>Intitulé</span>
          <input className="input" value={titre} onChange={(e) => setTitre(e.target.value)} />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Échéance</span>
          <input
            className="input"
            type="datetime-local"
            value={echeance}
            onChange={(e) => setEcheance(e.target.value)}
          />
        </label>
        {tache && (
          <label className="check">
            <input type="checkbox" checked={fait} onChange={(e) => setFait(e.target.checked)} />
            <span>Faite</span>
          </label>
        )}
        {tache && (tache.contact || tache.opportunite) && (
          <p className="small muted">
            {[tache.contact?.nom, tache.opportunite?.titre].filter(Boolean).join(' · ')}
          </p>
        )}
        {!tache && hubspot && (
          <label className="check">
            <input
              type="checkbox"
              checked={versHubspot}
              onChange={(e) => setVersHubspot(e.target.checked)}
            />
            <span>Créer aussi dans HubSpot</span>
          </label>
        )}
        {error && (
          <p className="small" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}
        <div>
          <button className="btn primary" disabled={busy || !titre.trim()} onClick={submit}>
            {tache ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Liste({
  data,
  onOpen,
  onFait,
}: {
  data: SemaineTaches;
  onOpen: (t: TacheVue) => void;
  onFait: (t: TacheVue) => void;
}) {
  const [type, setType] = useState<FiltreType>('tout');
  const [statut, setStatut] = useState<FiltreStatut>('a_faire');
  const [origine, setOrigine] = useState<FiltreOrigine>('tout');
  const toutes = [...data.enRetard, ...data.taches, ...data.sansEcheance];
  const shown = toutes
    .filter((t) => (statut === 'faites' ? t.fait : !t.fait))
    .filter((t) => type === 'tout' || t.canal === type)
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
        {chip<FiltreType>('tout', type, setType, 'Tous types')}
        {chip<FiltreType>('email', type, setType, 'Email')}
        {chip<FiltreType>('appel', type, setType, 'Téléphone')}
        {chip<FiltreType>('tache', type, setType, 'Action')}
        <span className="muted">·</span>
        {chip<FiltreStatut>('a_faire', statut, setStatut, 'À faire')}
        {chip<FiltreStatut>('faites', statut, setStatut, 'Faites')}
        {data.hubspot && (
          <>
            <span className="muted">·</span>
            {chip<FiltreOrigine>('tout', origine, setOrigine, 'Toutes origines')}
            {chip<FiltreOrigine>('hubspot', origine, setOrigine, 'HubSpot')}
            {chip<FiltreOrigine>('os', origine, setOrigine, 'OS')}
          </>
        )}
      </div>
      <div className="panel-b">
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
                    <span className={data.enRetard.includes(t) ? 'late' : ''}>
                      {echeanceLisible(t.echeance)}
                    </span>{' '}
                    <Pastilles t={t} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">Aucune tâche pour ces filtres.</div>
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

  const load = useCallback(() => {
    fetchTaches(slug, lundi, plusJours(lundi, 6)).then(setData, (e: unknown) =>
      setMessage(e instanceof Error ? e.message : String(e)),
    );
  }, [slug, lundi]);
  useEffect(load, [load]);

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
      {message && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div>{message}</div>
        </div>
      )}
      {data &&
        (mode === 'liste' ? (
          <Liste
            data={data}
            onOpen={setEdition}
            onFait={(t) => void modifier(t, { fait: !t.fait })}
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
            const r =
              edition === 'nouvelle'
                ? await createTache(slug, { ...saisie, hubspot })
                : await updateTache(slug, edition.id, saisie);
            setEdition(null);
            apres(r);
          }}
        />
      )}
    </>
  );
}
