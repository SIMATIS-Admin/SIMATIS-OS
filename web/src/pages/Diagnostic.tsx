import { useEffect, useState, type FormEvent } from 'react';
import {
  creerProjetDiag,
  demandeRapportDiag,
  viderConversationDiag,
  importerEntretienDiag,
  demandeSupportDiag,
  envoyerMessageDiag,
  fetchProjetsDiag,
  majProjetDiag,
  urlLogoDiag,
  type ChatEtape,
  type Dimensions,
  type ProjetDiag,
  type ProjetDiagPatch,
} from '../api.js';
import { Icon } from '../icons.js';
import { etapeEnCours, etatsEtapes } from './etapes.js';

// Libellés des activités et des modèles : les valeurs sont celles que le serveur accepte.
export const ACTIVITES = [
  ['usinage', 'Usinage et chaudronnerie'],
  ['services', 'Conseil et services aux PME'],
  ['batiment', 'Artisanat et bâtiment'],
  ['autre', 'Autre activité'],
] as const;
export const ETAPES = [
  'Préparer la présentation',
  'Entretien et résultat de l’outil',
  'Revue des préconisations',
  'Rapport',
  'Restitution et capitalisation',
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
// Préparation, entretien et restitution en Sonnet effort moyen ; revue et rapport en Opus
// effort max. Le lien vide
// est requis par le serveur : sans lui, changer le modèle d'une étape neuve était refusé.
const CHAT_DEFAUT: Record<number, ChatEtape> = {
  1: { modele: 'sonnet', effort: 'moyen', lien: '' },
  2: { modele: 'sonnet', effort: 'moyen', lien: '' },
  3: { modele: 'opus', effort: 'max', lien: '' },
  4: { modele: 'opus', effort: 'max', lien: '' },
  5: { modele: 'sonnet', effort: 'moyen', lien: '' },
};
const DIMENSIONS: [keyof Dimensions, string][] = [
  ['outils', 'Outils et méthode'],
  ['strategie', 'Stratégie, régularité, endurance'],
  ['polyvalence', 'Polyvalence'],
];
const SEUIL = 6;
const STATUTS_SUPPORT: Record<ProjetDiag['supportStatut'], string> = {
  aucun: 'Pas encore préparé',
  preparation: 'Claude prépare le deck…',
  pret: 'Deck prêt, à corriger si besoin',
  final: 'Support final archivé',
};

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

  if (!projets) {
    return erreur ? (
      <div className="alert amber">{erreur}</div>
    ) : (
      <div className="panel empty">Chargement…</div>
    );
  }
  // Une action refusée s'affiche au-dessus de la page, sans la remplacer.
  const alerte = erreur && (
    <div className="alert amber diag-alerte" role="alert">
      <span>{erreur}</span>
      <button className="btn" onClick={() => setErreur(null)}>
        Fermer
      </button>
    </div>
  );
  if (projet) {
    return (
      <div className="stack">
        {alerte}
        <ProjetVue
          key={projet.id}
          slug={slug}
          projet={projet}
          onChange={remplacer}
          onRetour={() => setOuvert(null)}
          onErreur={setErreur}
        />
      </div>
    );
  }
  return (
    <div className="stack">
      {alerte}
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
    </div>
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
        <div className="diag-projets">
          {projets.map((p) => (
            <button key={p.id} className="panel diag-projet" onClick={() => onOuvrir(p.id)}>
              <div className="row1">
                <b>{p.nom}</b>
                <span className="badge">
                  Étape {p.etapeMax} · {ETAPES[p.etapeMax - 1]}
                </span>
              </div>
              <small>
                {libelle(ACTIVITES, p.activite)}, modifié le{' '}
                {new Date(p.updatedAt).toLocaleDateString('fr-FR')}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Écran d'un projet : réutilisé par la section Diagnostics (une ligne ouverte mène ici).
export function ProjetVue({
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
    if (
      projet.statutChat === 'repos' &&
      projet.supportStatut !== 'preparation' &&
      projet.rapportLienStatut !== 'en_cours'
    )
      return;
    const minuteur = setInterval(() => {
      fetchProjetsDiag(slug)
        .then((liste) => {
          const maj = liste.find((p) => p.id === projet.id);
          if (maj) onChange(maj);
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(minuteur);
  }, [
    slug,
    projet.id,
    projet.statutChat,
    projet.supportStatut,
    projet.rapportLienStatut,
    onChange,
  ]);

  const etats = etatsEtapes(projet);
  const encours = etapeEnCours(etats);
  const etatAffiche = etats[projet.etape - 1];

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
                  className={`diag-etape ${projet.etape === i + 1 ? 'on' : ''} ${etats[i]?.ok ? 'fait' : ''} ${encours === i + 1 ? 'encours' : ''}`}
                  aria-current={projet.etape === i + 1 ? 'step' : undefined}
                  onClick={() => void sauver({ etape: i + 1 })}
                >
                  <span className="diag-num">{i + 1}</span>
                  {titre}
                  {etats[i]?.ok && (
                    <span className="diag-ok" aria-hidden="true">
                      ✓
                    </span>
                  )}
                  {encours === i + 1 && <span className="diag-tag">En cours</span>}
                </button>
              </li>
            ))}
          </ol>
          <p className="small muted" style={{ margin: 0 }}>
            {encours
              ? `Étape en cours : ${encours}, ${ETAPES[encours - 1]}.`
              : 'Toutes les étapes sont OK.'}
          </p>
        </div>
      </div>
      <div className="diag-layout">
        <div className="diag-main">
          {etatAffiche && (
            <p className={`diag-statut ${etatAffiche.ok ? 'ok' : 'attente'}`} role="status">
              Étape {projet.etape} : {etatAffiche.ok ? 'OK' : 'à faire'} · {etatAffiche.libelle}
            </p>
          )}
          {projet.etape === 1 && <Preparation projet={projet} onSauver={sauver} />}
          {projet.etape === 1 && (
            <Support
              slug={slug}
              projet={projet}
              onSauver={sauver}
              onChange={onChange}
              onErreur={onErreur}
            />
          )}
          {projet.etape === 2 && (
            <Resultat
              slug={slug}
              projet={projet}
              onSauver={sauver}
              onChange={onChange}
              onErreur={onErreur}
            />
          )}
          {projet.etape === 3 && <Revue projet={projet} onSauver={sauver} />}
          {projet.etape === 4 && (
            <Rapport slug={slug} projet={projet} onChange={onChange} onErreur={onErreur} />
          )}
          {projet.etape === 5 && <Restitution projet={projet} onSauver={sauver} />}
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
          <span>Contexte de l’entreprise</span>
          <textarea
            rows={5}
            value={contexte}
            placeholder="Activité, clients, marché, ce que vous savez de l’entreprise"
            onChange={(e) => setContexte(e.target.value)}
            onBlur={() => contexte !== projet.contexte && void onSauver({ contexte })}
          />
        </label>
      </div>
    </div>
  );
}

const lireBase64 = (fichier: File) =>
  new Promise<string>((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () =>
      resolve(typeof lecteur.result === 'string' ? (lecteur.result.split(',')[1] ?? '') : '');
    lecteur.onerror = () => reject(new Error('Logo illisible'));
    lecteur.readAsDataURL(fichier);
  });

// Support d'ouverture : formulaire lu par Claude, puis le deck du projet sur claude.ai.
function Support({
  slug,
  projet,
  onSauver,
  onChange,
  onErreur,
}: {
  slug: string;
  projet: ProjetDiag;
  onSauver: Sauver;
  onChange: (p: ProjetDiag) => void;
  onErreur: (m: string) => void;
}) {
  const [date, setDate] = useState(projet.dateDiagnostic ?? '');
  const [dit, setDit] = useState(projet.ditParDirigeant);
  const [hypotheses, setHypotheses] = useState(projet.hypotheses);
  useEffect(() => setDate(projet.dateDiagnostic ?? ''), [projet.dateDiagnostic]);
  useEffect(() => setDit(projet.ditParDirigeant), [projet.ditParDirigeant]);
  useEffect(() => setHypotheses(projet.hypotheses), [projet.hypotheses]);

  const statut = projet.supportStatut;
  const occupe = projet.statutChat !== 'repos' || statut === 'preparation';
  const demander = async (action: 'preparer' | 'final' | 'rouvrir') => {
    try {
      onChange(await demandeSupportDiag(slug, projet.id, action));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };
  const deposerLogo = async (fichier: File | undefined) => {
    if (!fichier) return;
    if (fichier.size > 500_000) return onErreur('Logo trop lourd (500 Ko au plus).');
    try {
      await onSauver({ logo: { nom: fichier.name, base64: await lireBase64(fichier) } });
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };

  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Support d’ouverture</h2>
        <span className="small muted">{STATUTS_SUPPORT[statut]}</span>
      </div>
      <div className="panel-b stack">
        <label className="field">
          <span>Date du diagnostic</span>
          <input
            type="date"
            value={date}
            disabled={statut === 'final'}
            onChange={(e) => setDate(e.target.value)}
            onBlur={() =>
              date !== (projet.dateDiagnostic ?? '') &&
              void onSauver({ dateDiagnostic: date || null })
            }
          />
        </label>
        <label className="field">
          <span>Ce que le dirigeant vous a dit</span>
          <textarea
            rows={4}
            value={dit}
            disabled={statut === 'final'}
            placeholder="Ses mots : ambition, enjeu, ce qui bloque. Repris dans « Ce que vous nous avez indiqué »."
            onChange={(e) => setDit(e.target.value)}
            onBlur={() => dit !== projet.ditParDirigeant && void onSauver({ ditParDirigeant: dit })}
          />
        </label>
        <label className="field">
          <span>Vos hypothèses, à confirmer en entretien</span>
          <textarea
            rows={3}
            value={hypotheses}
            disabled={statut === 'final'}
            placeholder="Votre lecture, jamais confirmée par le dirigeant"
            onChange={(e) => setHypotheses(e.target.value)}
            onBlur={() => hypotheses !== projet.hypotheses && void onSauver({ hypotheses })}
          />
        </label>
        <div className="field">
          <span>Logo de l’entreprise (PNG, JPEG ou WebP, 500 Ko au plus)</span>
          {projet.aLogo && (
            <div className="diag-logo">
              <img
                src={`${urlLogoDiag(slug, projet.id)}?v=${encodeURIComponent(projet.updatedAt)}`}
                alt={`Logo de ${projet.nom}`}
              />
              {statut !== 'final' && (
                <button className="btn" onClick={() => void onSauver({ logo: null })}>
                  Retirer le logo
                </button>
              )}
            </div>
          )}
          {statut !== 'final' && (
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Déposer le logo"
              onChange={(e) => void deposerLogo(e.target.files?.[0])}
            />
          )}
        </div>

        {statut === 'preparation' && (
          <div className="alert">
            Claude prépare le support : recherche du marché, copie du modèle, adaptation. Comptez
            quelques minutes. Sa réponse arrivera dans l’assistant.
          </div>
        )}
        <div className="diag-actions">
          {projet.supportLien && (
            <a className="btn" href={projet.supportLien} target="_blank" rel="noreferrer">
              Ouvrir le deck ↗
            </a>
          )}
          {(statut === 'aucun' || statut === 'pret') && (
            <button className="btn go" disabled={occupe} onClick={() => void demander('preparer')}>
              {statut === 'aucun' ? 'Préparer le support' : 'Mettre à jour le deck'}
            </button>
          )}
          {statut === 'pret' && (
            <button className="btn" disabled={occupe} onClick={() => void demander('final')}>
              Support final
            </button>
          )}
          {statut === 'final' && (
            <button className="btn" disabled={occupe} onClick={() => void demander('rouvrir')}>
              Modifier le support
            </button>
          )}
        </div>
        {statut === 'pret' && (
          <div className="small muted">
            Corrigez le deck directement sur claude.ai, ou demandez à Claude dans l’assistant.
            Cliquez « Support final » une fois l’entretien passé : Claude relit le deck et
            l’archive.
          </div>
        )}
        {statut === 'final' && projet.supportTexte && (
          <div className="stack">
            <div className="small muted">
              Archivé le{' '}
              {projet.supportFinalLe
                ? new Date(projet.supportFinalLe).toLocaleDateString('fr-FR')
                : '—'}{' '}
              : texte affiché et notes d’orateur.
            </div>
            {projet.supportTexte.map((d, i) => (
              <details key={i} className="diag-diapo">
                <summary>
                  {i + 1}. {d.titre}
                </summary>
                <p className="diag-texte">{d.texte}</p>
                {d.notes && (
                  <>
                    <div className="small muted">Notes d’orateur</div>
                    <p className="diag-texte">{d.notes}</p>
                  </>
                )}
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const PDF_MAX_OCTETS = 10 * 1024 * 1024;

function Resultat({
  slug,
  projet,
  onSauver,
  onChange,
  onErreur,
}: {
  slug: string;
  projet: ProjetDiag;
  onSauver: Sauver;
  onChange: (p: ProjetDiag) => void;
  onErreur: (m: string) => void;
}) {
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

  const importer = async (fichier: File | undefined) => {
    if (!fichier) return;
    if (fichier.size > PDF_MAX_OCTETS) return onErreur('PDF trop lourd (10 Mo au plus).');
    try {
      const base64 = await lireBase64(fichier);
      onChange(await importerEntretienDiag(slug, projet.id, { nom: fichier.name, base64 }));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };

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
        <div className="stack">
          <label className="small">
            Importer le PDF de l’outil (10 Mo au plus) :{' '}
            <input
              type="file"
              accept="application/pdf"
              aria-label="Importer le PDF de l'outil"
              onChange={(e) => void importer(e.target.files?.[0])}
            />
          </label>
          {projet.pdfEntretienNom && (
            <p className="small muted" style={{ margin: 0 }}>
              PDF importé : {projet.pdfEntretienNom}
            </p>
          )}
          {projet.demande === 'entretien' && (
            <p className="small muted" style={{ margin: 0 }}>
              Claude lit le PDF… Les réponses apparaîtront ici.
            </p>
          )}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Saisie manuelle (secours) : saisissez les trois notes sur 10 fournies par l’outil. Le
          profil se calcule en cascade : une dimension ne compte que si la précédente atteint{' '}
          {SEUIL}.
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

function Revue({ projet, onSauver }: { projet: ProjetDiag; onSauver: Sauver }) {
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
        </div>
      </div>
      {projet.revue ? (
        <>
          <div className="row">
            <button
              className="btn go"
              disabled={projet.revue.statut === 'validée'}
              onClick={() => void onSauver({ revue: { ...projet.revue, statut: 'validée' } })}
            >
              Valider la revue
            </button>
          </div>
          <EditeurRevue revue={projet.revue} onChange={(revue) => void onSauver({ revue })} />
        </>
      ) : (
        <div className="panel empty">
          Pas encore de formulaire de revue. Il se saisit ici, comme dans l’artefact.
        </div>
      )}
    </div>
  );
}

// Pré-requis du rapport, repris de l'OS (le serveur reste l'autorité et refuse sinon) : le résultat de
// l'étape 2 suffit, la revue de l'étape 3 enrichit le rapport quand elle existe.
const raisonRapport = (projet: ProjetDiag) =>
  projet.dims ? null : "Saisissez d'abord le résultat à l'étape 2.";

function Rapport({
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
  const enCours = projet.rapportLienStatut === 'en_cours';
  const raison = raisonRapport(projet);
  const demander = async () => {
    if (
      projet.aRapport &&
      !window.confirm(
        'Le nouveau rapport remplace le précédent. Si vous l’avez modifié, téléchargez-le d’abord. Continuer ?',
      )
    )
      return;
    try {
      onChange(await demandeRapportDiag(slug, projet.id));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };
  const precedents = projet.rapportLiens.slice(1);
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Rapport remis au dirigeant</h2>
        {projet.profil && <span className="badge green">Profil : {projet.profil}</span>}
      </div>
      <div className="panel-b stack">
        {projet.aRapport && (
          <div className="row">
            <a
              className="btn"
              href={`/api/i/${encodeURIComponent(slug)}/diagnostic/projets/${projet.id}/rapport`}
            >
              Télécharger le rapport ({projet.rapportNom})
            </a>
          </div>
        )}
        {projet.aRapport && !enCours && (
          <p className="small muted" style={{ margin: 0 }}>
            Le rapport est enregistré ici. Téléchargez-le pour le relire ou le modifier dans Word.
          </p>
        )}
        {enCours ? (
          <p className="small muted" style={{ margin: 0 }}>
            Claude rédige le rapport… La page se mettra à jour dès qu’il sera prêt.
          </p>
        ) : (
          projet.rapportLien && (
            <div className="row">
              <a className="btn go" href={projet.rapportLien} target="_blank" rel="noreferrer">
                Ouvrir le rapport
              </a>
            </div>
          )
        )}
        <div className="row">
          <button
            className="btn"
            disabled={enCours || raison !== null}
            onClick={() => void demander()}
          >
            {projet.aRapport || projet.rapportLien
              ? 'Produire un nouveau rapport'
              : 'Produire le rapport'}
          </button>
        </div>
        {!enCours && raison && (
          <p className="small muted" style={{ margin: 0 }}>
            {raison}
          </p>
        )}
        {precedents.length > 0 && (
          <details>
            <summary className="small">Rapports précédents ({precedents.length})</summary>
            <ul className="small">
              {precedents.map((r) => (
                <li key={r.lien}>
                  <a href={r.lien} target="_blank" rel="noreferrer">
                    Rapport du {new Date(r.le).toLocaleDateString('fr-FR')}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function Restitution({ projet, onSauver }: { projet: ProjetDiag; onSauver: Sauver }) {
  const restitue = projet.statutDiagnostic === 'Restitué';
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Restitution et capitalisation</h2>
        <span className={`badge ${restitue ? 'green' : ''}`}>
          {projet.statutDiagnostic ?? 'Statut à préciser'}
        </span>
      </div>
      <div className="panel-b stack">
        <p className="small muted" style={{ margin: 0 }}>
          Une fois le rapport présenté au dirigeant, marquez le diagnostic comme restitué. Les
          préconisations validées alimenteront ensuite la bibliothèque.
        </p>
        <div className="row">
          {restitue ? (
            <button
              className="btn"
              onClick={() => void onSauver({ statutDiagnostic: 'Rapport à rédiger' })}
            >
              Annuler la restitution
            </button>
          ) : (
            <button
              className="btn go"
              onClick={() => void onSauver({ statutDiagnostic: 'Restitué' })}
            >
              Marquer comme restitué
            </button>
          )}
        </div>
      </div>
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
  // Une revue modifiée après validation n'est plus validée : il faut la valider à nouveau.
  if (copie.statut === 'validée') copie.statut = 'brouillon';
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
      {projet.etape < ETAPES.length && (
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
  const chat: ChatEtape = { ...CHAT_DEFAUT[etape]!, ...projet.chats[String(etape)] };
  const [lien, setLien] = useState(chat.lien ?? '');
  const [erreurLien, setErreurLien] = useState<string | null>(null);
  const [texte, setTexte] = useState('');
  useEffect(() => setLien(chat.lien ?? ''), [chat.lien, etape]);

  const enAttente = projet.statutChat !== 'repos';
  const messages = projet.conversation.filter((m) => m.etape === etape);

  // Efface seulement les messages de cette étape ; le projet, son résultat et sa revue restent.
  const vider = async () => {
    if (!window.confirm('Vider la conversation de cette étape ? Les messages seront effacés.'))
      return;
    try {
      onChange(await viderConversationDiag(slug, projet.id, etape));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };

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
        <button
          className="btn"
          disabled={enAttente || messages.length === 0}
          onClick={() => void vider()}
        >
          Vider la conversation
        </button>
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
          {enAttente && (
            <div className="diag-msg claude attente" role="status" aria-live="polite">
              <small>Claude · en cours</small>
              <p>
                <span className="diag-pulse">●</span>{' '}
                {projet.statutChat === 'en_cours'
                  ? 'Claude répond à votre message…'
                  : 'Message reçu. En attente du runner de ce poste, qui le traitera.'}
              </p>
            </div>
          )}
        </div>
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
            {enAttente ? 'En cours…' : 'Envoyer'}
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
