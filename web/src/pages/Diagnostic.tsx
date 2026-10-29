import { useEffect, useState, type FormEvent } from 'react';
import {
  creerProjetDiag,
  demandeRapportDiag,
  demandeRestitutionDiag,
  exporterRestitutionDiag,
  urlPptxRestitutionDiag,
  viderConversationDiag,
  importerEntretienDiag,
  envoyerRapportDriveDiag,
  importerRapportDiag,
  demandeSupportDiag,
  envoyerMessageDiag,
  fetchProjetsDiag,
  majProjetDiag,
  urlLogoDiag,
  urlExportRapportDiag,
  urlRapportDiag,
  type ChatEtape,
  type Dimensions,
  type Proposition,
  type ProjetDiag,
  type ProjetDiagPatch,
} from '../api.js';
import { Icon } from '../icons.js';
import { etapeEnCours, etatsEtapes } from './etapes.js';
import { ChoixFiche } from './liens/ChoixFiche.js';

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
// Aux étapes 4 et 5, le chat sert à donner ses modifications avant de lancer une production.
const CHAT_TITRE: Record<number, string> = {
  4: 'Modifications du rapport',
  5: 'Proposition de collaboration',
};
const CHAT_AIDE: Record<number, string> = {
  4: 'Plusieurs messages possibles avant de produire la nouvelle version du rapport',
  5: 'Plusieurs messages possibles avant de produire le deck de restitution',
};
const CHAT_VIDE: Record<number, string> = {
  4: 'Donnez ici les modifications à intégrer au rapport. Claude les note et vous répond, sans produire le rapport : la production se lance avec le bouton, avec le modèle et l’effort choisis ci-dessous.',
  5: 'Donnez ici vos tarifs et votre mode de fonctionnement pour la dernière diapositive. Claude les note, sans créer le deck : la production se lance avec le bouton « Produire le deck de restitution ».',
};
const DIMENSIONS: [keyof Dimensions, string][] = [
  ['outils', 'Outils et méthode'],
  ['strategie', 'Stratégie, régularité, endurance'],
  ['polyvalence', 'Polyvalence'],
];
const SEUIL = 6;
// Places du chat : moitié-moitié quand la conversation est l'outil de l'étape (1, 2 et 5), sous le
// rapport à l'étape 4, étroit à la revue (3) où le formulaire prime.
const MISE_EN_PAGE: Record<number, string> = { 1: 'moitie', 2: 'moitie', 4: 'empile', 5: 'moitie' };
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
  const [entrepriseId, setEntrepriseId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [manque, setManque] = useState<string | null>(null);

  const creer = async (e: FormEvent) => {
    e.preventDefault();
    if (!nom.trim()) return setManque('Donnez un nom à l’entreprise.');
    try {
      onCree(
        await creerProjetDiag(
          slug,
          nom,
          activite,
          entrepriseId ?? undefined,
          contactId ?? undefined,
        ),
      );
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
            <ChoixFiche
              slug={slug}
              kind="entreprise"
              label="Organisation"
              id={entrepriseId}
              onChange={(id, n) => {
                setEntrepriseId(id);
                if (n && !nom.trim()) setNom(n);
              }}
            />
            <ChoixFiche
              slug={slug}
              kind="contact"
              label="Contact"
              id={contactId}
              entrepriseId={entrepriseId}
              onChange={setContactId}
            />
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
      projet.rapportLienStatut !== 'en_cours' &&
      projet.restitutionStatut !== 'en_cours'
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
    projet.restitutionStatut,
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
      <div className="panel diag-tete">
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
      <div className={`diag-layout ${MISE_EN_PAGE[projet.etape] ?? ''}`}>
        <div className="diag-main">
          {etatAffiche && (
            <p className={`diag-statut ${etatAffiche.ok ? 'ok' : 'attente'}`} role="status">
              Étape {projet.etape} : {etatAffiche.ok ? 'OK' : 'à faire'} · {etatAffiche.libelle}
            </p>
          )}
          {projet.etape === 1 && <Preparation slug={slug} projet={projet} onSauver={sauver} />}
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
          {/* Étape 4 : la conversation modifie l'historique du rapport, elle se lit sous lui. */}
          {projet.etape === 4 && (
            <Assistant slug={slug} projet={projet} onChange={onChange} onErreur={onErreur} />
          )}
          {projet.etape === 5 && (
            <RestitutionDeck
              slug={slug}
              projet={projet}
              onSauver={sauver}
              onChange={onChange}
              onErreur={onErreur}
            />
          )}
          {projet.etape === 5 && <Restitution projet={projet} onSauver={sauver} />}
          <Pied projet={projet} onSauver={sauver} />
        </div>
        {projet.etape !== 4 && (
          <Assistant slug={slug} projet={projet} onChange={onChange} onErreur={onErreur} />
        )}
      </div>
    </div>
  );
}

type Sauver = (patch: ProjetDiagPatch) => Promise<void>;

function Preparation({
  slug,
  projet,
  onSauver,
}: {
  slug: string;
  projet: ProjetDiag;
  onSauver: Sauver;
}) {
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
        <ChoixFiche
          slug={slug}
          kind="entreprise"
          label="Organisation"
          id={projet.entrepriseId ?? null}
          onChange={(id) => void onSauver({ entrepriseId: id })}
        />
        <ChoixFiche
          slug={slug}
          kind="contact"
          label="Contact"
          id={projet.contactId ?? null}
          entrepriseId={projet.entrepriseId}
          onChange={(id) => void onSauver({ contactId: id })}
        />
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
        {statut === 'final' && (
          <div className="small muted">
            Archivé le{' '}
            {projet.supportFinalLe
              ? new Date(projet.supportFinalLe).toLocaleDateString('fr-FR')
              : '—'}
            .
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
  const [date, setDate] = useState(projet.dateDiagnostic ?? '');
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setDate(projet.dateDiagnostic ?? ''), [projet.dateDiagnostic]);

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

  // Enregistrer vaut « l'entretien est fait et ses résultats sont calculés » : le statut passe à
  // « Rapport à rédiger » (sauf s'il est déjà « Restitué »), les notes viennent du PDF.
  const enregistrer = async () => {
    setMessage(null);
    await onSauver({
      statutDiagnostic: projet.statutDiagnostic ?? 'Rapport à rédiger',
      dateDiagnostic: date || null,
    });
    setMessage('Résultat enregistré. Vous pouvez passer à la revue des préconisations.');
  };

  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Résultat de l’outil externe</h2>
        {projet.profil && <span className="badge green">Profil : {projet.profil}</span>}
      </div>
      <div className="panel-b stack">
        <label className="diag-depot">
          <span>Importer le PDF de l’outil (10 Mo au plus)</span>
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
        {projet.dims ? (
          <div className="diag-notes" aria-label="Notes calculées">
            {DIMENSIONS.map(([id, label]) => (
              <div key={id} className={`diag-note ${projet.dims![id] >= SEUIL ? 'haute' : ''}`}>
                <span className="small muted">{label}</span>
                <b>{projet.dims![id].toFixed(1)} / 10</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Les notes et le profil se calculent à partir du PDF : rien à saisir à la main.
          </p>
        )}
        <label className="field diag-date">
          <span>Date de l’entretien</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {message && <div className="ok-note">{message}</div>}
        <div className="diag-actions">
          <button className="btn go" disabled={!projet.dims} onClick={() => void enregistrer()}>
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
const WORD_MAX_OCTETS = 10 * 1024 * 1024;
const versionDuNom = (nom: string | null) => {
  const lu = nom ? /(?<![A-Za-z0-9])v(\d{1,3})(?:\s*\(\d+\))?\.docx$/i.exec(nom.trim()) : null;
  return lu ? Number(lu[1]) : 1;
};
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
  // Le numéro se lit dans le nom du Word (« … - v3.docx ») ; sans numéro, un Word importé est la v1.
  const prochaine =
    Math.max(
      projet.rapportVersions.at(-1)?.version ?? 0,
      projet.aRapport ? versionDuNom(projet.rapportNom) : 0,
    ) + 1;
  const importer = async (fichier: File | undefined) => {
    if (!fichier) return;
    if (fichier.size > WORD_MAX_OCTETS) return onErreur('Word trop lourd (10 Mo au plus).');
    if (
      projet.aRapport &&
      !window.confirm(
        'Votre version remplace le Word affiché. Les versions rédigées par Claude restent téléchargeables. Continuer ?',
      )
    )
      return;
    try {
      const base64 = await lireBase64(fichier);
      onChange(await importerRapportDiag(slug, projet.id, { nom: fichier.name, base64 }));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };
  const envoyerSurDrive = async () => {
    try {
      onChange(await envoyerRapportDriveDiag(slug, projet.id));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };
  const demander = async () => {
    if (
      projet.aRapport &&
      !window.confirm(
        'Une nouvelle version du rapport va être produite à partir de vos modifications dans le chat. Les versions précédentes restent téléchargeables. Continuer ?',
      )
    )
      return;
    try {
      onChange(await demandeRapportDiag(slug, projet.id));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };
  const docGoogle = /docs\.google\.com\/document\//.test(projet.rapportLien ?? '');
  const precedents = projet.rapportLiens.slice(1);
  const versionsPrecedentes = projet.rapportVersions.slice(0, -1).reverse();
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Rapport remis au dirigeant</h2>
        {projet.profil && <span className="badge green">Profil : {projet.profil}</span>}
      </div>
      <div className="panel-b stack">
        {projet.aRapport && (
          <div className="diag-fichier">
            <span className="small muted">
              {docGoogle ? 'Copie Word de l’OS (version produite)' : 'Rapport enregistré'}
            </span>
            <a href={urlRapportDiag(slug, projet.id)}>{projet.rapportNom}</a>
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Le rapport est enregistré ici, version par version. Discutez des modifications avec Claude
          dans la conversation ci-dessous, puis produisez la nouvelle version. Si vous avez
          retravaillé le Word de votre côté, importez-le : il remplace le Word affiché, et la
          production suivante part de son numéro.
        </p>
        {enCours && (
          <p className="small muted" style={{ margin: 0 }}>
            Claude rédige le rapport… La page se mettra à jour dès qu’il sera prêt.
          </p>
        )}
        <div className="diag-actions">
          {!enCours && projet.rapportLien && (
            <a className="btn go" href={projet.rapportLien} target="_blank" rel="noreferrer">
              {docGoogle ? 'Ouvrir dans Google Docs' : 'Ouvrir le rapport'}
            </a>
          )}
          {!enCours && docGoogle && (
            <a className="btn" href={urlExportRapportDiag(slug, projet.id)}>
              Exporter en .docx
            </a>
          )}
          {!enCours && projet.aRapport && !docGoogle && (
            <button className="btn" onClick={() => void envoyerSurDrive()}>
              Envoyer sur Drive
            </button>
          )}
          <button
            className="btn go"
            disabled={enCours || raison !== null}
            onClick={() => void demander()}
          >
            {projet.aRapport || projet.rapportLien
              ? `Produire la version ${prochaine}`
              : 'Produire le rapport'}
          </button>
          <label className={`btn ${enCours ? 'off' : ''}`}>
            Importer ma version (.docx)
            <input
              type="file"
              hidden
              disabled={enCours}
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              aria-label="Importer ma version du rapport"
              onChange={(e) => {
                void importer(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {!enCours && raison && (
          <p className="small muted" style={{ margin: 0 }}>
            {raison}
          </p>
        )}
        {versionsPrecedentes.length > 0 && (
          <details>
            <summary className="small">Versions précédentes ({versionsPrecedentes.length})</summary>
            <ul className="small">
              {versionsPrecedentes.map((v) => (
                <li key={v.version}>
                  <a href={urlRapportDiag(slug, projet.id, v.version)}>
                    Version {v.version}, du {new Date(v.le).toLocaleDateString('fr-FR')}
                  </a>
                </li>
              ))}
            </ul>
          </details>
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

type OptionForm = {
  id: string;
  libelle: string;
  description: string;
  mode: 'forfait' | 'mensuel';
  montant: string;
};

const montantDe = (v: string) => {
  const n = Number(v.trim().replace(',', '.'));
  return v.trim() === '' || Number.isNaN(n) ? null : n;
};

// Formule d'abonnement et options de la proposition : saisies ici, elles alimentent le deck (et le
// devis). Un montant laissé vide s'affiche « sur devis » : l'OS ne propose jamais de prix.
function PropositionForm({
  proposition,
  onSauver,
}: {
  proposition: Proposition | null;
  onSauver: Sauver;
}) {
  const [libelle, setLibelle] = useState('');
  const [mensualite, setMensualite] = useState('');
  const [engagement, setEngagement] = useState('12');
  const [tacite, setTacite] = useState(true);
  const [prestations, setPrestations] = useState('');
  const [options, setOptions] = useState<OptionForm[]>([]);
  useEffect(() => {
    setLibelle(proposition?.formule.libelle ?? '');
    setMensualite(proposition?.formule.mensualite?.toString() ?? '');
    setEngagement(String(proposition?.formule.engagementMois ?? 12));
    setTacite(proposition?.formule.tacite ?? true);
    setPrestations(proposition?.formule.prestations.join('\n') ?? '');
    setOptions(
      (proposition?.options ?? []).map((o) => ({
        id: o.id,
        libelle: o.libelle,
        description: o.description,
        mode: o.tarif.mode,
        montant: o.tarif.montant?.toString() ?? '',
      })),
    );
  }, [proposition]);
  const majOption = (i: number, patch: Partial<OptionForm>) =>
    setOptions((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const enregistrer = () =>
    onSauver({
      proposition: {
        formule: {
          libelle: libelle.trim(),
          mensualite: montantDe(mensualite),
          engagementMois: Number(engagement) || 12,
          tacite,
          prestations: prestations
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean),
        },
        options: options
          .filter((o) => o.libelle.trim() !== '')
          .map((o) => ({
            id: o.id,
            libelle: o.libelle.trim(),
            description: o.description.trim(),
            tarif: { mode: o.mode, montant: montantDe(o.montant) },
          })),
      },
    });
  return (
    <div className="stack">
      <label className="field">
        <span>Formule d’abonnement</span>
        <input value={libelle} onChange={(e) => setLibelle(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 12 }}>
        <label className="field">
          <span>Mensualité (€)</span>
          <input
            inputMode="decimal"
            placeholder="vide = sur devis"
            value={mensualite}
            onChange={(e) => setMensualite(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Engagement (mois)</span>
          <input
            inputMode="numeric"
            value={engagement}
            onChange={(e) => setEngagement(e.target.value)}
          />
        </label>
      </div>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={tacite} onChange={(e) => setTacite(e.target.checked)} />
        <span>Reconduction tacite</span>
      </label>
      <label className="field">
        <span>Prestations incluses (une par ligne)</span>
        <textarea rows={3} value={prestations} onChange={(e) => setPrestations(e.target.value)} />
      </label>
      {options.map((o, i) => (
        <div key={o.id} className="stack">
          <label className="field">
            <span>Libellé de l’option {i + 1}</span>
            <input value={o.libelle} onChange={(e) => majOption(i, { libelle: e.target.value })} />
          </label>
          <label className="field">
            <span>Description de l’option {i + 1}</span>
            <input
              value={o.description}
              onChange={(e) => majOption(i, { description: e.target.value })}
            />
          </label>
          <div className="row" style={{ gap: 12 }}>
            <label className="field">
              <span>Tarif de l’option {i + 1}</span>
              <select
                value={o.mode}
                onChange={(e) => majOption(i, { mode: e.target.value as 'forfait' | 'mensuel' })}
              >
                <option value="forfait">Forfait</option>
                <option value="mensuel">Par mois</option>
              </select>
            </label>
            <label className="field">
              <span>Montant de l’option {i + 1} (€)</span>
              <input
                inputMode="decimal"
                placeholder="vide = sur devis"
                value={o.montant}
                onChange={(e) => majOption(i, { montant: e.target.value })}
              />
            </label>
            <button
              className="btn"
              onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}
            >
              Retirer l’option {i + 1}
            </button>
          </div>
        </div>
      ))}
      <div className="row">
        <button
          className="btn"
          onClick={() =>
            setOptions((os) => [
              ...os,
              {
                id: `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                libelle: '',
                description: '',
                mode: 'forfait',
                montant: '',
              },
            ])
          }
        >
          Ajouter une option
        </button>
        <button
          className="btn go"
          disabled={libelle.trim() === ''}
          onClick={() => void enregistrer()}
        >
          Enregistrer la proposition
        </button>
        {proposition && (
          <button className="btn" onClick={() => void onSauver({ proposition: null })}>
            Retirer la proposition
          </button>
        )}
      </div>
    </div>
  );
}

// Deck de restitution (étape 5) : présente le rapport en moins d'une heure ; la dernière diapositive
// est la proposition de collaboration, que le pilote peut exclure. Ses éléments (tarifs, mode de
// fonctionnement) se donnent dans le chat de l'étape.
function RestitutionDeck({
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
  const enCours = projet.restitutionStatut === 'en_cours';
  const raison = projet.aRapport ? null : "Produisez d'abord le rapport à l'étape 4.";
  const demander = async () => {
    try {
      onChange(await demandeRestitutionDiag(slug, projet.id));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };
  const exportEnCours = projet.demande === 'restitution_export' && projet.statutChat !== 'repos';
  const exporter = async () => {
    try {
      onChange(await exporterRestitutionDiag(slug, projet.id));
    } catch (err) {
      onErreur(messageErreur(err));
    }
  };
  const precedents = projet.restitutionLiens.slice(1);
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Deck de restitution</h2>
        {projet.profil && <span className="badge green">Profil : {projet.profil}</span>}
      </div>
      <div className="panel-b stack">
        <p className="small muted" style={{ margin: 0 }}>
          Le deck présente le score, son explication, l’essentiel des préconisations et le plan
          d’action, selon un déroulé de 60 minutes.
        </p>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={projet.restitutionAvecProposition}
            onChange={(e) => void onSauver({ restitutionAvecProposition: e.target.checked })}
          />
          <span>Terminer par ma proposition de collaboration (formule et options ci-dessous)</span>
        </label>
        {projet.restitutionAvecProposition && (
          <PropositionForm proposition={projet.proposition} onSauver={onSauver} />
        )}
        {enCours && (
          <p className="small muted" style={{ margin: 0 }}>
            Claude crée le deck… La page se mettra à jour dès qu’il sera prêt.
          </p>
        )}
        {exportEnCours && (
          <p className="small muted" style={{ margin: 0 }}>
            Export PowerPoint en cours… Claude relit le deck publié.
          </p>
        )}
        <div className="diag-actions">
          {!enCours && projet.restitutionLien ? (
            <a className="btn go" href={projet.restitutionLien} target="_blank" rel="noreferrer">
              Ouvrir le deck de restitution
            </a>
          ) : (
            !projet.restitutionLien && (
              <button
                className="btn go"
                disabled={enCours || raison !== null}
                onClick={() => void demander()}
              >
                Produire le deck de restitution
              </button>
            )
          )}
          {!exportEnCours && projet.aPptx && projet.restitutionExportLe && (
            <a className="btn" href={urlPptxRestitutionDiag(slug, projet.id)} download>
              Télécharger le PowerPoint
            </a>
          )}
          {projet.restitutionLien && (
            <details className="diag-plus">
              <summary className="btn">Plus d’actions</summary>
              <div className="diag-plus-liste">
                <button disabled={enCours || raison !== null} onClick={() => void demander()}>
                  Produire un nouveau deck
                </button>
                <button disabled={enCours || exportEnCours} onClick={() => void exporter()}>
                  Exporter en PowerPoint
                </button>
              </div>
            </details>
          )}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Le deck est un brouillon : retouchez-le sur claude.ai, puis exportez-le en PowerPoint
          quand il vous convient (le PowerPoint reprend le texte et les notes à cet instant, avec la
          charte SIMATIS ; après une retouche, exportez à nouveau).
          {projet.aPptx && projet.restitutionExportLe
            ? ` PowerPoint exporté le ${new Date(projet.restitutionExportLe).toLocaleDateString('fr-FR')}.`
            : ''}{' '}
          Si vous changez un tarif sur claude.ai, changez-le aussi ici : cette proposition est la
          source du futur devis.
        </p>
        {!enCours && raison && (
          <p className="small muted" style={{ margin: 0 }}>
            {raison}
          </p>
        )}
        {precedents.length > 0 && (
          <details>
            <summary className="small">Decks précédents ({precedents.length})</summary>
            <ul className="small">
              {precedents.map((r) => (
                <li key={r.lien}>
                  <a href={r.lien} target="_blank" rel="noreferrer">
                    Deck du {new Date(r.le).toLocaleDateString('fr-FR')}
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
    <aside
      className={`panel diag-chat diag-chat-e${etape}`}
      aria-label={`Assistant Claude, étape ${etape}`}
    >
      <div className="panel-h diag-chat-h">
        <Icon name="brain" />
        <div>
          <h2>{CHAT_TITRE[etape] ?? `Assistant · ${ETAPES[etape - 1]}`}</h2>
          <div className="small muted">
            {CHAT_AIDE[etape] ?? 'Claude répond ici, par le runner de ce poste'}
          </div>
        </div>
        <button
          className="btn diag-vider"
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
              {CHAT_VIDE[etape] ??
                'Posez une question sur cette étape. Claude voit le contexte, le résultat et le formulaire de revue.'}
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
