import { useCallback, useEffect, useState } from 'react';
import {
  ajouterSujet,
  decider,
  fetchExecution,
  fetchInbox,
  fetchRoutines,
  lancerRoutine,
  marquerSujetTraite,
  remettreSujet,
  sujetEnTache,
  type Execution,
  type RoutineInfo,
  type SujetVue,
  type TypeSujet,
} from '../api.js';
import { Icon } from '../icons.js';
import { PropositionDetail } from './inbox/Proposition.js';
import { EditionTache } from './taches/Edition.js';

// Same rule as the Routines screen: an execution is open until the server says it ended.
const OUVERTE = new Set(['demandee', 'en_cours']);

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

function Detail({
  s,
  onTraite,
  onRemettre,
  onTache,
}: {
  s: SujetVue;
  onTraite: () => void;
  onRemettre: () => void;
  onTache: () => void;
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
      <button className="btn sm" disabled={!routine.actif || enCours} onClick={lancer}>
        <Icon name="play" />
        {enCours ? 'Mise à jour en cours…' : "Mettre à jour l'Inbox"}
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

// Entry typed by hand. It lands in this instance's Inbox; the Inbox routine notes it in the
// second brain at its next run.
function Ajout({ slug, onAjoute }: { slug: string; onAjoute: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [titre, setTitre] = useState('');
  const [resume, setResume] = useState('');
  const [jour, setJour] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fermer = () => {
    setOuvert(false);
    setTitre('');
    setResume('');
    setJour('');
    setError(null);
  };
  const envoyer = () => {
    setError(null);
    ajouterSujet(slug, {
      titre: titre.trim(),
      resume: resume.trim() || undefined,
      // Noon, local time: the day stays the same wherever the server runs.
      echeance: jour ? new Date(`${jour}T12:00:00`).toISOString() : undefined,
    }).then(
      () => {
        fermer();
        onAjoute();
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };

  if (!ouvert)
    return (
      <button className="btn sm" onClick={() => setOuvert(true)}>
        Ajouter
      </button>
    );
  return (
    <div className="panel stack" style={{ gap: 8, flexBasis: '100%' }}>
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
    </div>
  );
}

// The Inbox: what to handle, per instance. In Mon activité it also gathers the active mandates;
// every action goes to the subject's own instance.
export function Inbox({ slug, onChange }: { slug: string; onChange?: () => void }) {
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const [list, setList] = useState<SujetVue[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [mandat, setMandat] = useState('');
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

  const fini = useCallback(
    (e: Execution) => {
      load();
      onChange?.();
      setMessage(
        e.statut === 'echouee' ? 'La mise à jour de l’Inbox a échoué.' : 'Inbox mise à jour.',
      );
    },
    [load, onChange],
  );

  const instances = [...new Map((list ?? []).map((s) => [s.instance.slug, s.instance])).values()];
  const ensemble = instances.some((i) => i.slug !== slug);
  const visibles = (list ?? []).filter((s) => !mandat || s.instance.slug === mandat);
  const choisi = visibles.find((s) => s.id === sel) ?? visibles[0];

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
      />
    );
  };

  return (
    <div className="vq">
      <div className="panel">
        <div className="vq-filter">
          {FILTRES.map(([f, l]) => (
            <button
              key={f}
              className={`chip ${filtre === f ? 'on' : ''}`}
              onClick={() => {
                setFiltre(f);
                setSel(null);
              }}
            >
              {l}
            </button>
          ))}
          {ensemble && (
            <select
              className="input"
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
            </select>
          )}
          <Ajout
            slug={slug}
            onAjoute={() =>
              apres(
                'Entrée ajoutée. Elle sera notée dans le second cerveau à la prochaine mise à jour de l’Inbox.',
              )
            }
          />
          {routine && <MiseAJour slug={slug} routine={routine} onFini={fini} />}
        </div>
        <div className="vq-list">
          {visibles.length ? (
            visibles.map((s) => (
              <Ligne
                key={s.id}
                s={s}
                slug={slug}
                on={s.id === choisi?.id}
                onOuvrir={() => setSel(s.id)}
                onCocher={() => void agir(marquerSujetTraite(s.instance.slug, s.id), 'Traité.')}
              />
            ))
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
