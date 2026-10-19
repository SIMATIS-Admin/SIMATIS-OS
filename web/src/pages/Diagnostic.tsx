import { useEffect, useState, type FormEvent } from 'react';
import {
  creerProjetDiag,
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
          {projet.etape === 3 && <Analyse projet={projet} onSauver={sauver} />}
          <Pied projet={projet} onSauver={sauver} />
        </div>
        <Assistant projet={projet} onSauver={sauver} />
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

function Analyse({ projet }: { projet: ProjetDiag; onSauver: Sauver }) {
  if (!projet.dims) {
    return (
      <div className="panel empty">
        Pas encore de résultat. Saisissez-le à l’étape 2 pour analyser le diagnostic.
      </div>
    );
  }
  return (
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
        <div className="small muted">
          Le rapport sera produit à partir du formulaire de revue. Cette étape n’est pas encore dans
          l’OS.
        </div>
      </div>
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

// Le chat de l'étape vit sur claude.ai : l'OS garde le lien, le modèle et l'effort choisis.
function Assistant({ projet, onSauver }: { projet: ProjetDiag; onSauver: Sauver }) {
  const etape = projet.etape;
  const chat = { ...CHAT_DEFAUT[etape], ...projet.chats[String(etape)] } as ChatEtape;
  const [lien, setLien] = useState(chat.lien ?? '');
  const [erreurLien, setErreurLien] = useState<string | null>(null);
  useEffect(() => setLien(chat.lien ?? ''), [chat.lien, etape]);

  const enregistrer = (patch: Partial<ChatEtape>) =>
    void onSauver({ chats: { ...projet.chats, [String(etape)]: { ...chat, ...patch } } });

  const validerLien = () => {
    const v = lien.trim();
    if (v !== '' && !/^https:\/\/claude\.ai\//.test(v)) {
      setErreurLien('Le lien doit pointer vers claude.ai.');
      return;
    }
    setErreurLien(null);
    if (v !== (chat.lien ?? '')) void enregistrer({ lien: v });
  };

  return (
    <aside className="panel diag-chat" aria-label={`Assistant Claude, étape ${etape}`}>
      <div className="panel-h">
        <div>
          <h2>Assistant · {ETAPES[etape - 1]}</h2>
          <div className="small muted">La conversation se tient sur claude.ai</div>
        </div>
        <Icon name="brain" />
      </div>
      <div className="panel-b stack">
        <div className="diag-cfg">
          <label>
            Modèle
            <select
              value={chat.modele}
              onChange={(e) => void enregistrer({ modele: e.target.value })}
            >
              {MODELES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Effort
            <select
              value={chat.effort}
              onChange={(e) => void enregistrer({ effort: e.target.value })}
            >
              {EFFORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Lien du chat claude.ai</span>
          <input
            value={lien}
            placeholder="https://claude.ai/chat/…"
            onChange={(e) => setLien(e.target.value)}
            onBlur={validerLien}
          />
        </label>
        {erreurLien && <div className="alert amber">{erreurLien}</div>}
        {chat.lien ? (
          <a className="btn go" href={chat.lien} target="_blank" rel="noopener noreferrer">
            Ouvrir le chat
          </a>
        ) : (
          <div className="small muted">
            Ouvrez un chat sur claude.ai avec le modèle et l’effort ci-dessus, puis collez son lien
            ici pour le retrouver.
          </div>
        )}
      </div>
    </aside>
  );
}
