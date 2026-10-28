import { useEffect, useState, type FormEvent } from 'react';
import {
  fetchAtelier,
  fetchAteliers,
  fetchEntreprises,
  fetchProjetsDiag,
  fetchTestsVma,
  creerAtelier,
  importerAtelier,
  supprimerAtelier,
  type AtelierListe,
  type Entreprise,
  type ProjetDiag,
  type TestVma,
} from '../api.js';
import { Icon } from '../icons.js';
import { AtelierVue } from './atelier/AtelierVue.js';
import { completer, etatVide, type EtatAtelier } from './atelier/etat.js';
import { Modale } from './diagnostics/Creation.js';
import { filtrer, grouper, paginer } from './diagnostics/grouper.js';

const PAR_PAGE = 5;

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));
const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');
const Beta = () => <span className="beta">Bêta</span>;

// L'atelier ouvert : `null` pour le module d'essai (rien n'est enregistré).
type Ouvert = {
  atelier: { id: string; titre: string; entrepriseNom: string } | null;
  etat: EtatAtelier;
};

// Accueil de la section : une ligne par entreprise suivie, avec son diagnostic, ses tests VMA et ses
// ateliers. Le diagnostic et les tests s'y lisent seulement : ils s'ouvrent dans « Outils et diagnostics ».
export function Atelier({
  slug,
  ouvrir,
  onTitre,
}: {
  slug: string;
  // Identifiant d'un atelier à ouvrir directement (lien depuis une fiche).
  ouvrir?: string;
  onTitre?: (titre: string | null) => void;
}) {
  const [entreprises, setEntreprises] = useState<Entreprise[] | null>(null);
  const [projets, setProjets] = useState<ProjetDiag[]>([]);
  const [tests, setTests] = useState<TestVma[]>([]);
  const [ateliers, setAteliers] = useState<AtelierListe[]>([]);
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [modale, setModale] = useState<{ type: 'creer' | 'importer'; preselect?: string } | null>(
    null,
  );
  const [ouvert, setOuvert] = useState<Ouvert | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = async () => {
    try {
      const [e, p, t, a] = await Promise.all([
        fetchEntreprises(slug, ''),
        fetchProjetsDiag(slug),
        fetchTestsVma(slug),
        fetchAteliers(slug),
      ]);
      setEntreprises(e);
      setProjets(p);
      setTests(t);
      setAteliers(a);
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  const nomDe = (entrepriseId: string) =>
    entreprises?.find((e) => e.id === entrepriseId)?.nom ?? 'Entreprise';

  const ouvrirAtelier = async (id: string) => {
    try {
      const a = await fetchAtelier(slug, id);
      setOuvert({
        atelier: { id: a.id, titre: a.titre, entrepriseNom: nomDe(a.entrepriseId) },
        etat: completer(a.etat),
      });
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  useEffect(() => {
    void charger();
  }, [slug]);
  useEffect(() => {
    if (ouvrir && entreprises) void ouvrirAtelier(ouvrir);
  }, [ouvrir, entreprises === null]);

  const titre = ouvert
    ? ouvert.atelier
      ? 'Atelier stratégique'
      : 'Atelier : module d’essai'
    : null;
  useEffect(() => {
    onTitre?.(titre);
    return () => onTitre?.(null);
  }, [titre]);

  const basculer = (cle: string) =>
    setOuvertes((s) => {
      const suivant = new Set(s);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });

  const supprimer = async (a: AtelierListe) => {
    if (!window.confirm(`Supprimer « ${a.titre} » ? Cette action est irréversible.`)) return;
    try {
      await supprimerAtelier(slug, a.id);
      await charger();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  const alerte = erreur && (
    <div className="alert amber" role="alert">
      <span>{erreur}</span>
      <button className="btn" onClick={() => setErreur(null)}>
        Fermer
      </button>
    </div>
  );

  if (ouvert) {
    return (
      <div className="stack">
        {alerte}
        <AtelierVue
          slug={slug}
          atelier={ouvert.atelier}
          etatInitial={ouvert.etat}
          essai={ouvert.atelier === null}
          onRetour={() => {
            setOuvert(null);
            void charger();
          }}
          onTitre={onTitre}
        />
      </div>
    );
  }

  if (!entreprises) {
    return erreur ? (
      <div className="alert amber">{erreur}</div>
    ) : (
      <div className="panel empty">Chargement…</div>
    );
  }

  const parEntreprise = (id: string) => ateliers.filter((a) => a.entrepriseId === id);
  // Seules les entreprises déjà suivies apparaissent ; un diagnostic sans entreprise n'a pas d'atelier.
  const lignes = grouper(entreprises, projets, tests).filter(
    (l) =>
      l.id !== null && (l.diag !== null || l.tests.length > 0 || parEntreprise(l.id).length > 0),
  );
  const filtrees = filtrer(lignes, recherche);
  const { items, page: pageCourante, pages } = paginer(filtrees, page, PAR_PAGE);

  return (
    <div className="stack dg">
      {alerte}
      <div className="panel dg-titre">
        <div className="panel-h">
          <p className="dg-intro">
            Chaque entreprise avec son diagnostic, ses tests VMA et ses ateliers : le point de
            départ d’une stratégie commerciale. <Beta />
          </p>
          <button
            className="btn"
            type="button"
            onClick={() => setOuvert({ atelier: null, etat: etatVide() })}
          >
            Atelier : module d’essai
          </button>
          <div className="dg-menu">
            <button
              className="btn go"
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOuvert}
              onClick={() => setMenuOuvert((o) => !o)}
            >
              + Nouveau
            </button>
            {menuOuvert && (
              <div className="dg-menu-liste">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOuvert(false);
                    setModale({ type: 'creer' });
                  }}
                >
                  Nouvel atelier stratégique <Beta />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOuvert(false);
                    setModale({ type: 'importer' });
                  }}
                >
                  Importer un atelier <Beta />
                </button>
              </div>
            )}
          </div>
          <input
            type="search"
            aria-label="Rechercher une entreprise"
            placeholder="Recherche"
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="panel empty">
          {lignes.length === 0 ? 'Aucune entreprise suivie.' : 'Aucune entreprise ne correspond.'}
        </div>
      ) : (
        items.map((l) => {
          const cle = l.id!;
          const ouverte = ouvertes.has(cle);
          const siens = parEntreprise(cle);
          const dernier = [...siens].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
          const nbRecus = l.tests.filter((t) => t.recueLe).length;
          return (
            <div key={cle} className="panel dg-ligne">
              <button
                className="dg-entete dg-entete-4"
                type="button"
                aria-expanded={ouverte}
                onClick={() => basculer(cle)}
              >
                <div>
                  <div className="dg-nom">{l.nom}</div>
                  <div className="small muted">Entreprise</div>
                </div>
                <div>
                  <div className="dg-label">Diagnostic</div>
                  <div>{l.diag ? `Étape ${l.diag.etapeMax} sur 5` : 'Pas encore lancé'}</div>
                </div>
                <div>
                  <div className="dg-label">Tests VMA</div>
                  <div>
                    {l.tests.length === 0
                      ? 'Aucun'
                      : `${l.tests.length} test${l.tests.length > 1 ? 's' : ''}${nbRecus ? ` · ${nbRecus} reçu${nbRecus > 1 ? 's' : ''}` : ''}`}
                  </div>
                </div>
                <div>
                  <div className="dg-label">Ateliers</div>
                  <div>
                    {dernier ? `${siens.length} · étape ${dernier.etapeMax} sur 6` : 'Aucun'}
                  </div>
                </div>
                <span className="dg-bascule">{ouverte ? 'Réduire ▴' : 'Détail ▾'}</span>
              </button>

              {ouverte && (
                <div className="dg-detail">
                  <section className="dg-bloc">
                    <h3>Diagnostic d’endurance commerciale</h3>
                    <p className="small muted">
                      {l.diag
                        ? `Étape ${l.diag.etapeMax} sur 5. Point de départ de l’atelier.`
                        : 'Pas encore lancé.'}
                    </p>
                    <a href={`#/${slug}/diagnostics`}>Ouvrir dans Outils et diagnostics ↗</a>
                  </section>
                  <section className="dg-bloc">
                    <h3>Tests VMA</h3>
                    <p className="small muted">
                      {l.tests.length === 0
                        ? 'Aucun test pour l’instant.'
                        : `${l.tests.length} test${l.tests.length > 1 ? 's' : ''}. Point de départ de l’atelier.`}
                    </p>
                    <a href={`#/${slug}/diagnostics`}>Ouvrir dans Outils et diagnostics ↗</a>
                  </section>
                  <section className="dg-bloc dg-bloc-large">
                    <h3>
                      Ateliers stratégiques <Beta />
                    </h3>
                    {siens.length === 0 ? (
                      <p className="small muted">Pas encore lancé.</p>
                    ) : (
                      <ul className="dg-tests">
                        {siens.map((a) => (
                          <li key={a.id}>
                            <span>
                              <b>{a.titre}</b>
                              <span className="small muted">
                                {' '}
                                · modifié le {date(a.updatedAt)} · {a.nbActions} action
                                {a.nbActions > 1 ? 's' : ''} · étape {a.etapeMax} sur 6
                              </span>
                            </span>
                            <span className="dg-actions">
                              <button
                                className="btn"
                                type="button"
                                onClick={() => void ouvrirAtelier(a.id)}
                              >
                                Reprendre l’atelier
                              </button>
                              <button
                                className="btn"
                                type="button"
                                disabled
                                title="Prévu plus tard"
                              >
                                Partager avec le client
                              </button>
                              <button
                                className="btn carre danger"
                                type="button"
                                aria-label="Supprimer l’atelier"
                                title="Supprimer l’atelier"
                                onClick={() => void supprimer(a)}
                              >
                                <Icon name="trash" />
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      className="btn go"
                      type="button"
                      onClick={() => setModale({ type: 'creer', preselect: cle })}
                    >
                      {siens.length === 0 ? 'Lancer un atelier' : '+ Nouvel atelier'}
                    </button>
                  </section>
                </div>
              )}
            </div>
          );
        })
      )}

      {modale?.type === 'creer' && (
        <NouvelAtelier
          slug={slug}
          entreprises={entreprises}
          preselect={modale.preselect}
          onFermer={() => setModale(null)}
          onOuvre={(id) => {
            setModale(null);
            void ouvrirAtelier(id);
          }}
        />
      )}
      {modale?.type === 'importer' && (
        <ImporterAtelier
          slug={slug}
          entreprises={entreprises}
          preselect={modale.preselect}
          onFermer={() => setModale(null)}
          onOuvre={(id) => {
            setModale(null);
            void ouvrirAtelier(id);
          }}
        />
      )}

      {filtrees.length > 0 && (
        <nav className="dg-pages" aria-label="Pages">
          <span className="small muted">
            Entreprises {(pageCourante - 1) * PAR_PAGE + 1} à{' '}
            {(pageCourante - 1) * PAR_PAGE + items.length} sur {filtrees.length}
          </span>
          <div className="dg-pages-boutons">
            <button
              className="btn"
              type="button"
              disabled={pageCourante === 1}
              onClick={() => setPage(pageCourante - 1)}
            >
              ← Précédent
            </button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                className={`btn${n === pageCourante ? ' go' : ''}`}
                type="button"
                aria-current={n === pageCourante ? 'page' : undefined}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            ))}
            <button
              className="btn"
              type="button"
              disabled={pageCourante === pages}
              onClick={() => setPage(pageCourante + 1)}
            >
              Suivant →
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

type PropsModale = {
  slug: string;
  entreprises: Entreprise[];
  preselect?: string | undefined;
  onFermer: () => void;
  onOuvre: (id: string) => void;
};

function NouvelAtelier({ slug, entreprises, preselect, onFermer, onOuvre }: PropsModale) {
  const [entrepriseId, setEntrepriseId] = useState(preselect ?? entreprises[0]?.id ?? '');
  const [titre, setTitre] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const creer = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!entrepriseId) return setErreur('Choisissez une entreprise.');
    setEnvoi(true);
    setErreur(null);
    try {
      const a = await creerAtelier(slug, entrepriseId, titre);
      onOuvre(a.id);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  };

  return (
    <Modale titre="Nouvel atelier stratégique" onFermer={onFermer}>
      <form className="stack" onSubmit={(ev) => void creer(ev)}>
        <label htmlFor="at-entreprise">Entreprise</label>
        <select
          id="at-entreprise"
          value={entrepriseId}
          onChange={(e) => setEntrepriseId(e.target.value)}
        >
          {entreprises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nom}
            </option>
          ))}
        </select>
        <label htmlFor="at-titre">Nom de l’atelier</label>
        <input id="at-titre" value={titre} onChange={(e) => setTitre(e.target.value)} />
        {erreur && <div className="alert amber">{erreur}</div>}
        <div className="dg-actions">
          <button className="btn" type="button" onClick={onFermer}>
            Annuler
          </button>
          <button className="btn go" type="submit" disabled={envoi || !titre.trim()}>
            Créer et ouvrir
          </button>
        </div>
      </form>
    </Modale>
  );
}

function ImporterAtelier({ slug, entreprises, preselect, onFermer, onOuvre }: PropsModale) {
  const [entrepriseId, setEntrepriseId] = useState(preselect ?? entreprises[0]?.id ?? '');
  const [titre, setTitre] = useState('');
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const importer = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!entrepriseId) return setErreur('Choisissez une entreprise.');
    if (!fichier) return setErreur('Choisissez un fichier de sauvegarde.');
    setEnvoi(true);
    setErreur(null);
    let sauvegarde: unknown;
    try {
      sauvegarde = JSON.parse(await fichier.text());
    } catch {
      setEnvoi(false);
      return setErreur('Fichier illisible : ce n’est pas une sauvegarde d’atelier.');
    }
    try {
      const a = await importerAtelier(slug, entrepriseId, titre, sauvegarde);
      onOuvre(a.id);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  };

  return (
    <Modale titre="Importer un atelier" onFermer={onFermer}>
      <form className="stack" onSubmit={(ev) => void importer(ev)}>
        <label htmlFor="at-imp-entreprise">Entreprise</label>
        <select
          id="at-imp-entreprise"
          value={entrepriseId}
          onChange={(e) => setEntrepriseId(e.target.value)}
        >
          {entreprises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nom}
            </option>
          ))}
        </select>
        <label htmlFor="at-imp-fichier">Fichier de sauvegarde (.json)</label>
        <input
          id="at-imp-fichier"
          type="file"
          accept="application/json,.json"
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
        />
        <label htmlFor="at-imp-titre">Nom de l’atelier</label>
        <input id="at-imp-titre" value={titre} onChange={(e) => setTitre(e.target.value)} />
        <p className="small muted">
          Le contenu est enregistré dans la base de l’OS. Il n’est jamais envoyé sur GitHub.
        </p>
        {erreur && <div className="alert amber">{erreur}</div>}
        <div className="dg-actions">
          <button className="btn" type="button" onClick={onFermer}>
            Annuler
          </button>
          <button className="btn go" type="submit" disabled={envoi || !titre.trim()}>
            Importer et ouvrir
          </button>
        </div>
      </form>
    </Modale>
  );
}
