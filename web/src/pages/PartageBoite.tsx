import { useEffect, useMemo, useState } from 'react';
import { fetchCarteCerveau, operationCerveau } from '../api.js';
import type { CarteCerveau, NoeudCerveau } from '../cerveau.js';
import { Icon } from '../icons.js';
import { documents, fils, majuscule, sansEntete, type Fil } from '../partage.js';
import { CerveauEspace } from './Cerveau.js';
import { ApercuFichier, ListeFichiers } from './FichiersPartages.js';
import { IdeeCerveau, MessagePartage, NoteCerveau } from './NoteCerveau.js';

type Rubrique = 'echanges' | 'a_repondre' | 'documents' | 'fichiers' | 'carte';
type Resultat = { chemin: string; extraits: string[] };

const quand = (n: NoeudCerveau) =>
  new Date(n.date ?? n.id.slice('echanges/'.length, 'echanges/'.length + 10)).toLocaleString(
    'fr-FR',
    {
      timeZone: 'Europe/Paris',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    },
  );
const erreurDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Texte d'un message : **gras** et adresses cliquables, rien d'autre.
function Texte({ texte }: { texte: string }) {
  const morceaux = texte.split(/(\*\*[^*\n]+\*\*|https?:\/\/[^\s)]+)/g);
  return (
    <>
      {morceaux.map((m, i) =>
        m.startsWith('**') ? (
          <b key={i}>{m.slice(2, -2)}</b>
        ) : /^https?:\/\//.test(m) ? (
          <a key={i} href={m} target="_blank" rel="noopener noreferrer">
            {m}
          </a>
        ) : (
          m
        ),
      )}
    </>
  );
}

// Messages déjà lus : rouvrir une conversation est alors immédiat (un message ne change plus).
const lus = new Map<string, string>();

