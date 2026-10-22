import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ajouterDepuisEchange,
  ajouterSujet,
  modifierSujet,
  annulerEchange,
  decider,
  fetchEchange,
  fetchExecution,
  fetchInbox,
  fetchRoutines,
  lancerRoutine,
  marquerSujetTraite,
  ouvrirEchange,
  remettreSujet,
  repondreEchange,
  sujetEnTache,
  type EchangeAjout,
  type Execution,
  type RoutineInfo,
  type SujetVue,
  type TypeSujet,
} from '../api.js';
import { Icon } from '../icons.js';
import { PropositionDetail } from './inbox/Proposition.js';
import { EditionTache } from './taches/Edition.js';

// Priority of a new entry, from 1 (low) to 5 (high); mirrors the server default.
const PRIORITE_DEFAUT = 3;

// Same rule as the Routines screen: an execution is open until the server says it ended.
const OUVERTE = new Set(['demandee', 'en_cours']);
// The runner polls every 30 s: a request still untouched after this long means it is not running.
const SANS_REPONSE_MS = 2 * 60_000;

const FILTRES = [
  ['tout', 'Tout'],
  ['mails', 'Mails'],
  ['devis', 'Devis'],
  ['diagnostics', 'Diagnostics'],
  ['comptes_rendus', 'Comptes rendus'],
  ['a_valider', 'À valider'],
  ['traites', 'Traités'],
] as const;
type Filtre = (typeof FILTRES)[number][0];

