import { useEffect, useState } from 'react';
import {
  fetchEntreprises,
  fetchProjetsDiag,
  fetchTestsVma,
  revoquerTestVma,
  supprimerProjetDiag,
  supprimerTestVma,
  type Entreprise,
  type ProjetDiag,
  type TestVma,
} from '../api.js';
import { Icon } from '../icons.js';
import { ETAPES, ProjetVue } from './Diagnostic.js';
import { ResultatComplet } from './diagnostics/ResultatComplet.js';
import { Modale, NouveauDiagnostic, NouveauTestVma } from './diagnostics/Creation.js';
import { libelleStatut, fmtEur } from './TestsVma.js';
import {
  filtrer,
  grouper,
  lignesSuivies,
  paginer,
  resumerVma,
  type LigneEntreprise,
} from './diagnostics/grouper.js';

const PAR_PAGE = 5;

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));
const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');
const libelleTest = (t: Pick<TestVma, 'type'>) =>
  t.type === 'essai' ? 'Essai (non compté dans l’historique)' : 'Premier test';

// Ce qu'une suppression efface : les ids à supprimer et la phrase montrée dans la confirmation.
type Suppression = { titre: string; phrase: string; projetIds: string[]; testIds: string[] };

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const listeEffacee = (projetIds: string[], testIds: string[]) =>
  [
    projetIds.length ? pluriel(projetIds.length, 'diagnostic') : '',
    testIds.length ? pluriel(testIds.length, 'test') : '',
  ]
    .filter(Boolean)
    .join(' et ');

// Une ligne sans entreprise (diagnostic orphelin) a un identifiant null : on la distingue par son nom de projet.
const cleDe = (l: LigneEntreprise) => l.id ?? `projet-${l.diag?.id ?? l.nom}`;

