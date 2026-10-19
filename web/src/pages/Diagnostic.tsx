import { useEffect, useState, type FormEvent } from 'react';
import {
  creerProjetDiag,
  envoyerMessageDiag,
  fetchProjetsDiag,
  majProjetDiag,
  type ChatEtape,
  type Dimensions,
  type ProjetDiag,
  type ProjetDiagPatch,
} from '../api.js';
import { Icon } from '../icons.js';

// Libellés des activités et des modèles : les valeurs sont celles que le serveur accepte.
export const ACTIVITES = [
  ['usinage', 'Usinage et chaudronnerie'],
  ['services', 'Conseil et services aux PME'],
  ['batiment', 'Artisanat et bâtiment'],
  ['autre', 'Autre activité'],
] as const;
const ETAPES = [
  'Préparer la présentation',
  'Entretien et rapport de l’outil',
  'Analyser et produire le rapport',
];
const MODELES = [
  ['haiku', 'Haiku 5.5'],
  ['sonnet', 'Sonnet 5.5'],
  ['opus', 'Opus 5.5'],
  ['fable', 'Fable 5.1'],
] as const;
const EFFORTS = [
  ['faible', 'Faible'],
  ['moyen', 'Moyen'],
  ['eleve', 'Élevé'],
  ['max', 'Max'],
] as const;
// Préparation et entretien en Sonnet effort moyen ; rapport en Opus effort max.
const CHAT_DEFAUT: Record<number, Pick<ChatEtape, 'modele' | 'effort'>> = {
  1: { modele: 'sonnet', effort: 'moyen' },
  2: { modele: 'sonnet', effort: 'moyen' },
  3: { modele: 'opus', effort: 'max' },
};
const DIMENSIONS: [keyof Dimensions, string][] = [
  ['outils', 'Outils et méthode'],
  ['strategie', 'Stratégie, régularité, endurance'],
  ['polyvalence', 'Polyvalence'],
];
const SEUIL = 6;

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));
const libelle = (liste: readonly (readonly [string, string])[], v: string) =>
  liste.find(([k]) => k === v)?.[1] ?? v;

export function Diagnostic({ slug }: { slug: string }) {
  const [projets, setProjets] = useState<ProjetDiag[] | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetchProjetsDiag(slug)
      .then(setProjets)
      .catch((e) => setErreur(messageErreur(e)));
  }, [slug]);

  const remplacer = (maj: ProjetDiag) =>
    setProjets((liste) => liste?.map((p) => (p.id === maj.id ? maj : p)) ?? null);
  const projet = projets?.find((p) => p.id === ouvert) ?? null;

  if (erreur) return <div className="alert amber">{erreur}</div>;
  if (!projets) return <div className="panel empty">Chargement…</div>;
  if (projet) {
    return (
      <ProjetVue
        key={projet.id}
        slug={slug}
        projet={projet}
        onChange={remplacer}
        onRetour={() => setOuvert(null)}
        onErreur={setErreur}
      />
    );
  }
  return (
    <ListeProjets
      slug={slug}
      projets={projets}
      onOuvrir={setOuvert}
      onCree={(p) => {
        setProjets((liste) => [p, ...(liste ?? [])]);
        setOuvert(p.id);
      }}
      onErreur={setErreur}
    />
  );
}