const TYPES: Record<TypeSujet, [string, string]> = {
  mail_a_repondre: ['send', 'Mail à répondre'],
  brouillon_non_envoye: ['edit', 'Brouillon non envoyé'],
  devis: ['file', 'Devis'],
  diagnostic: ['radar', 'Diagnostic'],
  compte_rendu: ['cal', 'Compte rendu'],
  a_valider: ['flag', 'À valider'],
  autre: ['info', 'Autre'],
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
const depassee = (s: SujetVue) => s.echeance !== null && Date.parse(s.echeance) < Date.now();
// The server only stores web addresses; checked again here because the link is clickable.
const lienWeb = (lien: string | null) => (lien && /^https?:\/\//i.test(lien) ? lien : null);
const qui = (s: SujetVue) => s.contact?.nom ?? s.entreprise?.nom ?? '';

// Ways to order the entries of the list; the treated ones keep their own order.
type Tri = 'priorite' | 'arrivee';
const TRIS: [Tri, string][] = [
  ['priorite', 'Priorité puis échéance'],
  ['arrivee', 'Plus récentes d’abord'],
];
const parEcheance = (a: SujetVue, b: SujetVue) => {
  if (a.echeance && b.echeance) return a.echeance.localeCompare(b.echeance);
  if (a.echeance) return -1;
  if (b.echeance) return 1;
  return b.createdAt.localeCompare(a.createdAt);
};
const parPriorite = (a: SujetVue, b: SujetVue) => b.priorite - a.priorite;
const TRIS_COMPARATEURS: Record<Tri, (a: SujetVue, b: SujetVue) => number> = {
  priorite: (a, b) => parPriorite(a, b) || parEcheance(a, b),
  arrivee: (a, b) => b.createdAt.localeCompare(a.createdAt),
};

// Urgency sections, by day in Paris: what is late, due today, due this week, later, or undated.
type Secteur = 'retard' | 'aujourdhui' | 'semaine' | 'plus_tard' | 'sans_echeance';
const SECTEURS: [Secteur, string][] = [
  ['retard', 'En retard'],
  ['aujourdhui', 'Aujourd’hui'],
  ['semaine', 'Cette semaine'],
  ['plus_tard', 'Plus tard'],
  ['sans_echeance', 'Sans échéance'],
];
const jourParis = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const secteurDe = (s: SujetVue, aujourdhui: string, fin: string): Secteur => {
  if (!s.echeance) return 'sans_echeance';
  const jour = jourParis(new Date(s.echeance));
  if (jour < aujourdhui) return 'retard';
  if (jour === aujourdhui) return 'aujourdhui';
  return jour <= fin ? 'semaine' : 'plus_tard';
};

function Ligne({
  s,
  slug,
  on,
  onOuvrir,
  onCocher,
}: {
  s: SujetVue;
  slug: string;
  on: boolean;
  onOuvrir: () => void;
  onCocher: () => void;
}) {
  const [ico, libelle] = TYPES[s.type];
  return (
    <div className={`vq-item inbox-item ${on ? 'on' : ''}`}>
      {s.statut === 'a_traiter' && s.type !== 'a_valider' ? (
        <input type="checkbox" aria-label="Marquer comme traité" onChange={onCocher} />
      ) : (
        <span className="inbox-case" />
      )}
      <button type="button" className="inbox-ouvrir" onClick={onOuvrir}>
        <div className="row1">
          <span className="inbox-type" title={libelle} aria-label={libelle}>
            <Icon name={ico} />
          </span>
          <b className="vq-titre">{s.titre}</b>
          <Jauge niveau={s.priorite} />
          {s.instance.slug !== slug && (
            <span
              className="badge badge-instance"
              style={{ borderColor: s.instance.couleur ?? undefined }}
            >
              {s.instance.nom}
            </span>
          )}
        </div>
        <small>
          {qui(s) && `${qui(s)} · `}
          {s.echeance && (
            <span className={`echeance ${depassee(s) ? 'red' : ''}`}>
              Échéance {date(s.echeance)} ·{' '}
            </span>
          )}
          arrivé le {date(s.createdAt)}
        </small>
      </button>
    </div>
  );
}

// Gauge of the priority: five segments from green (1, not urgent) to red (5, urgent); the lit ones
// are the priority, the others stay grey.
function Jauge({ niveau }: { niveau: number }) {
  return (
    <span
      className="inbox-jauge"
      role="img"
      aria-label={`Priorité ${niveau} sur 5`}
      title={`Priorité ${niveau} sur 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className="inbox-jauge-case"
          style={n <= niveau ? { background: `hsl(${120 - (n - 1) * 30} 60% 42%)` } : undefined}
        />
      ))}
    </span>
  );
}

// Priority and due date of an entry: shown as they are, changed through the pencil only.
function Reglages({
  s,
  onModifier,
}: {
  s: SujetVue;
  onModifier: (modif: { echeance?: string | null; priorite?: number }) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [jour, setJour] = useState(s.echeance ? jourParis(new Date(s.echeance)) : '');
  return (
    <div className="inbox-reglages">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Jauge niveau={s.priorite} />
        <button
          className="btn sm"
          aria-expanded={ouvert}
          aria-label="Modifier l’échéance et la priorité"
          title="Modifier l’échéance et la priorité"
          onClick={() => setOuvert(!ouvert)}
        >
          <Icon name="edit" />
        </button>
      </div>
      {ouvert && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <label className="field">
            <span>Échéance</span>
            <input
              className="input"
              type="date"
              value={jour}
              onChange={(e) => {
                setJour(e.target.value);
                // Noon, local time: the day stays the same wherever the server runs.
                onModifier({
                  echeance: e.target.value
                    ? new Date(`${e.target.value}T12:00:00`).toISOString()
                    : null,
                });
              }}
            />
          </label>
          <label className="field">
            <span>Priorité (5 = la plus haute)</span>
            <select
              className="input"
              value={s.priorite}
              onChange={(e) => onModifier({ priorite: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function Detail({
  s,
  onTraite,
  onRemettre,
  onTache,
  onModifier,
}: {
  s: SujetVue;
  onTraite: () => void;
  onRemettre: () => void;
  onTache: () => void;
  onModifier: (modif: { echeance?: string | null; priorite?: number }) => void;
}) {
  return (
    <div className="panel inbox-detail">
      <div className="panel-h">
        <h2>{s.titre}</h2>
        <span className="badge">{TYPES[s.type][1]}</span>
      </div>
      <div className="panel-b">
        <div className="meta-row" style={{ marginBottom: 12 }}>
          {qui(s) && (
            <span>
              {s.contact ? 'Contact' : 'Entreprise'} : <b>{qui(s)}</b>
            </span>
          )}
          {s.echeance && (
            <span className={depassee(s) ? 'red' : ''}>
              Échéance : <b>{date(s.echeance)}</b>
            </span>
          )}
          <span>
            Arrivé le <b>{date(s.createdAt)}</b>
          </span>
        </div>
        {s.resume && <p style={{ whiteSpace: 'pre-line' }}>{s.resume}</p>}
        {s.statut === 'a_traiter' && s.type !== 'a_valider' && (
          <Reglages key={s.id} s={s} onModifier={onModifier} />
        )}
        <div className="decision">
          {lienWeb(s.lien) && (
            <a className="btn" href={lienWeb(s.lien) ?? undefined} target="_blank" rel="noreferrer">
              <Icon name="search" />
              Ouvrir la source
            </a>
          )}
          {s.statut === 'a_traiter' ? (
            <>
              <button className="btn go" onClick={onTache}>
                <Icon name="check" />
                Transformer en tâche
              </button>
              <button className="btn" onClick={onTraite}>
                Marquer comme traité
              </button>
            </>
          ) : (
            <>
              {s.tacheId && (
                <a className="btn" href={`#/${s.instance.slug}/taches`}>
                  Voir la tâche
                </a>
              )}
              {s.type !== 'a_valider' && (
                <button className="btn" onClick={onRemettre}>
                  Remettre à traiter
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Runs the Inbox routine on demand and follows it until it ends. Only one run at a time: the
// button stays off while an execution is open, including one started from the Routines screen.
function MiseAJour({
  slug,
  routine,
  onFini,
}: {
  slug: string;
  routine: RoutineInfo;
  onFini: (e: Execution) => void;
}) {
  const [execution, setExecution] = useState<Execution | null>(routine.derniere);
  const [error, setError] = useState<string | null>(null);
  const idOuverte = execution && OUVERTE.has(execution.statut) ? execution.id : null;

  useEffect(() => {
    if (!idOuverte) return;
    const timer = setInterval(() => {
      fetchExecution(slug, idOuverte).then(
        (e) => {
          setExecution(e);
          if (!OUVERTE.has(e.statut)) {
            clearInterval(timer);
            onFini(e);
          }
        },
        (e: unknown) => {
          clearInterval(timer);
          setError(e instanceof Error ? e.message : String(e));
        },
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [slug, idOuverte, onFini]);

  const lancer = () => {
    setError(null);
    lancerRoutine(slug, routine.cle).then(setExecution, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  };
  const enCours = idOuverte !== null;

  return (
    <>
      <button
        className={`btn carre ${enCours ? 'tourne' : ''}`}
        aria-label={enCours ? 'Mise à jour en cours…' : "Mettre à jour l'Inbox"}
        title={enCours ? 'Mise à jour en cours…' : "Mettre à jour l'Inbox"}
        disabled={!routine.actif || enCours}
        onClick={lancer}
      >
        <Icon name="refresh" />
      </button>
      {!routine.actif && <span className="hint">Routine en pause</span>}
      {error && (
        <span className="small" style={{ color: 'var(--red)' }}>
          {error}
        </span>
      )}
    </>
  );
}

// Entry typed by hand.
function Formulaire({
  slug,
  onFermer,
  onAjoute,
}: {
  slug: string;
  onFermer: () => void;
  onAjoute: () => void;
}) {
  const [titre, setTitre] = useState('');
  const [resume, setResume] = useState('');
  const [jour, setJour] = useState('');
  const [priorite, setPriorite] = useState(PRIORITE_DEFAUT);
  const [error, setError] = useState<string | null>(null);

  const fermer = () => {
    onFermer();
    setTitre('');
    setResume('');
    setJour('');
    setPriorite(PRIORITE_DEFAUT);
    setError(null);
  };
  const envoyer = () => {
    setError(null);
    ajouterSujet(slug, {
      titre: titre.trim(),
      resume: resume.trim() || undefined,
      // Noon, local time: the day stays the same wherever the server runs.
      echeance: jour ? new Date(`${jour}T12:00:00`).toISOString() : undefined,
      priorite,
    }).then(
      () => {
        fermer();
        onAjoute();
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };

  return (
    <>
      <label className="field">
        <span>Sujet</span>
        <input className="input" value={titre} onChange={(e) => setTitre(e.target.value)} />
      </label>
      <label className="field">
        <span>Détail (facultatif)</span>
        <textarea
          className="input"
          rows={3}
          value={resume}
          onChange={(e) => setResume(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Échéance (facultatif)</span>
        <input
          className="input"
          type="date"
          value={jour}
          onChange={(e) => setJour(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Priorité (5 = la plus haute)</span>
        <select
          className="input"
          value={priorite}
          onChange={(e) => setPriorite(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <span className="small" style={{ color: 'var(--red)' }}>
          {error}
        </span>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm primary" disabled={!titre.trim()} onClick={envoyer}>
          Ajouter à l'Inbox
        </button>
        <button className="btn sm" onClick={fermer}>
          Annuler
        </button>
      </div>
    </>
  );
}

const EN_ATTENTE = new Set(['attente_claude', 'en_cours']);

// Entry prepared with Claude: the pilot says it in their own words, the workstation's runner has
// Claude answer (a question and/or the prepared entry), and nothing is added before the pilot's
// click.
function AvecClaude({
  slug,
  onFermer,
  onAjoute,
}: {
  slug: string;
  onFermer: () => void;
  onAjoute: () => void;
}) {
  const [echange, setEchange] = useState<EchangeAjout | null>(null);
  const [texte, setTexte] = useState('');
  const [error, setError] = useState<string | null>(null);
  const erreur = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const idAttente = echange && EN_ATTENTE.has(echange.statut) ? echange.id : null;

  useEffect(() => {
    if (!idAttente) return;
    const timer = setInterval(() => {
      fetchEchange(slug, idAttente).then(setEchange, (e: unknown) => {
        clearInterval(timer);
        erreur(e);
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [slug, idAttente]);

  const envoyer = () => {
    const t = texte.trim();
    if (!t) return;
    setError(null);
    (echange ? repondreEchange(slug, echange.id, t) : ouvrirEchange(slug, t)).then((e) => {
      setEchange(e);
      setTexte('');
    }, erreur);
  };
  const ajouter = () => {
    if (!echange) return;
    setError(null);
    ajouterDepuisEchange(slug, echange.id).then(onAjoute, erreur);
  };
  const annuler = () => {
    if (echange && (EN_ATTENTE.has(echange.statut) || echange.statut === 'attente_pilote')) {
      void annulerEchange(slug, echange.id).catch(() => undefined);
    }
    onFermer();
  };

  const attente = idAttente !== null;
  const sansReponse =
    echange?.statut === 'attente_claude' &&
    Date.now() - new Date(echange.demandeAt).getTime() > SANS_REPONSE_MS;
  const b = echange?.brouillon;
  return (
    <>
      {echange && (
        <div className="chat-ajout" aria-live="polite">
          {echange.messages.map((m) => (
            <p key={m.at + m.de} className={`chat-msg ${m.de}`}>
              {m.texte}
            </p>
          ))}
          {attente && (
            <p className="chat-msg claude muted">
              {echange.statut === 'en_cours' ? 'Claude réfléchit…' : 'Transmis à Claude…'}
            </p>
          )}
        </div>
      )}
      {b && (
        <div className="chat-brouillon">
          <span className="small muted">Entrée préparée</span>
          <div className="row1">
            <span className="inbox-type" title={TYPES[b.type][1]}>
              <Icon name={TYPES[b.type][0]} />
            </span>
            <b>{b.titre}</b>
            <span className="badge">{TYPES[b.type][1]}</span>
          </div>
          {b.echeance && <small>Échéance {date(b.echeance)}</small>}
          {b.resume && <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{b.resume}</p>}
        </div>
      )}
      {sansReponse && (
        <span className="small" style={{ color: 'var(--red)' }}>
          L'exécuteur ne répond pas : vérifiez qu'il tourne sur l'ordinateur, ou passez par le
          formulaire.
        </span>
      )}
      {(error ?? echange?.erreur) && (
        <span className="small" style={{ color: 'var(--red)' }}>
          {error ?? echange?.erreur}
        </span>
      )}
      <label className="field">
        <span>{echange ? 'Votre réponse' : 'Que faut-il ajouter ?'}</span>
        <textarea
          className="input"
          rows={2}
          value={texte}
          disabled={attente}
          placeholder={echange ? '' : 'Ex. : faire le devis pour la société X avant jeudi'}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              envoyer();
            }
          }}
        />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" disabled={attente || !texte.trim()} onClick={envoyer}>
          Envoyer à Claude
        </button>
        <button
          className="btn sm primary"
          disabled={!b || echange?.statut !== 'attente_pilote'}
          onClick={ajouter}
        >
          Ajouter à l'Inbox
        </button>
        <button className="btn sm" onClick={annuler}>
          Annuler
        </button>
      </div>
    </>
  );
}

// Adding an entry: each time, the pilot picks Claude (said in their own words) or the form. It lands
// in this instance's Inbox; the Inbox routine notes it in the second brain at its next run.
function Ajout({
  slug,
  ouvert,
  onFermer,
  onAjoute,
}: {
  slug: string;
  ouvert: boolean;
  onFermer: () => void;
  onAjoute: () => void;
}) {
  const [mode, setMode] = useState<'claude' | 'formulaire'>('claude');
  if (!ouvert) return null;
  const fermer = () => {
    setMode('claude');
    onFermer();
  };
  const ajoute = () => {
    fermer();
    onAjoute();
  };
  return (
    <div className="panel stack" style={{ gap: 8, flexBasis: '100%' }}>
      <div className="row" role="group" aria-label="Mode d'ajout" style={{ gap: 6 }}>
        <button
          className={`chip ${mode === 'claude' ? 'on' : ''}`}
          aria-pressed={mode === 'claude'}
          onClick={() => setMode('claude')}
        >
          Avec Claude
        </button>
        <button
          className={`chip ${mode === 'formulaire' ? 'on' : ''}`}
          aria-pressed={mode === 'formulaire'}
          onClick={() => setMode('formulaire')}
        >
          Formulaire
        </button>
      </div>
      {mode === 'claude' ? (
        <AvecClaude slug={slug} onFermer={fermer} onAjoute={ajoute} />
      ) : (
        <Formulaire slug={slug} onFermer={fermer} onAjoute={() => onAjoute()} />
      )}
    </div>
  );
}

// The Inbox: what to handle, per instance. In Mon activité it also gathers the active mandates;
// every action goes to the subject's own instance.
export function Inbox({
  slug,
  onChange,
  ajoutOuvert = false,
  onAjoutFerme = () => undefined,
  pasAPas = false,
  entete,
}: {
  slug: string;
  onChange?: () => void;
  ajoutOuvert?: boolean;
  onAjoutFerme?: () => void;
  // Subject by subject mode, started by the button beside the « + » of the header.
  pasAPas?: boolean;
  // Slots of the page header, where the update button and the mandate filter are shown.
  entete?: { gauche: HTMLElement | null; droite: HTMLElement | null };
}) {
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const [list, setList] = useState<SujetVue[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [mandat, setMandat] = useState('');
  const [secteur, setSecteur] = useState<Secteur | null>(null);
  const [tri, setTri] = useState<Tri>('priorite');
  const [message, setMessage] = useState<string | null>(null);
  const [edition, setEdition] = useState<SujetVue | null>(null);
  // No button when the instance has no Inbox routine (or the routines cannot be read).
  const [routine, setRoutine] = useState<RoutineInfo | null>(null);

  const load = useCallback(() => {
    fetchInbox(slug, filtre).then(setList, (e: unknown) => setMessage(String(e)));
  }, [slug, filtre]);
  useEffect(load, [load]);
  useEffect(() => {
    fetchRoutines(slug).then(
      (rs) => setRoutine(rs.find((r) => r.cle === 'inbox') ?? null),
      () => setRoutine(null),
    );
  }, [slug]);

  const fini = useCallback(() => {
    load();
    onChange?.();
  }, [load, onChange]);

  const instances = [...new Map((list ?? []).map((s) => [s.instance.slug, s.instance])).values()];
  const ensemble = instances.some((i) => i.slug !== slug);
  const maintenant = Date.now();
  const aujourdhui = jourParis(new Date(maintenant));
  const fin = jourParis(new Date(maintenant + 6 * 86_400_000));
  const parMandat = (list ?? [])
    .filter((s) => !mandat || s.instance.slug === mandat)
    .sort(filtre === 'traites' ? () => 0 : TRIS_COMPARATEURS[tri]);
  const compteurs = Object.fromEntries(
    SECTEURS.map(([k]) => [k, parMandat.filter((s) => secteurDe(s, aujourdhui, fin) === k).length]),
  ) as Record<Secteur, number>;
  // Treated subjects keep their order, as a single list.
  const visibles =
    secteur && filtre !== 'traites'
      ? parMandat.filter((s) => secteurDe(s, aujourdhui, fin) === secteur)
      : parMandat;
  const groupes =
    filtre === 'traites'
      ? [{ cle: null, titre: null, items: visibles }]
      : SECTEURS.map(([cle, titre]) => ({
          cle,
          titre,
          items: visibles.filter((s) => secteurDe(s, aujourdhui, fin) === cle),
        })).filter((g) => g.items.length > 0);
  const choisi = visibles.find((s) => s.id === sel) ?? visibles[0];
  const position = Math.max(
    0,
    visibles.findIndex((s) => s.id === choisi?.id),
  );

  const apres = (texte: string | null) => {
    setMessage(texte);
    load();
    onChange?.();
  };
  const erreur = (e: unknown) => setMessage(e instanceof Error ? e.message : String(e));
  const agir = (p: Promise<unknown>, texte: string) => p.then(() => apres(texte), erreur);

  const detail = () => {
    if (!choisi) return <div className="panel empty">Sélectionnez un sujet à gauche.</div>;
    const s = choisi;
    // Pending or decided, a proposal shows its own content and decision.
    if (s.type === 'a_valider' && s.proposition) {
      return (
        <PropositionDetail
          p={s.proposition}
          onDecide={(d, contenu) =>
            void decider(s.instance.slug, s.proposition?.id ?? '', d, contenu).then(
              (p) =>
                apres(
                  p.statut === 'echec'
                    ? `Échec : ${(p.resultat as { erreur?: string } | null)?.erreur ?? ''}`
                    : d === 'ecarter'
                      ? 'Écarté.'
                      : 'Validé.',
                ),
              erreur,
            )
          }
        />
      );
    }
    return (
      <Detail
        s={s}
        onTraite={() => void agir(marquerSujetTraite(s.instance.slug, s.id), 'Traité.')}
        onRemettre={() => void agir(remettreSujet(s.instance.slug, s.id), 'Remis à traiter.')}
        onTache={() => setEdition(s)}
        onModifier={(modif) =>
          void agir(modifierSujet(s.instance.slug, s.id, modif), 'Entrée modifiée.')
        }
      />
    );
  };

  return (
    <div className="vq">
      <div className="panel">
        <div className="vq-filter inbox-filtres">
          <select
            className="input inbox-type"
            aria-label="Type d'entrée"
            value={filtre}
            onChange={(e) => {
              setFiltre(e.target.value as Filtre);
              setSecteur(null);
              setSel(null);
            }}
          >
            {FILTRES.map(([f, l]) => (
              <option key={f} value={f}>
                {l}
              </option>
            ))}
          </select>
          <Ajout
            slug={slug}
            ouvert={ajoutOuvert}
            onFermer={onAjoutFerme}
            onAjoute={() =>
              apres(
                'Entrée ajoutée. Elle sera notée dans le second cerveau à la prochaine mise à jour de l’Inbox.',
              )
            }
          />
        </div>
        {/* The update button and the mandate filter sit in the page header, beside the title. */}
        {entete?.gauche &&
          routine &&
          createPortal(<MiseAJour slug={slug} routine={routine} onFini={fini} />, entete.gauche)}
        {entete?.droite &&
          ensemble &&
          createPortal(
            <select
              className="input inbox-mandat"
              aria-label="Mandat"
              value={mandat}
              onChange={(e) => setMandat(e.target.value)}
            >
              <option value="">Tous</option>
              {instances.map((i) => (
                <option key={i.slug} value={i.slug}>
                  {i.nom}
                </option>
              ))}
            </select>,
            entete.droite,
          )}
        {filtre !== 'traites' && (
          <div className="inbox-compteurs" role="group" aria-label="Urgences">
            {SECTEURS.map(([k, libelle]) => (
              <button
                key={k}
                className={`chip ${secteur === k ? 'on' : ''} ${k === 'retard' && compteurs[k] ? 'alerte' : ''}`}
                aria-pressed={secteur === k}
                onClick={() => {
                  setSecteur(secteur === k ? null : k);
                  setSel(null);
                }}
              >
                {libelle} <b>{compteurs[k]}</b>
              </button>
            ))}
            <select
              className="input inbox-tri"
              aria-label="Trier les entrées"
              value={tri}
              onChange={(e) => setTri(e.target.value as Tri)}
            >
              {TRIS.map(([k, libelle]) => (
                <option key={k} value={k}>
                  {libelle}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="vq-list">
          {visibles.length && filtre !== 'traites' && pasAPas ? (
            <div className="inbox-pas">
              <button
                className="btn sm"
                disabled={position <= 0}
                onClick={() => setSel(visibles[position - 1]?.id ?? null)}
              >
                ‹ Précédent
              </button>
              <span className="small muted">
                {position + 1} / {visibles.length}
              </span>
              <button
                className="btn sm"
                disabled={position >= visibles.length - 1}
                onClick={() => setSel(visibles[position + 1]?.id ?? null)}
              >
                Suivant ›
              </button>
            </div>
          ) : null}
          {visibles.length ? (
            filtre !== 'traites' && pasAPas ? null : (
              groupes.map((g) => (
                <section key={g.cle ?? 'liste'} className="inbox-groupe">
                  {g.titre && (
                    <h3 className="inbox-section">
                      {g.titre} <span className="muted">{g.items.length}</span>
                    </h3>
                  )}
                  {g.items.map((s) => (
                    <Ligne
                      key={s.id}
                      s={s}
                      slug={slug}
                      on={s.id === choisi?.id}
                      onOuvrir={() => setSel(s.id)}
                      onCocher={() =>
                        void agir(marquerSujetTraite(s.instance.slug, s.id), 'Traité.')
                      }
                    />
                  ))}
                </section>
              ))
            )
          ) : (
            <div className="empty">
              {list === null
                ? ''
                : filtre === 'traites'
                  ? 'Aucun sujet traité pour l’instant.'
                  : 'Rien à traiter. La prochaine routine déposera les nouveaux sujets.'}
            </div>
          )}
        </div>
      </div>
      <div>
        {message && <p className="small muted">{message}</p>}
        {detail()}
      </div>
      {edition && (
        <EditionTache
          tache={null}
          hubspot={false}
          slug={edition.instance.slug}
          initial={{ titre: edition.titre, echeance: edition.echeance, contact: edition.contact }}
          onClose={() => setEdition(null)}
          onSave={async (saisie) => {
            // Where the task goes is the server's rule (HubSpot when connected), not a choice
            // here: an undefined field is left out of the request.
            const champs = { ...saisie, hubspot: undefined };
            const r = await sujetEnTache(edition.instance.slug, edition.id, champs);
            setEdition(null);
            apres('simulation' in r ? r.message : 'Tâche créée.');
          }}
        />
      )}
    </div>
  );
}