// `ouvrir` : identifiant d'un projet à ouvrir directement (lien depuis une fiche).
export function Diagnostics({ slug, ouvrir }: { slug: string; ouvrir?: string }) {
  const [entreprises, setEntreprises] = useState<Entreprise[] | null>(null);
  const [projets, setProjets] = useState<ProjetDiag[]>([]);
  const [tests, setTests] = useState<TestVma[]>([]);
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [projetOuvert, setProjetOuvert] = useState<string | null>(ouvrir ?? null);
  const [testOuvert, setTestOuvert] = useState<string | null>(null);
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [modale, setModale] = useState<{ type: 'diag' | 'vma'; preselect?: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [suppression, setSuppression] = useState<Suppression | null>(null);
  const [enCours, setEnCours] = useState(false);

  const charger = async () => {
    try {
      const [e, p, t] = await Promise.all([
        fetchEntreprises(slug, ''),
        fetchProjetsDiag(slug),
        fetchTestsVma(slug),
      ]);
      setEntreprises(e);
      setProjets(p);
      setTests(t);
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  // Recharge quand on change d'instance.
  useEffect(() => {
    void charger();
  }, [slug]);

  const basculer = (cle: string) =>
    setOuvertes((s) => {
      const suivant = new Set(s);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });

  const revoquer = async (t: TestVma) => {
    if (
      !window.confirm(`Révoquer l’invitation de ${t.entrepriseNom} ? Le lien ne fonctionnera plus.`)
    )
      return;
    try {
      await revoquerTestVma(slug, t.id);
      await charger();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  // Tests d'abord : un test ouvert est révoqué côté site, et s'il échoue rien d'autre n'est effacé.
  const confirmerSuppression = async () => {
    if (!suppression) return;
    setEnCours(true);
    try {
      for (const id of suppression.testIds) await supprimerTestVma(slug, id);
      for (const id of suppression.projetIds) await supprimerProjetDiag(slug, id);
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnCours(false);
      setSuppression(null);
      await charger();
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

  if (projetOuvert) {
    const projet = projets.find((p) => p.id === projetOuvert);
    if (projet) {
      return (
        <div className="stack">
          {alerte}
          <ProjetVue
            key={projet.id}
            slug={slug}
            projet={projet}
            onChange={(maj) => setProjets((l) => l.map((p) => (p.id === maj.id ? maj : p)))}
            onRetour={() => setProjetOuvert(null)}
            onErreur={setErreur}
          />
        </div>
      );
    }
  }

  const test = testOuvert ? tests.find((t) => t.id === testOuvert) : undefined;
  if (test?.resultat) {
    return <ResultatComplet test={test} onRetour={() => setTestOuvert(null)} />;
  }

  if (!entreprises) {
    return erreur ? (
      <div className="alert amber">{erreur}</div>
    ) : (
      <div className="panel empty">Chargement…</div>
    );
  }

  const lignes = lignesSuivies(grouper(entreprises, projets, tests));
  const filtrees = filtrer(lignes, recherche);
  const { items, page: pageCourante, pages } = paginer(filtrees, page, PAR_PAGE);

  return (
    <div className="stack dg">
      {alerte}
      <div className="panel dg-titre">
        <div className="panel-h">
          <div>
            <h2>Diagnostics</h2>
            <div className="small muted">
              Une ligne par entreprise : son diagnostic et ses tests VMA.
            </div>
          </div>
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
                    setModale({ type: 'diag' });
                  }}
                >
                  Nouveau diagnostic
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOuvert(false);
                    setModale({ type: 'vma' });
                  }}
                >
                  Nouveau test VMA
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
          {lignes.length === 0 ? 'Aucune entreprise.' : 'Aucune entreprise ne correspond.'}
        </div>
      ) : (
        items.map((l) => {
          const cle = cleDe(l);
          const ouverte = ouvertes.has(cle);
          const resume = resumerVma(l.tests);
          const nbRecus = l.tests.filter((t) => t.recueLe).length;
          return (
            <div key={cle} className="panel dg-ligne">
              <button
                className="dg-entete"
                type="button"
                aria-expanded={ouverte}
                onClick={() => basculer(cle)}
              >
                <div>
                  <div className="dg-nom">{l.nom}</div>
                  <div className="small muted">{l.id ? 'Entreprise' : 'Sans entreprise'}</div>
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
                <span className="dg-bascule">{ouverte ? 'Réduire ▴' : 'Détail ▾'}</span>
              </button>

              {ouverte && (
                <div className="dg-detail">
                  <section className="dg-bloc">
                    <h3>Diagnostic d’endurance commerciale</h3>
                    {l.diag ? (
                      <>
                        <div className="dg-etapes">
                          {ETAPES.map((_, i) => (
                            <span
                              key={i}
                              className={
                                i < l.diag!.etapeMax - 1
                                  ? 'fait'
                                  : i === l.diag!.etapeMax - 1
                                    ? 'en-cours'
                                    : ''
                              }
                            />
                          ))}
                        </div>
                        <p className="small muted">
                          Étape {l.diag.etape} · {ETAPES[l.diag.etape - 1]}
                        </p>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setProjetOuvert(l.diag!.id)}
                        >
                          Ouvrir le diagnostic
                        </button>{' '}
                        <button
                          className="btn carre danger"
                          aria-label="Supprimer le diagnostic"
                          title="Supprimer le diagnostic"
                          type="button"
                          onClick={() =>
                            setSuppression({
                              titre: 'Supprimer le diagnostic',
                              phrase: `Le diagnostic de ${l.nom} sera effacé définitivement, avec son rapport, son entretien et sa conversation.`,
                              projetIds: [l.diag!.id],
                              testIds: [],
                            })
                          }
                        >
                          <Icon name="trash" />
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="small muted">Pas encore lancé.</p>
                        {l.id && (
                          <button
                            className="btn go"
                            type="button"
                            onClick={() => setModale({ type: 'diag', preselect: l.id! })}
                          >
                            Lancer le diagnostic
                          </button>
                        )}
                      </>
                    )}
                  </section>

                  <section className="dg-bloc">
                    <h3>Tests VMA</h3>
                    {resume.dernier && (
                      <div className="dg-resultat">
                        <div className="dg-grand">
                          {resume.dernier.vma != null
                            ? fmtEur(resume.dernier.vma)
                            : 'Non mesurable'}
                          <small> de CA commandé par mois</small>
                        </div>
                        <p className="small muted">
                          Dernier résultat · {libelleTest(resume.dernier)} · reçu le{' '}
                          {date(resume.dernier.date)}
                        </p>
                        {resume.evolution.length >= 2 && (
                          <div className="dg-evolution">
                            <div className="dg-label">Évolution · premiers tests</div>
                            <div className="dg-barres">
                              {resume.evolution.map((p) => (
                                <div className="dg-barre" key={p.date}>
                                  <b>{fmtEur(p.vma)}</b>
                                  <span
                                    style={{
                                      height: `${Math.round(
                                        (p.vma / Math.max(...resume.evolution.map((x) => x.vma))) *
                                          100,
                                      )}%`,
                                    }}
                                  />
                                  <small>{date(p.date)}</small>
                                </div>
                              ))}
                            </div>
                            {resume.ecart && (
                              <p className="small">
                                {resume.ecart.euros >= 0 ? '+' : ''}
                                {fmtEur(resume.ecart.euros)} par mois (
                                {resume.ecart.pourcentage >= 0 ? '+' : ''}
                                {resume.ecart.pourcentage} %) depuis le premier test.
                              </p>
                            )}
                          </div>
                        )}
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setTestOuvert(resume.dernier!.id)}
                        >
                          Résultat complet
                        </button>
                      </div>
                    )}
                    {l.tests.length === 0 ? (
                      <p className="small muted">Aucun test pour l’instant.</p>
                    ) : (
                      <ul className="dg-tests">
                        {l.tests.map((t) => (
                          <li key={t.id}>
                            <span>
                              {libelleTest(t)} · {libelleStatut(t)}
                              {t.recueLe ? ` · reçu le ${date(t.recueLe)}` : ''}
                            </span>
                            <span className="dg-actions">
                              {t.statut === 'envoyee' && (
                                <>
                                  <button
                                    className="btn"
                                    type="button"
                                    onClick={() => void navigator.clipboard?.writeText(t.lien)}
                                  >
                                    Copier le lien
                                  </button>
                                  <button
                                    className="btn"
                                    type="button"
                                    onClick={() => void revoquer(t)}
                                  >
                                    Révoquer
                                  </button>
                                </>
                              )}
                              <button
                                className="btn carre danger"
                                aria-label="Supprimer le test"
                                title="Supprimer le test"
                                type="button"
                                onClick={() =>
                                  setSuppression({
                                    titre: 'Supprimer le test',
                                    phrase: `Ce test VMA de ${t.entrepriseNom} sera effacé définitivement${t.statut === 'envoyee' ? ' ; son lien cessera de fonctionner' : ''}.`,
                                    projetIds: [],
                                    testIds: [t.id],
                                  })
                                }
                              >
                                <Icon name="trash" />
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {l.id && (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setModale({ type: 'vma', preselect: l.id! })}
                      >
                        + Nouveau test VMA
                      </button>
                    )}
                  </section>
                  <div className="dg-supprimer-bloc">
                    <button
                      className="btn carre danger"
                      aria-label="Supprimer ce bloc"
                      title="Supprimer ce bloc"
                      type="button"
                      onClick={() => {
                        const projetIds = l.id
                          ? projets.filter((p) => p.entrepriseId === l.id).map((p) => p.id)
                          : l.diag
                            ? [l.diag.id]
                            : [];
                        const testIds = l.tests.map((t) => t.id);
                        setSuppression({
                          titre: 'Supprimer ce bloc',
                          phrase: `${l.nom} : ${listeEffacee(projetIds, testIds)} seront effacés définitivement.${l.id ? ' La fiche de l’entreprise est conservée.' : ''}`,
                          projetIds,
                          testIds,
                        });
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      {suppression && (
        <Modale titre={suppression.titre} onFermer={() => setSuppression(null)}>
          <p>{suppression.phrase}</p>
          <p className="small muted">Cette action est irréversible.</p>
          <div className="dg-actions">
            <button className="btn" type="button" onClick={() => setSuppression(null)}>
              Annuler
            </button>
            <button
              className="btn danger"
              type="button"
              disabled={enCours}
              onClick={() => void confirmerSuppression()}
            >
              Confirmer
            </button>
          </div>
        </Modale>
      )}
      {modale?.type === 'diag' && (
        <NouveauDiagnostic
          slug={slug}
          entreprises={entreprises}
          projets={projets}
          preselect={modale.preselect}
          onFermer={() => setModale(null)}
          onCree={() => {
            setModale(null);
            void charger();
          }}
        />
      )}
      {modale?.type === 'vma' && (
        <NouveauTestVma
          slug={slug}
          entreprises={entreprises}
          preselect={modale.preselect}
          onFermer={() => setModale(null)}
          onCree={() => void charger()}
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