// Une conversation : les messages en bulles et, dessous, la réponse sans quitter la page.
function FilMessages({
  slug,
  fil,
  moi,
  onDepose,
  onRetour,
}: {
  slug: string;
  fil: Fil;
  moi: string;
  onDepose: () => void;
  onRetour: () => void;
}) {
  const [textes, setTextes] = useState<Map<string, string>>(new Map(lus));
  const [erreur, setErreur] = useState<string | null>(null);
  const [corps, setCorps] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [locaux, setLocaux] = useState<string[]>([]);

  useEffect(() => {
    let vivant = true;
    for (const m of fil.messages) if (m.texte && !lus.has(m.id)) lus.set(m.id, m.texte);
    const manquants = fil.messages.map((m) => m.id).filter((id) => !lus.has(id));
    (manquants.length
      ? operationCerveau(slug, {
          espace: 'partage',
          type: 'lire_messages',
          chemins: manquants,
        }).then((r) => {
          for (const [id, t] of Object.entries(r.textes ?? {})) lus.set(id, sansEntete(t));
        })
      : Promise.resolve()
    ).then(
      () => vivant && setTextes(new Map(lus)),
      (e: unknown) => vivant && setErreur(erreurDe(e)),
    );
    return () => {
      vivant = false;
    };
  }, [slug, fil.id, fil.messages.length]);

  const dernierAutre = [...fil.messages].reverse().find((m) => m.auteur !== moi);
  const cible = dernierAutre ?? fil.messages.at(-1);
  const interlocuteur = dernierAutre?.auteur ? majuscule(dernierAutre.auteur) : 'l’autre côté';

  const envoyer = () => {
    if (!cible) return;
    if (
      !window.confirm(
        'Déposer cette réponse ? Elle sera lue par Christophe et ne pourra plus être modifiée.',
      )
    )
      return;
    setEnvoi(true);
    setErreur(null);
    operationCerveau(slug, {
      espace: 'partage',
      type: 'message',
      genre: 'reponse',
      sujet: `Re : ${fil.sujet}`,
      corps,
      enReponseA: cible.id,
    }).then(
      () => {
        setLocaux((l) => [...l, corps]);
        setCorps('');
        setEnvoi(false);
        onDepose();
      },
      (e: unknown) => {
        setErreur(erreurDe(e));
        setEnvoi(false);
      },
    );
  };

  return (
    <div className="pb-fil">
      <button className="btn sm pb-retour" onClick={onRetour}>
        ← Retour à la liste
      </button>
      <h3>{fil.sujet}</h3>
      <p className="cerveau-note">
        {fil.messages.length} message{fil.messages.length > 1 ? 's' : ''}
      </p>
      {erreur && (
        <div className="empty" role="alert">
          {erreur}
        </div>
      )}
      <div className="pb-bulles">
        {fil.messages.map((m) => (
          <div key={m.id} className={m.auteur === moi ? 'pb-bulle moi' : 'pb-bulle'}>
            <span className="cerveau-note">
              {m.auteur === moi ? 'Vous' : majuscule(m.auteur ?? '?')} · {quand(m)}
            </span>
            <p>{textes.has(m.id) ? <Texte texte={textes.get(m.id) as string} /> : 'Chargement…'}</p>
          </div>
        ))}
        {locaux.map((t, i) => (
          <div key={`${t}-${i}`} className="pb-bulle moi">
            <span className="cerveau-note">Vous · à l’instant</span>
            <p>{t}</p>
          </div>
        ))}
      </div>
      <div className="pb-repondre">
        <textarea
          aria-label="Votre réponse"
          placeholder={`Répondre à ${interlocuteur}…`}
          value={corps}
          onChange={(e) => setCorps(e.target.value)}
          rows={4}
        />
        <p className="cerveau-note">
          Ne mettez rien d’un autre client ni de confidentiel : l’espace est partagé avec
          Christophe.
        </p>
        <div className="cerveau-actions">
          <button className="btn primary" onClick={envoyer} disabled={envoi || !corps.trim()}>
            {envoi ? 'Dépôt…' : 'Envoyer la réponse'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Espace partagé AlpesIA × Simatis en boîte de réception : rubriques à gauche, liste au milieu,
// lecture et réponse à droite. La carte en réseau n'est plus qu'une rubrique.
export function PartageBoite({ slug }: { slug: string }) {
  const [carte, setCarte] = useState<CarteCerveau | null | undefined>(undefined);
  const [erreur, setErreur] = useState<string | null>(null);
  const [rubrique, setRubrique] = useState<Rubrique>('echanges');
  const [choix, setChoix] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [resultats, setResultats] = useState<Resultat[] | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [actualisation, setActualisation] = useState(false);
  const [rechargement, setRechargement] = useState(0);

  useEffect(() => {
    let vivant = true;
    fetchCarteCerveau(slug, 'partage').then(
      (c) => vivant && setCarte(c),
      (e: unknown) => vivant && setErreur(erreurDe(e)),
    );
    return () => {
      vivant = false;
    };
  }, [slug, rechargement]);

  const recharger = () => setTimeout(() => setRechargement((n) => n + 1), 3000);
  const moi = carte?.moi ?? '';
  const tous = useMemo(() => (carte ? fils(carte.noeuds, moi) : []), [carte, moi]);
  const docs = useMemo(() => (carte ? documents(carte.noeuds) : []), [carte]);

  const actualiser = () => {
    setActualisation(true);
    operationCerveau(slug, { espace: 'partage', type: 'actualiser' }).then(
      () => {
        setActualisation(false);
        setRechargement((n) => n + 1);
      },
      (e: unknown) => {
        setActualisation(false);
        setErreur(erreurDe(e));
      },
    );
  };

  if (erreur) return <div className="empty">{erreur}</div>;
  if (carte === undefined) return <div className="empty">Chargement…</div>;
  if (carte === null)
    return (
      <div className="empty">
        La carte de l’espace partagé n’est pas encore arrivée. Elle est envoyée par l’exécuteur de
        cet ordinateur : vérifiez qu’il tourne (Automatismes) et que le serveur « partage » de
        Claude Code est installé.{' '}
        <button className="btn" onClick={actualiser} disabled={actualisation}>
          {actualisation ? 'Lecture du kDrive…' : 'Actualiser'}
        </button>
      </div>
    );

  const requete = recherche.trim().toLowerCase();
  const aRepondre = tous.filter((f) => f.aRepondre);
  const filsAffiches = (rubrique === 'a_repondre' ? aRepondre : tous).filter(
    (f) => !requete || f.sujet.toLowerCase().includes(requete),
  );
  const docsAffiches = docs.filter(
    (d) =>
      !requete || d.titre.toLowerCase().includes(requete) || d.id.toLowerCase().includes(requete),
  );
  const filChoisi = tous.find((f) => f.id === choix);
  const fichiers = carte.fichiers ?? [];
  const fichierChoisi =
    rubrique === 'fichiers' ? fichiers.find((f) => f.chemin === choix) : undefined;

  const aller = (r: Rubrique) => {
    setRubrique(r);
    setChoix(null);
    setNouveau(false);
    setResultats(null);
  };

  const chercher = () => {
    if (!requete || enCours) return;
    setEnCours(true);
    setErreur(null);
    operationCerveau(slug, { espace: 'partage', type: 'chercher', requete: recherche }).then(
      (r) => {
        setEnCours(false);
        setResultats(r.resultats ?? []);
      },
      (e: unknown) => {
        setEnCours(false);
        setErreur(erreurDe(e));
      },
    );
  };

  const ouvrirResultat = (chemin: string) => {
    const fil = tous.find((f) => f.messages.some((m) => m.id === chemin));
    setResultats(null);
    setNouveau(false);
    setRubrique(fil ? 'echanges' : chemin.endsWith('.md') ? 'documents' : 'fichiers');
    setChoix(fil ? fil.id : chemin);
  };

  const titreDe = (chemin: string) => carte.noeuds.find((n) => n.id === chemin)?.titre ?? chemin;

  const nav: [Rubrique, string, number | null, string][] = [
    ['echanges', 'Échanges', tous.length, 'mail'],
    ['a_repondre', 'À répondre', aRepondre.length, 'send'],
    ['documents', 'Documents', docs.length, 'file'],
    ['fichiers', 'Fichiers', fichiers.length, 'inbox'],
    ['carte', 'Carte', null, 'map'],
  ];

  return (
    <div
      className={['pb', rubrique === 'carte' ? 'pb-large' : '', choix || nouveau ? 'pb-ouvert' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <aside className="pb-nav">
        <form
          className="pb-recherche"
          onSubmit={(e) => {
            e.preventDefault();
            chercher();
          }}
        >
          <Icon name="search" />
          <input
            type="search"
            placeholder="Chercher partout…"
            aria-label="Chercher partout"
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value);
              setResultats(null);
            }}
          />
          {requete && (
            <button className="btn sm" type="submit" disabled={enCours}>
              {enCours ? 'Recherche…' : 'Chercher dans le contenu'}
            </button>
          )}
        </form>
        {nav.map(([id, libelle, nb, icone]) => (
          <button
            key={id}
            className={rubrique === id ? 'pb-rub on' : 'pb-rub'}
            aria-pressed={rubrique === id}
            onClick={() => aller(id)}
          >
            <span className="pb-rub-libelle">
              <Icon name={icone} />
              {libelle}
            </span>
            {nb !== null && <b>{nb}</b>}
          </button>
        ))}
        <button
          className="btn primary"
          onClick={() => {
            if (rubrique === 'carte') setRubrique('echanges');
            setChoix(null);
            setNouveau(true);
          }}
        >
          <Icon name="edit" />
          Nouveau message
        </button>
        <button className="btn" onClick={actualiser} disabled={actualisation}>
          <Icon name="refresh" />
          {actualisation ? 'Lecture du kDrive…' : 'Actualiser'}
        </button>
        <p className="cerveau-note">
          {carte.noeuds.length} notes
          {carte.tronquee ? ' (limité aux premières)' : ''}.
        </p>
      </aside>

      {rubrique === 'carte' ? (
        <div className="pb-carte">
          <CerveauEspace slug={slug} espace="partage" />
        </div>
      ) : (
        <>
          <section className="pb-liste" aria-label="Liste">
            {!resultats && (rubrique === 'echanges' || rubrique === 'a_repondre') && (
              <div className="pb-liste-entete">
                <div>
                  <h2>{rubrique === 'a_repondre' ? 'À répondre' : 'Échanges'}</h2>
                  <span>
                    {filsAffiches.length} conversation{filsAffiches.length > 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            )}
            {resultats ? (
              <>
                <div className="pb-titre">
                  Résultats pour « {recherche.trim()} »{' '}
                  <button className="btn sm" onClick={() => setResultats(null)}>
                    Effacer
                  </button>
                </div>
                {resultats.length === 0 && <p className="cerveau-note">Aucun résultat.</p>}
                {resultats.map((r) => (
                  <div key={r.chemin} className="pb-ligne">
                    <button onClick={() => ouvrirResultat(r.chemin)}>{titreDe(r.chemin)}</button>
                    {r.extraits.slice(0, 3).map((x) => (
                      <span key={x} className="cerveau-note">
                        {x}
                      </span>
                    ))}
                  </div>
                ))}
              </>
            ) : rubrique === 'echanges' || rubrique === 'a_repondre' ? (
              <>
                {filsAffiches.length === 0 && (
                  <p className="cerveau-note">
                    {rubrique === 'a_repondre'
                      ? 'Rien n’attend votre réponse.'
                      : 'Aucune conversation.'}
                  </p>
                )}
                {filsAffiches.map((f) => (
                  <button
                    key={f.id}
                    data-testid="fil"
                    className={f.id === choix && !nouveau ? 'pb-ligne on' : 'pb-ligne'}
                    onClick={() => {
                      setNouveau(false);
                      setChoix(f.id);
                    }}
                  >
                    <span className="pb-sujet">{f.sujet}</span>
                    <span className="cerveau-note">
                      {majuscule(f.messages.at(-1)?.auteur ?? '?')} ·{' '}
                      {f.messages.at(-1) ? quand(f.messages.at(-1) as NoeudCerveau) : ''} ·{' '}
                      {f.messages.length} message{f.messages.length > 1 ? 's' : ''}
                    </span>
                    {f.aRepondre && <span className="badge amber">À répondre</span>}
                    {f.enAttente && <span className="badge">Sans réponse</span>}
                  </button>
                ))}
              </>
            ) : rubrique === 'documents' ? (
              <>
                <IdeeCerveau
                  slug={slug}
                  espace="partage"
                  onAjoutee={(chemin) => {
                    setChoix(chemin);
                    recharger();
                  }}
                />
                {docsAffiches.map((d) => (
                  <button
                    key={d.id}
                    className={d.id === choix ? 'pb-ligne on' : 'pb-ligne'}
                    onClick={() => {
                      setNouveau(false);
                      setChoix(d.id);
                    }}
                  >
                    <span className="pb-sujet">{d.titre}</span>
                    <span className="cerveau-note">{d.id}</span>
                  </button>
                ))}
              </>
            ) : (
              <ListeFichiers
                fichiers={fichiers}
                requete={requete}
                choix={choix}
                onChoisir={(chemin) => {
                  setNouveau(false);
                  setChoix(chemin);
                }}
              />
            )}
          </section>

          <section className="pb-lecture" aria-label="Lecture">
            {nouveau ? (
              <MessagePartage
                key="nouveau"
                slug={slug}
                onFerme={() => setNouveau(false)}
                onDepose={() => {
                  setNouveau(false);
                  recharger();
                }}
              />
            ) : filChoisi ? (
              <FilMessages
                key={filChoisi.id}
                slug={slug}
                fil={filChoisi}
                moi={moi}
                onDepose={recharger}
                onRetour={() => setChoix(null)}
              />
            ) : choix && rubrique === 'documents' ? (
              <NoteCerveau
                key={choix}
                slug={slug}
                espace="partage"
                chemin={choix}
                onFerme={() => setChoix(null)}
                onEnregistre={recharger}
              />
            ) : fichierChoisi ? (
              <ApercuFichier
                key={fichierChoisi.chemin}
                slug={slug}
                fichier={fichierChoisi}
                lienKdrive={carte.lienKdrive}
                onRetour={() => setChoix(null)}
              />
            ) : (
              <div className="pb-vide">
                <span className="pb-vide-icone" aria-hidden="true">
                  <Icon name={rubrique === 'fichiers' ? 'file' : 'mail'} />
                </span>
                {rubrique === 'fichiers' ? (
                  <>
                    <h2>Sélectionnez un fichier</h2>
                    <p>Son aperçu s’affiche ici, avec un bouton pour le télécharger.</p>
                  </>
                ) : (
                  <>
                    <h2>Sélectionnez un échange</h2>
                    <p>Choisissez une conversation ou un document pour l’afficher ici.</p>
                    <span className="pb-vide-aide">
                      La lecture et la réponse restent dans cet espace.
                    </span>
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