function ListeProjets({
  slug,
  projets,
  onOuvrir,
  onCree,
  onErreur,
}: {
  slug: string;
  projets: ProjetDiag[];
  onOuvrir: (id: string) => void;
  onCree: (p: ProjetDiag) => void;
  onErreur: (m: string) => void;
}) {
  const [creation, setCreation] = useState(false);
  const [nom, setNom] = useState('');
  const [activite, setActivite] = useState<string>(ACTIVITES[0][0]);
  const [manque, setManque] = useState<string | null>(null);

  const creer = async (e: FormEvent) => {
    e.preventDefault();
    if (!nom.trim()) return setManque('Donnez un nom à l’entreprise.');
    try {
      onCree(await creerProjetDiag(slug, nom, activite));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-h">
          <div>
            <h2>Diagnostic d’endurance commerciale</h2>
            <div className="small muted">
              Un projet par entreprise. Vous pouvez le quitter : il reprend à la même étape.
            </div>
          </div>
          {!creation && (
            <button className="btn go" onClick={() => setCreation(true)}>
              Nouveau projet
            </button>
          )}
        </div>
        {creation && (
          <form
            className="panel-b stack"
            onSubmit={(e) => void creer(e)}
            aria-label="Nouveau projet"
          >
            <label className="field">
              <span>Nom de l’entreprise</span>
              <input value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Activité</span>
              <select value={activite} onChange={(e) => setActivite(e.target.value)}>
                {ACTIVITES.map(([id, nomActivite]) => (
                  <option key={id} value={id}>
                    {nomActivite}
                  </option>
                ))}
              </select>
            </label>
            {manque && <div className="alert amber">{manque}</div>}
            <div className="decision">
              <button className="btn go" type="submit">
                Créer et préparer
              </button>
              <button className="btn" type="button" onClick={() => setCreation(false)}>
                Annuler
              </button>
            </div>
          </form>
        )}
      </div>
      {projets.length === 0 ? (
        <div className="panel empty">
          Aucun projet. Créez-en un pour préparer le premier entretien.
        </div>
      ) : (
        <div className="panel">
          <div className="panel-b">
            {projets.map((p) => (
              <button key={p.id} className="vq-item" onClick={() => onOuvrir(p.id)}>
                <div className="row1">
                  <b>{p.nom}</b>
                  <span className="badge">
                    Étape {p.etape} · {ETAPES[p.etape - 1]}
                  </span>
                </div>
                <small>
                  {libelle(ACTIVITES, p.activite)}, modifié le{' '}
                  {new Date(p.updatedAt).toLocaleDateString('fr-FR')}
                </small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjetVue({
  slug,
  projet,
  onChange,
  onRetour,
  onErreur,
}: {
  slug: string;
  projet: ProjetDiag;
  onChange: (p: ProjetDiag) => void;
  onRetour: () => void;
  onErreur: (m: string) => void;
}) {
  // Pendant que Claude répond, le projet est relu toutes les cinq secondes.
  useEffect(() => {
    if (projet.statutChat === 'repos') return;
    const minuteur = setInterval(() => {
      fetchProjetsDiag(slug)
        .then((liste) => {
          const maj = liste.find((p) => p.id === projet.id);
          if (maj) onChange(maj);
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(minuteur);
  }, [slug, projet.id, projet.statutChat, onChange]);

  const sauver = async (patch: ProjetDiagPatch) => {
    try {
      onChange(await majProjetDiag(slug, projet.id, patch));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-h">
          <div>
            <h2>{projet.nom}</h2>
            <div className="small muted">{libelle(ACTIVITES, projet.activite)}</div>
          </div>
          <button className="btn" onClick={onRetour}>
            ← Tous les projets
          </button>
        </div>
        <div className="panel-b">
          <ol className="diag-etapes" aria-label="Étapes du diagnostic">
            {ETAPES.map((titre, i) => (
              <li key={titre}>
                <button
                  className={`diag-etape ${projet.etape === i + 1 ? 'on' : ''}`}
                  aria-current={projet.etape === i + 1 ? 'step' : undefined}
                  onClick={() => void sauver({ etape: i + 1 })}
                >
                  <span className="diag-num">{i + 1}</span>
                  {titre}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="diag-layout">
        <div className="diag-main">
          {projet.etape === 1 && <Preparation projet={projet} onSauver={sauver} />}
          {projet.etape === 2 && <Resultat projet={projet} onSauver={sauver} />}
          {projet.etape === 3 && <Analyse slug={slug} projet={projet} onSauver={sauver} />}
          <Pied projet={projet} onSauver={sauver} />
        </div>
        <Assistant slug={slug} projet={projet} onChange={onChange} onErreur={onErreur} />
      </div>
    </div>
  );
}

type Sauver = (patch: ProjetDiagPatch) => Promise<void>;

function Preparation({ projet, onSauver }: { projet: ProjetDiag; onSauver: Sauver }) {
  const [nom, setNom] = useState(projet.nom);
  const [contexte, setContexte] = useState(projet.contexte);
  useEffect(() => setNom(projet.nom), [projet.nom]);
  useEffect(() => setContexte(projet.contexte), [projet.contexte]);
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Contexte de l’entreprise</h2>
        <span className="small muted">Enregistré à la sortie de chaque champ</span>
      </div>
      <div className="panel-b stack">
        <label className="field">
          <span>Nom de l’entreprise</span>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            onBlur={() => nom.trim() && nom !== projet.nom && void onSauver({ nom: nom.trim() })}
          />
        </label>
        <label className="field">
          <span>Activité</span>
          <select
            value={projet.activite}
            onChange={(e) => void onSauver({ activite: e.target.value })}
          >
            {ACTIVITES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Ce que le dirigeant vous a dit</span>
          <textarea
            rows={5}
            value={contexte}
            placeholder="Activité, clients, projet du dirigeant, ce qui bloque aujourd’hui"
            onChange={(e) => setContexte(e.target.value)}
            onBlur={() => contexte !== projet.contexte && void onSauver({ contexte })}
          />
        </label>
        <div className="small muted">
          Le support de présentation n’est pas encore dans l’OS : il reste dans son artifact.
        </div>
      </div>
    </div>
  );
}

function Resultat({ projet, onSauver }: { projet: ProjetDiag; onSauver: Sauver }) {
  const [dims, setDims] = useState<Dimensions>(
    projet.dims ?? { outils: 0, strategie: 0, polyvalence: 0 },
  );
  const [statut, setStatut] = useState<ProjetDiag['statutDiagnostic']>(projet.statutDiagnostic);
  const [date, setDate] = useState(projet.dateDiagnostic ?? '');
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setDims(projet.dims ?? { outils: 0, strategie: 0, polyvalence: 0 });
    setStatut(projet.statutDiagnostic);
    setDate(projet.dateDiagnostic ?? '');
  }, [projet]);

  const enregistrer = async () => {
    setMessage(null);
    await onSauver({
      dims,
      statutDiagnostic: statut,
      dateDiagnostic: date || null,
    });
    setMessage('Résultat enregistré.');
  };

  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Résultat de l’outil externe</h2>
        {projet.profil && <span className="badge green">Profil : {projet.profil}</span>}
      </div>
      <div className="panel-b stack">
        <p className="small muted" style={{ margin: 0 }}>
          Saisissez les trois notes sur 10 fournies par l’outil. Le profil se calcule en cascade :
          une dimension ne compte que si la précédente atteint {SEUIL}.
        </p>
        <div className="diag-champs">
          {DIMENSIONS.map(([id, label]) => (
            <label key={id} className="field">
              <span>{label} (sur 10)</span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={dims[id]}
                onChange={(e) => setDims({ ...dims, [id]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
        <div className="diag-champs">
          <label className="field">
            <span>Statut</span>
            <select
              value={statut ?? ''}
              onChange={(e) =>
                setStatut((e.target.value || null) as ProjetDiag['statutDiagnostic'])
              }
            >
              <option value="">À préciser</option>
              <option value="Rapport à rédiger">Rapport à rédiger</option>
              <option value="Restitué">Restitué</option>
            </select>
          </label>
          <label className="field">
            <span>Date de l’entretien</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {message && <div className="ok-note">{message}</div>}
        <div className="row">
          <button className="btn go" onClick={() => void enregistrer()}>
            Enregistrer le résultat
          </button>
        </div>
      </div>
    </div>
  );
}

function Analyse({
  slug,
  projet,
  onSauver,
}: {
  slug: string;
  projet: ProjetDiag;
  onSauver: Sauver;
}) {
  if (!projet.dims) {
    return (
      <div className="panel empty">
        Pas encore de résultat. Saisissez-le à l’étape 2 pour analyser le diagnostic.
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-h">
          <h2>Profil : {projet.profil}</h2>
          <span className="badge">{projet.statutDiagnostic ?? 'Statut à préciser'}</span>
        </div>
        <div className="panel-b stack">
          {DIMENSIONS.map(([id, label]) => {
            const note = projet.dims?.[id] ?? 0;
            return (
              <div key={id} className="row" style={{ gap: 12 }}>
                <span style={{ minWidth: 220 }}>{label}</span>
                <div
                  className="diag-barre"
                  style={{
                    width: `${note * 10}%`,
                    background: note >= SEUIL ? 'var(--teal)' : 'var(--ink-3)',
                  }}
                />
                <span className="mono">{note.toFixed(1)}</span>
              </div>
            );
          })}
          {projet.aRapport && (
            <a
              className="btn go"
              href={`/api/i/${encodeURIComponent(slug)}/diagnostic/projets/${projet.id}/rapport`}
            >
              Télécharger le rapport ({projet.rapportNom})
            </a>
          )}
        </div>
      </div>
      {projet.revue ? (
        <EditeurRevue revue={projet.revue} onChange={(revue) => void onSauver({ revue })} />
      ) : (
        <div className="panel empty">
          Pas encore de formulaire de revue. Il se saisit ici, comme dans l’artefact.
        </div>
      )}
    </div>
  );
}

// Un élément du formulaire de revue : une préconisation, une action du plan, ou un champ libre.
type Entree = {
  chemin: string[];
  champ: string;
  titre: string;
  valeur: string;
  propose?: string;
  choix?: string;
};
const HORIZONS: [string, string][] = [
  ['court', 'Court terme'],
  ['moyen', 'Moyen terme'],
  ['long', 'Long terme'],
];
const CHOIX: [string, string][] = [
  ['garder', 'Garder (avec vos ajouts)'],
  ['remplacer', 'Remplacer par mon texte'],
  ['retirer', 'Retirer'],
];
const CHAMPS_TEXTE: [string, string][] = [
  ['indicateurs', 'Indicateurs de pilotage'],
  ['nonFait', 'Ce que l’entreprise ne fera pas'],
  ['preconisationAutre', 'Préconisation à ajouter'],
];

const objet = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const texte = (v: unknown): string => (typeof v === 'string' ? v : '');

// Mise à jour immuable d'un champ du formulaire, à l'emplacement donné.
export function modifierRevue(
  revue: Record<string, unknown>,
  e: Pick<Entree, 'chemin' | 'champ'>,
  valeur: string,
): Record<string, unknown> {
  const copie = structuredClone(revue);
  let cible: Record<string, unknown> = copie;
  for (const cle of e.chemin) {
    const suivant = objet(cible[cle]);
    cible[cle] = suivant;
    cible = suivant;
  }
  cible[e.champ] = valeur;
  return copie;
}

export function entreesRevue(revue: Record<string, unknown>): Entree[] {
  const sorties: Entree[] = [];
  const avecChoix = (
    chemin: string[],
    titre: string,
    o: Record<string, unknown>,
    propose?: string,
  ) =>
    sorties.push({
      chemin,
      champ: 'detail',
      titre,
      valeur: texte(o.detail),
      propose: propose ?? (texte(o.texte) || undefined),
      choix: texte(o.choix) || undefined,
    });

  for (const [cle, v] of Object.entries(objet(revue.preconisations))) {
    const p = objet(v);
    avecChoix(['preconisations', cle], texte(p.titre) || `Préconisation ${cle}`, p);
  }
  for (const [horizon, libelle] of HORIZONS) {
    const h = objet(objet(revue.planAction)[horizon]);
    for (const [cle, v] of Object.entries(objet(h.blocs))) {
      const b = objet(v);
      avecChoix(['planAction', horizon, 'blocs', cle], `${libelle} · ${texte(b.bloc)}`, b);
    }
    sorties.push({
      chemin: ['planAction', horizon],
      champ: 'libre',
      titre: `${libelle} · commentaire libre`,
      valeur: texte(h.libre),
    });
  }
  const conclusion = objet(revue.conclusion);
  avecChoix(
    ['conclusion'],
    'Conclusion et prochaine étape',
    conclusion,
    texte(conclusion.proposition) || undefined,
  );
  for (const [champ, titre] of CHAMPS_TEXTE) {
    sorties.push({ chemin: [], champ, titre, valeur: texte(revue[champ]) });
  }
  return sorties;
}

// Le formulaire de revue de l'artefact, reproduit dans l'OS : choix et commentaire par entrée.
function EditeurRevue({
  revue,
  onChange,
}: {
  revue: Record<string, unknown>;
  onChange: (revue: Record<string, unknown>) => void;
}) {
  const entrees = entreesRevue(revue);
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Formulaire de revue</h2>
        <span className="badge amber">{texte(revue.statut) || 'brouillon'}</span>
      </div>
      <div className="panel-b stack">
        <p className="small muted" style={{ margin: 0 }}>
          Vos commentaires s’enregistrent à la sortie de chaque champ. Une proposition retirée
          n’alimente pas la bibliothèque.
        </p>
        {entrees.map((e) => (
          <EntreeRevue
            key={`${e.chemin.join('/')}/${e.champ}`}
            entree={e}
            onChange={(valeur, champ) =>
              onChange(modifierRevue(revue, { chemin: e.chemin, champ: champ ?? e.champ }, valeur))
            }
          />
        ))}
      </div>
    </div>
  );
}

function EntreeRevue({
  entree,
  onChange,
}: {
  entree: Entree;
  onChange: (valeur: string, champ?: string) => void;
}) {
  const [valeur, setValeur] = useState(entree.valeur);
  useEffect(() => setValeur(entree.valeur), [entree.valeur]);
  const libre = entree.champ !== 'detail';
  return (
    <div className="diag-entree">
      <div className="row1">
        <b>{entree.titre}</b>
        {entree.choix !== undefined && (
          <select
            aria-label={`Choix · ${entree.titre}`}
            value={entree.choix}
            onChange={(e) => onChange(e.target.value, 'choix')}
          >
            {CHOIX.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        )}
      </div>
      {entree.propose && <div className="diag-propose small muted">{entree.propose}</div>}
      <label className="field">
        <span>{libre ? 'Commentaire' : 'Votre commentaire'}</span>
        <textarea
          rows={3}
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          onBlur={() => valeur !== entree.valeur && onChange(valeur, entree.champ)}
        />
      </label>
    </div>
  );
}

function Pied({ projet, onSauver }: { projet: ProjetDiag; onSauver: Sauver }) {
  return (
    <div className="diag-pied">
      {projet.etape > 1 ? (
        <button className="btn" onClick={() => void onSauver({ etape: projet.etape - 1 })}>
          ← Étape précédente
        </button>
      ) : (
        <span />
      )}
      {projet.etape < 3 && (
        <button className="btn go" onClick={() => void onSauver({ etape: projet.etape + 1 })}>
          Étape suivante →
        </button>
      )}
    </div>
  );
}

// L'assistant de l'étape : conversation avec Claude (répondue par le runner de ce poste), modèle et lien.
function Assistant({
  slug,
  projet,
  onChange,
  onErreur,
}: {
  slug: string;
  projet: ProjetDiag;
  onChange: (p: ProjetDiag) => void;
  onErreur: (m: string) => void;
}) {
  const etape = projet.etape;
  const chat = { ...CHAT_DEFAUT[etape], ...projet.chats[String(etape)] } as ChatEtape;
  const [lien, setLien] = useState(chat.lien ?? '');
  const [erreurLien, setErreurLien] = useState<string | null>(null);
  const [texte, setTexte] = useState('');
  useEffect(() => setLien(chat.lien ?? ''), [chat.lien, etape]);

  const enAttente = projet.statutChat !== 'repos';
  const messages = projet.conversation.filter((m) => m.etape === etape);

  const majChat = async (patch: Partial<ChatEtape>) => {
    try {
      onChange(
        await majProjetDiag(slug, projet.id, {
          chats: { ...projet.chats, [String(etape)]: { ...chat, ...patch } },
        }),
      );
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };

  const envoyer = async () => {
    const message = texte.trim();
    if (!message) return;
    try {
      onChange(await envoyerMessageDiag(slug, projet.id, message));
      setTexte('');
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };

  const validerLien = () => {
    const v = lien.trim();
    if (v !== '' && !/^https:\/\/claude\.ai\//.test(v)) {
      setErreurLien('Le lien doit pointer vers claude.ai.');
      return;
    }
    setErreurLien(null);
    if (v !== (chat.lien ?? '')) void majChat({ lien: v });
  };

  return (
    <aside className="panel diag-chat" aria-label={`Assistant Claude, étape ${etape}`}>
      <div className="panel-h">
        <div>
          <h2>Assistant · {ETAPES[etape - 1]}</h2>
          <div className="small muted">Claude répond ici, par le runner de ce poste</div>
        </div>
        <Icon name="brain" />
      </div>
      <div className="panel-b stack">
        <div className="diag-cfg">
          <label>
            Modèle
            <select value={chat.modele} onChange={(e) => void majChat({ modele: e.target.value })}>
              {MODELES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Effort
            <select value={chat.effort} onChange={(e) => void majChat({ effort: e.target.value })}>
              {EFFORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="diag-log" aria-live="polite">
          {messages.length === 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              Posez une question sur cette étape. Claude voit le contexte, le résultat et le
              formulaire de revue.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`diag-msg ${m.de}${m.erreur ? ' erreur' : ''}`}>
              <small>
                {m.de === 'pilote' ? 'Vous' : 'Claude'} · {new Date(m.at).toLocaleString('fr-FR')}
              </small>
              <p>{m.texte}</p>
            </div>
          ))}
        </div>
        {enAttente && (
          <div className="small muted">
            Claude prépare sa réponse. Elle arrive ici dès que le runner de ce poste l’a traitée.
          </div>
        )}
        <div className="diag-saisie">
          <textarea
            rows={2}
            value={texte}
            disabled={enAttente}
            placeholder="Votre message"
            onChange={(e) => setTexte(e.target.value)}
          />
          <button
            className="btn go"
            disabled={enAttente || !texte.trim()}
            onClick={() => void envoyer()}
          >
            Envoyer
          </button>
        </div>
        <label className="field">
          <span>Lien du chat claude.ai (facultatif)</span>
          <input
            value={lien}
            placeholder="https://claude.ai/chat/…"
            onChange={(e) => setLien(e.target.value)}
            onBlur={validerLien}
          />
        </label>
        {erreurLien && <div className="alert amber">{erreurLien}</div>}
      </div>
    </aside>
  );
}
