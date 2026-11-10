import { useEffect, useState } from 'react';
import {
  fetchEntreprises,
  fetchProjetsDiag,
  fetchTestsVma,
  relancerTestVma,
  revoquerTestVma,
  supprimerProjetDiag,
  supprimerTestVma,
  type Entreprise,
  type ProjetDiag,
  type TestVma,
} from '../api.js';
import { ContactsVma } from './diagnostics/ContactsVma.js';
import logoDiagnostic from '../assets/diagnostic-endurance.svg';
import logoSimatis from '../assets/simatis-mark.png';
import logoVma from '../assets/test-vma.svg';
import { Icon } from '../icons.js';
import { ETAPES, ProjetVue } from './Diagnostic.js';
import { ResultatComplet } from './diagnostics/ResultatComplet.js';
import { Modale, NouveauDiagnostic, NouveauTestVma } from './diagnostics/Creation.js';
import { etapesFrise, peutRelancer, sansReponse, testTermine } from './diagnostics/suivi.js';
import { libelleStatut, fmtEur } from './TestsVma.js';
import {
  filtrer,
  grouper,
  lignesSuivies,
  paginer,
  rattacher,
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

const cleDiagArchive = (id: string) => `diag-${id}`;
const cleSuppressions = (slug: string) => `diagnostics.tests-supprimes.${slug}`;

const cleTestArchive = (id: string) => `test-${id}`;
const cleArchives = (slug: string) => `diagnostics.archives.${slug}`;

function lireArchives(slug: string): string[] {
  try {
    const valeur: unknown = JSON.parse(localStorage.getItem(cleArchives(slug)) ?? '[]');
    return Array.isArray(valeur) ? valeur.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// `ouvrir` : identifiant d'un projet à ouvrir directement (lien depuis une fiche).
export function Diagnostics({
  slug,
  ouvrir,
  ouvrirTest,
  onTitre,
}: {
  slug: string;
  ouvrir?: string;
  ouvrirTest?: string;
  // Titre de l'en-tête de l'application : celui de l'outil ouvert, pour ne pas répéter celui de la section.
  onTitre?: (titre: string | null) => void;
}) {
  const [archives, setArchives] = useState(() => lireArchives(slug));
  const [voirArchives, setVoirArchives] = useState(false);

  useEffect(() => {
    setArchives(lireArchives(slug));
    setVoirArchives(false);
  }, [slug]);

  const enregistrerArchives = (suivantes: string[]) => {
    try {
      localStorage.setItem(cleArchives(slug), JSON.stringify(suivantes));
      setArchives(suivantes);
    } catch {
      setErreur('Impossible d’enregistrer les archives dans ce navigateur.');
    }
  };

  const basculerArchive = (cle: string) =>
    enregistrerArchives(
      archives.includes(cle) ? archives.filter((id) => id !== cle) : [...archives, cle],
    );

  const [contactsOuverts, setContactsOuverts] = useState(false);
  const [entreprises, setEntreprises] = useState<Entreprise[] | null>(null);
  const [projets, setProjets] = useState<ProjetDiag[]>([]);
  const [tests, setTests] = useState<TestVma[]>([]);
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [projetOuvert, setProjetOuvert] = useState<string | null>(ouvrir ?? null);
  const [testCible, setTestCible] = useState<string | null>(ouvrirTest ?? null);
  const [testOuvert, setTestOuvert] = useState<string | null>(ouvrirTest ?? null);
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [modale, setModale] = useState<{ type: 'diag' | 'vma'; preselect?: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [suppression, setSuppression] = useState<Suppression | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [relance, setRelance] = useState<{ test: TestVma; tu: boolean } | null>(null);
  const [sansReponseSeul, setSansReponseSeul] = useState(false);

  const charger = async () => {
    try {
      const [e, p, t] = await Promise.all([
        fetchEntreprises(slug, ''),
        fetchProjetsDiag(slug),
        fetchTestsVma(slug),
      ]);
      setEntreprises(e);
      setProjets(rattacher(e, p, (x) => x.nom));
      setTests(rattacher(e, t, (x) => x.entrepriseNom));
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  const titreOuvert = contactsOuverts
    ? 'Contacts'
    : projetOuvert
      ? 'Diagnostic d’endurance commerciale'
      : testOuvert
        ? 'Test de VMA'
        : null;
  useEffect(() => {
    onTitre?.(titreOuvert);
    return () => onTitre?.(null);
  }, [titreOuvert]);

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

  const envoyerRelance = async () => {
    if (!relance) return;
    setEnCours(true);
    try {
      await relancerTestVma(slug, relance.test.id, relance.tu);
      window.dispatchEvent(new Event('console:actualiser'));
      setRelance(null);
      await charger();
    } catch (err) {
      setErreur(messageErreur(err));
      setRelance(null);
    } finally {
      setEnCours(false);
    }
  };

  // Tests d'abord : un test ouvert est révoqué côté site, et s'il échoue rien d'autre n'est effacé.
  const confirmerSuppression = async () => {
    if (!suppression) return;
    setEnCours(true);
    try {
      for (const id of suppression.testIds) {
        const test = tests.find((t) => t.id === id);
        await supprimerTestVma(slug, id);
        if (test) {
          try {
            const cle = cleSuppressions(slug);
            const valeur: unknown = JSON.parse(localStorage.getItem(cle) ?? '[]');
            const precedents: unknown[] = Array.isArray(valeur) ? valeur : [];
            localStorage.setItem(
              cle,
              JSON.stringify([
                ...precedents,
                { id, nom: test.contactNom, entreprise: test.entrepriseNom, date: test.creeLe },
              ]),
            );
          } catch {
            setErreur('Le test a été supprimé, mais sa trace locale n’a pas pu être enregistrée.');
          }
        }
      }
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

  if (contactsOuverts)
    return (
      <ContactsVma
        slug={slug}
        testsSupprimesCle={cleSuppressions(slug)}
        accesTest={(t) => {
          if (!tests.some((test) => test.id === t.id)) return null;
          const archive =
            archives.includes(cleTestArchive(t.id)) ||
            Boolean(t.entrepriseId && archives.includes(t.entrepriseId));
          return {
            archive,
            ouvrir: () => {
              setContactsOuverts(false);
              setVoirArchives(archive);
              setTestCible(t.id);
              setPage(1);
              setRecherche('');
              setSansReponseSeul(false);
              const cible =
                t.entrepriseId && entreprises?.some((e) => e.id === t.entrepriseId)
                  ? t.entrepriseId
                  : `projet-${t.entrepriseNom}`;
              setOuvertes((avant) => new Set([...avant, cible]));
            },
          };
        }}
        onRetour={() => {
          setContactsOuverts(false);
          void charger();
        }}
      />
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
            onChange={(maj) =>
              setProjets((l) =>
                l.map((p) =>
                  p.id === maj.id
                    ? { ...maj, entrepriseId: maj.entrepriseId ?? p.entrepriseId }
                    : p,
                ),
              )
            }
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

  const toutes = lignesSuivies(grouper(entreprises, projets, tests));
  const archivees = new Set(archives);
  const blocProjet = (p: ProjetDiag) =>
    p.entrepriseId && entreprises.some((e) => e.id === p.entrepriseId)
      ? p.entrepriseId
      : `projet-${p.id}`;
  const projetsVisibles = projets.filter((p) =>
    archivees.has(blocProjet(p))
      ? voirArchives
      : archivees.has(cleDiagArchive(p.id)) === voirArchives,
  );
  const testsVisibles = tests.filter((t) =>
    t.entrepriseId && archivees.has(t.entrepriseId)
      ? voirArchives
      : archivees.has(cleTestArchive(t.id)) === voirArchives,
  );
  const lignes = lignesSuivies(grouper(entreprises, projetsVisibles, testsVisibles));
  const cibleSansBloc = testsVisibles.find(
    (t) => t.id === testCible && !entreprises.some((e) => e.id === t.entrepriseId),
  );
  if (cibleSansBloc) {
    lignes.push({ id: null, nom: cibleSansBloc.entrepriseNom, diag: null, tests: [cibleSansBloc] });
  }
  if (voirArchives) {
    const affiches = new Set(lignes.map((l) => l.diag?.id));
    for (const p of projetsVisibles) {
      if (
        affiches.has(p.id) ||
        !archivees.has(cleDiagArchive(p.id)) ||
        archivees.has(blocProjet(p))
      )
        continue;
      lignes.push({ id: null, nom: p.nom, diag: p, tests: [] });
    }
  }
  const nombreArchives = toutes.reduce(
    (total, l) =>
      total +
      (archivees.has(cleDe(l))
        ? 1
        : l.tests.filter((t) => archivees.has(cleTestArchive(t.id))).length),
    projets.filter((p) => !archivees.has(blocProjet(p)) && archivees.has(cleDiagArchive(p.id)))
      .length,
  );

  const apresCreation = (entrepriseId?: string | null) => {
    if (entrepriseId && archivees.has(entrepriseId)) {
      enregistrerArchives([
        ...new Set([
          ...archives.filter((id) => id !== entrepriseId),
          ...projets
            .filter((p) => p.entrepriseId === entrepriseId)
            .map((p) => cleDiagArchive(p.id)),
          ...tests.filter((t) => t.entrepriseId === entrepriseId).map((t) => cleTestArchive(t.id)),
        ]),
      ]);
    }
    setVoirArchives(false);
    setRecherche('');
    setSansReponseSeul(false);
    setPage(1);
    void charger();
  };

  const filtrees = filtrer(lignes, recherche).filter(
    (l) =>
      (!testCible || l.tests.some((t) => t.id === testCible)) &&
      (!sansReponseSeul || l.tests.some((t) => sansReponse(t))),
  );
  const { items, page: pageCourante, pages } = paginer(filtrees, page, PAR_PAGE);

  return (
    <div className="stack dg">
      {alerte}
      <div className="panel dg-titre">
        <div className="panel-h">
          <div className="dg-introduction">
            <span className="dg-kicker">ÉVALUER · COMPRENDRE · AGIR</span>
            <h2>
              {voirArchives ? 'Archives des diagnostics et tests VMA' : 'Diagnostics & tests VMA'}
            </h2>
            <p className="dg-intro">Chaque entreprise avec son diagnostic et ses tests VMA.</p>
          </div>
          <div className="dg-outils">
            {testCible && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setTestCible(null);
                  setContactsOuverts(true);
                }}
              >
                ← Contacts
              </button>
            )}
            <button
              className={voirArchives ? 'btn go' : 'btn'}
              type="button"
              onClick={() => {
                setTestCible(null);
                setVoirArchives(!voirArchives);
                setPage(1);
                setRecherche('');
                setSansReponseSeul(false);
              }}
            >
              {voirArchives ? 'Retour aux blocs actifs' : `Archives (${nombreArchives})`}
            </button>
            <button className="btn" type="button" onClick={() => setContactsOuverts(true)}>
              Contacts
            </button>
            {/* Hors du menu latéral : chaque présentation s'ouvre depuis cette barre. */}
            <a className="btn dg-outil" href={`#/${slug}/presentation-vma`}>
              <img src={logoVma} alt="" />
              Test VMA
            </a>
            <a className="btn dg-outil" href={`#/${slug}/presentation-diagnostic`}>
              <img src={logoDiagnostic} alt="" />
              Diagnostic d’endurance commerciale
            </a>
            <a className="btn dg-outil" href={`#/${slug}/presentation-simatis`}>
              <img src={logoSimatis} alt="" />
              SIMATIS
            </a>
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
          </div>
          <div className="dg-recherche">
            <input
              type="search"
              aria-label="Rechercher une entreprise"
              placeholder="Entreprise, destinataire ou e-mail"
              value={recherche}
              onChange={(e) => {
                setRecherche(e.target.value);
                setPage(1);
              }}
            />
            <label className="dg-filtre small">
              <input
                type="checkbox"
                checked={sansReponseSeul}
                onChange={(e) => {
                  setSansReponseSeul(e.target.checked);
                  setPage(1);
                }}
              />
              <span>Sans réponse depuis plus de 7 jours</span>
            </label>
          </div>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="panel empty">
          {lignes.length === 0
            ? voirArchives
              ? 'Aucun bloc archivé.'
              : 'Aucun bloc actif.'
            : 'Aucune entreprise ne correspond.'}
        </div>
      ) : (
        items.map((l) => {
          const cle = cleDe(l);
          const blocArchive = archivees.has(cle);
          const archivePartielle = voirArchives && !blocArchive;
          const ouverte = ouvertes.has(cle);
          const resume = resumerVma(l.tests);
          const nbRecus = l.tests.filter(testTermine).length;
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
                {(!archivePartielle || l.diag) && (
                  <div>
                    <div className="dg-label">Diagnostic</div>
                    <div className={`dg-compteur ${l.diag ? 'diagnostic' : 'attente'}`}>
                      {l.diag ? `Étape ${l.diag.etapeMax} sur 5` : 'Pas encore lancé'}
                    </div>
                  </div>
                )}
                <div>
                  <div className="dg-label">Tests VMA</div>
                  <div
                    className={`dg-compteur ${nbRecus ? 'recu' : l.tests.length ? 'envoye' : 'attente'}`}
                  >
                    {l.tests.length === 0
                      ? 'Aucun'
                      : `${l.tests.length} test${l.tests.length > 1 ? 's' : ''}${nbRecus ? ` · ${nbRecus} reçu${nbRecus > 1 ? 's' : ''}` : ''}`}
                  </div>
                </div>
                <span className="dg-bascule">{ouverte ? 'Réduire ▴' : 'Détail ▾'}</span>
              </button>

              {ouverte && (
                <div className="dg-detail">
                  {(!archivePartielle || l.diag) && (
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
                          {!blocArchive && (
                            <button
                              className="btn"
                              type="button"
                              onClick={() => basculerArchive(cleDiagArchive(l.diag!.id))}
                            >
                              {voirArchives ? 'Restaurer le diagnostic' : 'Archiver le diagnostic'}
                            </button>
                          )}{' '}
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
                  )}

                  <section className="dg-bloc">
                    <h3>Tests VMA</h3>
                    {resume.dernier && (
                      <div className="dg-resultat">
                        <div className="dg-grand">
                          {resume.dernier.caMensuel != null
                            ? fmtEur(resume.dernier.caMensuel)
                            : resume.dernier.allure != null
                              ? fmtEur(resume.dernier.allure)
                              : resume.dernier.vma != null
                                ? fmtEur(resume.dernier.vma)
                                : 'Non mesurable'}
                          <small>
                            {resume.dernier.caMensuel != null
                              ? ' de chiffre d’affaires par mois'
                              : ' de CA commandé par mois'}
                          </small>
                        </div>
                        {resume.dernier.caMensuel != null && (
                          <p className="small">
                            VMA ponctuelle :{' '}
                            {resume.dernier.vma != null
                              ? fmtEur(resume.dernier.vma)
                              : 'non mesurable'}
                          </p>
                        )}
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
                            {resume.methodesMelangees && (
                              <p className="small muted">
                                Méthodes différentes : la VMA de la méthode 3.0 ne compte plus les
                                nouveaux contrats récurrents. Seuls les résultats d’une même méthode
                                se comparent.
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
                        {l.tests
                          .filter((t) => !testCible || t.id === testCible)
                          .map((t) => (
                            <li key={t.id}>
                              <div className="dg-test-identite">
                                <strong>
                                  {t.contactNom || t.contactEmail || 'Destinataire non renseigné'}
                                </strong>
                                {t.contactNom && t.contactEmail && (
                                  <span className="dg-test-email">{t.contactEmail}</span>
                                )}
                                <span className="small muted">{libelleTest(t)}</span>
                              </div>
                              <span
                                className={`dg-test-statut ${testTermine(t) ? 'termine' : t.statut === 'revoquee' ? 'inactif' : 'en-attente'}`}
                              >
                                {testTermine(t) ? 'Terminé' : libelleStatut(t)}
                              </span>
                              <div
                                className="dg-frise-defilement"
                                role="region"
                                aria-label={`Suivi du test de ${t.contactNom || t.contactEmail || t.entrepriseNom}`}
                                tabIndex={0}
                              >
                                <ol className="frise small">
                                  {etapesFrise(t).map((e) => (
                                    <li
                                      key={e.cle}
                                      className={`${e.atteinte ? 'atteinte' : 'a-venir'} ${e.cle}`}
                                      title={e.detail}
                                    >
                                      <strong>{e.libelle}</strong>
                                      <span>{e.date ?? (e.atteinte ? 'Reçu' : '—')}</span>
                                    </li>
                                  ))}
                                </ol>
                              </div>
                              {t.echecEnvoi && (
                                <span className="small muted">
                                  Dernier envoi en échec : {t.echecEnvoi}
                                </span>
                              )}
                              <span className="dg-actions">
                                {!blocArchive && (
                                  <button
                                    className="btn"
                                    type="button"
                                    onClick={() => basculerArchive(cleTestArchive(t.id))}
                                  >
                                    {voirArchives ? 'Restaurer ce test' : 'Archiver ce test'}
                                  </button>
                                )}
                                {t.statut === 'envoyee' && !testTermine(t) && (
                                  <>
                                    {peutRelancer(t) && (
                                      <button
                                        className="btn"
                                        type="button"
                                        onClick={() => {
                                          setRelance({ test: t, tu: t.tutoiement });
                                        }}
                                      >
                                        Relancer
                                      </button>
                                    )}
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
                                {t.resultat && (
                                  <button
                                    className="btn"
                                    type="button"
                                    onClick={() => setTestOuvert(t.id)}
                                  >
                                    Voir le résultat
                                  </button>
                                )}
                                <button
                                  className="btn carre danger"
                                  aria-label="Supprimer le test"
                                  title="Supprimer le test"
                                  type="button"
                                  onClick={() =>
                                    setSuppression({
                                      titre: 'Supprimer le test',
                                      phrase: `Ce test VMA de ${t.entrepriseNom} sera effacé définitivement${t.statut === 'envoyee' && !testTermine(t) ? ' ; son lien cessera de fonctionner' : ''}.`,
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
                  {voirArchives && l.id && (
                    <div className="dg-supprimer-bloc dg-actions">
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setModale({ type: 'diag', preselect: l.id! })}
                      >
                        + Nouveau diagnostic
                      </button>
                    </div>
                  )}
                  {!archivePartielle && !cibleSansBloc && (
                    <div className="dg-supprimer-bloc dg-actions">
                      <button className="btn" type="button" onClick={() => basculerArchive(cle)}>
                        {voirArchives ? 'Restaurer ce bloc' : 'Archiver ce bloc'}
                      </button>
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
                          const testIds = toutes
                            .find((ligne) => cleDe(ligne) === cle)!
                            .tests.map((t) => t.id);
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
                  )}
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
      {relance && (
        <Modale titre="Relancer l’invitation" onFermer={() => setRelance(null)}>
          <p>
            Un court rappel part à {relance.test.contactNom ?? relance.test.entrepriseNom} (
            {relance.test.contactEmail}), avec le même lien.
          </p>
          <label className="dg-filtre">
            <input
              type="checkbox"
              checked={relance.tu}
              onChange={(e) => setRelance({ ...relance, tu: e.target.checked })}
            />
            <span>Tutoyer pour cette relance</span>
          </label>
          <div className="dg-actions">
            <button className="btn" type="button" onClick={() => setRelance(null)}>
              Annuler
            </button>
            <button
              className="btn go"
              type="button"
              disabled={enCours}
              onClick={() => void envoyerRelance()}
            >
              Envoyer la relance
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
          onCree={(entrepriseId) => {
            setModale(null);
            apresCreation(entrepriseId);
          }}
        />
      )}
      {modale?.type === 'vma' && (
        <NouveauTestVma
          slug={slug}
          entreprises={entreprises}
          preselect={modale.preselect}
          onFermer={() => setModale(null)}
          onCree={apresCreation}
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
