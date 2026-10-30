import { useCallback, useEffect, useRef, useState } from 'react';
import {
  annulerImportBase,
  completerLigneBase,
  creerImportBase,
  actualiserHistoriqueBase,
  fetchBase,
  fetchImportBase,
  fetchReponsesBase,
  integrerImportBase,
  reglerCorrespondanceBase,
  urlExportBase,
  type ReponseBase,
  type ResumeImportBase,
  type ChampBase,
  type EtatBase,
  type FiltresBaseWeb,
  type ImportBase,
  type LigneImportBase,
  type StatutLigneBase,
  type ZoneBase,
} from '../api.js';
import { Icon } from '../icons.js';
import { BaseTable } from './BaseTable.js';
import { Fenetre } from './Fenetre.js';
import { RapprochementMail } from './RapprochementMail.js';
import { ReponsesBase } from './ReponsesBase.js';

const CHAMPS: [ChampBase, string][] = [
  ['entreprise', 'Entreprise'],
  ['nomComplet', 'Prénom et nom ensemble'],
  ['prenom', 'Prénom'],
  ['nom', 'Nom'],
  ['civilite', 'Civilité'],
  ['email', 'Email'],
  ['telephone', 'Téléphone'],
  ['portable', 'Portable'],
  ['fonction', 'Fonction'],
  ['linkedin', 'LinkedIn'],
];

const ONGLETS_LIGNES: [StatutLigneBase, string][] = [
  ['pret', 'Prêtes'],
  ['sous_minimum', 'Sous le minimum'],
  ['doublon_interne', 'Doublons du fichier'],
];

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const entier = (n: number) => n.toLocaleString('fr-FR');

const lireBase64 = (fichier: File) =>
  new Promise<string>((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () =>
      resolve(typeof lecteur.result === 'string' ? (lecteur.result.split(',')[1] ?? '') : '');
    lecteur.onerror = () => reject(new Error('Fichier illisible'));
    lecteur.readAsDataURL(fichier);
  });

const libelleZone = (zone: ZoneBase | null) =>
  zone === 'prospectable' ? (
    <span className="badge green">Prospectable</span>
  ) : zone === 'a_enrichir' ? (
    <span className="badge amber">À enrichir</span>
  ) : null;

const nomAffiche = (f: LigneImportBase['fiche']) =>
  [f.civilite && !f.civiliteDeduite ? f.civilite : null, f.prenom, f.nom]
    .filter(Boolean)
    .join(' ') || '—';

function Depot({ slug, onCrees }: { slug: string; onCrees: (imports: ImportBase[]) => void }) {
  const [provenance, setProvenance] = useState('');
  const [mandat, setMandat] = useState('');
  const [texte, setTexte] = useState('');
  const [fichier, setFichier] = useState<File | null>(null);
  const [encours, setEncours] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lire = async () => {
    setError(null);
    if (!provenance.trim()) return setError('Indiquez la source de la liste (Sharp, LinkedIn…).');
    if (!fichier && !texte.trim()) return setError('Choisissez un fichier ou collez des lignes.');
    setEncours(true);
    try {
      const imports = await creerImportBase(slug, {
        nomFichier: fichier?.name ?? 'Texte collé',
        ...(fichier ? { contenuBase64: await lireBase64(fichier) } : { texte }),
        provenance: provenance.trim(),
        ...(mandat.trim() ? { mandat: mandat.trim() } : {}),
      });
      setFichier(null);
      setTexte('');
      onCrees(imports);
    } catch (e) {
      setError(message(e));
    } finally {
      setEncours(false);
    }
  };

  return (
    <div className="stack">
      <div>
        <div className="grid g2">
          <label className="field">
            <span>Source de la liste</span>
            <input
              className="input"
              value={provenance}
              placeholder="Sharp, LinkedIn, salon…"
              onChange={(e) => setProvenance(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Mandat (facultatif)</span>
            <input className="input" value={mandat} onChange={(e) => setMandat(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Fichier Excel (.xlsx) ou CSV</span>
          <input
            type="file"
            accept=".xlsx,.csv,.txt,text/csv"
            aria-label="Fichier à importer"
            onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          />
        </label>
        {!fichier && (
          <label className="field">
            <span>Ou collez les lignes copiées depuis un tableur</span>
            <textarea className="input" value={texte} onChange={(e) => setTexte(e.target.value)} />
          </label>
        )}
        {error && (
          <div className="alert amber">
            <Icon name="info" />
            <div>{error}</div>
          </div>
        )}
        <button className="btn primary" disabled={encours} onClick={() => void lire()}>
          {encours ? 'Lecture en cours…' : 'Lire la liste'}
        </button>
      </div>
    </div>
  );
}

function CompleterLigne({
  ligne,
  onCompleter,
}: {
  ligne: LigneImportBase;
  onCompleter: (champs: { entreprise?: string; nom?: string }) => Promise<void>;
}) {
  const [entreprise, setEntreprise] = useState('');
  const [nom, setNom] = useState('');
  return (
    <span className="completer">
      {!ligne.fiche.entreprise && (
        <input
          className="input"
          aria-label={`Entreprise de la ligne ${ligne.numero}`}
          placeholder="Entreprise"
          value={entreprise}
          onChange={(e) => setEntreprise(e.target.value)}
        />
      )}
      {!ligne.fiche.nom && (
        <input
          className="input"
          aria-label={`Nom de la ligne ${ligne.numero}`}
          placeholder="Nom"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
        />
      )}
      <button
        className="btn sm"
        disabled={!entreprise.trim() && !nom.trim()}
        onClick={() => void onCompleter({ entreprise, nom })}
      >
        Compléter
      </button>
    </span>
  );
}

function ApercuImport({
  slug,
  initial,
  etape,
  onEtape,
  onTermine,
  onRafraichir,
}: {
  slug: string;
  initial: ImportBase;
  etape: 2 | 3;
  onEtape: (e: 1 | 2 | 3) => void;
  onTermine: () => void;
  onRafraichir: () => void;
}) {
  const [imp, setImp] = useState(initial);
  const [onglet, setOnglet] = useState<StatutLigneBase>('pret');
  const [error, setError] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const c = imp.compteurs;

  const agir = async (f: () => Promise<void>) => {
    setError(null);
    setOccupe(true);
    try {
      await f();
    } catch (e) {
      setError(message(e));
    } finally {
      setOccupe(false);
    }
  };

  const recharger = (statut: StatutLigneBase) =>
    fetchImportBase(slug, imp.id, statut).then((i) => {
      setImp(i);
      setOnglet(statut);
    });

  const colonneDe = (index: number): ChampBase | '' =>
    CHAMPS.find(([champ]) => imp.correspondance[champ] === index)?.[0] ?? '';

  // Columns that carry something come first; the ignored ones follow, in file order.
  const ordre = imp.entetes
    .map((_, i) => i)
    .sort((a, b) => Number(colonneDe(a) === '') - Number(colonneDe(b) === '') || a - b);

  const changerColonne = (index: number, champ: ChampBase | '') =>
    agir(async () => {
      const demande: Record<string, number | null> = {};
      for (const [k] of CHAMPS) {
        const i = imp.correspondance[k];
        if (i !== undefined && i !== index) demande[k] = i;
      }
      if (champ) demande[champ] = index;
      setImp(await reglerCorrespondanceBase(slug, imp.id, demande));
      setOnglet('pret');
    });

  // Lines left under the minimum stay available here to be completed and integrated later.
  const integrer = () =>
    agir(async () => {
      await integrerImportBase(slug, imp.id);
      const frais = await fetchImportBase(slug, imp.id, 'sous_minimum');
      if (frais.compteurs.sousMinimum === 0) return onTermine();
      setImp(frais);
      setOnglet('sous_minimum');
      onRafraichir();
    });

  const annuler = () =>
    agir(async () => {
      await annulerImportBase(slug, imp.id);
      onTermine();
    });

  return (
    <div>
      <div>
        <strong>
          {imp.nomFichier}
          {imp.feuille !== 'Fichier' && imp.feuille !== imp.nomFichier && ` · ${imp.feuille}`}
        </strong>
        <div className="small muted">
          Source : {imp.provenance}
          {imp.mandat ? ` · mandat ${imp.mandat}` : ''} · {entier(c.total)} lignes lues
        </div>
      </div>
      <div className="stack">
        {etape === 3 && (
          <div className="chips" aria-label="Résultat de la lecture">
            <span className="badge green">{entier(c.prospectables)} prospectables</span>
            <span className="badge amber">{entier(c.aEnrichir)} à enrichir</span>
            <span className="badge red">{entier(c.sousMinimum)} sous le minimum</span>
            <span className="badge">{entier(c.doublonsInternes)} doublons du fichier</span>
          </div>
        )}

        {etape === 2 && (
          <div>
            <p className="small muted">
              {entier(ordre.filter((i) => colonneDe(i)).length)} colonnes reconnues sur{' '}
              {entier(imp.entetes.length)}. Corrigez celles que j'ai mal comprises : les colonnes
              ignorées ne sont pas importées.
            </p>
            <div className="mapping-scroll">
              <table className="tbl small mapping">
                <thead>
                  <tr>
                    {ordre.map((i) => (
                      <th key={i} className={colonneDe(i) ? 'retenue' : 'ignoree'}>
                        {imp.entetes[i] || `Colonne ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {ordre.map((i) => (
                      <th key={i} className={colonneDe(i) ? 'retenue' : 'ignoree'}>
                        <select
                          className="input"
                          aria-label={`Contenu de la colonne ${imp.entetes[i] || i + 1}`}
                          value={colonneDe(i)}
                          disabled={occupe}
                          onChange={(e) => void changerColonne(i, e.target.value as ChampBase | '')}
                        >
                          <option value="">Ignorée</option>
                          {CHAMPS.map(([champ, libelle]) => (
                            <option key={champ} value={champ}>
                              {libelle}
                            </option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {imp.echantillon.map((ligne, k) => (
                    <tr key={k}>
                      {ordre.map((i) => (
                        <td key={i} className={colonneDe(i) ? '' : 'ignoree'} title={ligne[i]}>
                          {ligne[i] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {etape === 3 && (
          <div>
            <div className="chips">
              {ONGLETS_LIGNES.map(([statut, libelle]) => (
                <button
                  key={statut}
                  className={`chip ${onglet === statut ? 'on' : ''}`}
                  onClick={() => void agir(() => recharger(statut))}
                >
                  {libelle}
                </button>
              ))}
            </div>
            <table className="tbl small">
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Entreprise</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Téléphone</th>
                  <th>{onglet === 'pret' ? 'Zone' : 'Raison'}</th>
                </tr>
              </thead>
              <tbody>
                {imp.lignes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Aucune ligne.
                    </td>
                  </tr>
                )}
                {imp.lignes.map((l) => (
                  <tr key={l.numero}>
                    <td className="num">{l.numero}</td>
                    <td>{l.fiche.entreprise ?? '—'}</td>
                    <td>
                      {nomAffiche(l.fiche)}
                      {l.fiche.civiliteDeduite && l.fiche.civilite && (
                        <span className="small muted"> ({l.fiche.civilite} déduit)</span>
                      )}
                    </td>
                    <td>{l.fiche.email ?? '—'}</td>
                    <td>{l.fiche.telephone ?? '—'}</td>
                    <td>
                      {onglet === 'pret' ? libelleZone(l.zone) : l.raison}
                      {l.avertissements.map((a) => (
                        <div key={a} className="small muted">
                          {a}
                        </div>
                      ))}
                      {l.alertes.map((a) => (
                        <div key={a}>
                          <span className="badge amber">{a}</span>
                        </div>
                      ))}
                      {onglet === 'sous_minimum' && (
                        <CompleterLigne
                          ligne={l}
                          onCompleter={(champs) =>
                            agir(async () => {
                              await completerLigneBase(slug, imp.id, l.numero, champs);
                              await recharger('sous_minimum');
                            })
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">
              Les 40 premières lignes de chaque catégorie sont affichées.
            </p>
          </div>
        )}

        {error && (
          <div className="alert amber">
            <Icon name="info" />
            <div>{error}</div>
          </div>
        )}
        <div className="bv-actions">
          {etape === 2 ? (
            <button className="btn primary" disabled={occupe} onClick={() => onEtape(3)}>
              Continuer
            </button>
          ) : (
            <>
              <button
                className="btn primary"
                disabled={occupe || c.prospectables + c.aEnrichir === 0}
                onClick={() => void integrer()}
              >
                Intégrer {entier(c.prospectables + c.aEnrichir)} fiches à la base
              </button>
              <button className="btn ghost" disabled={occupe} onClick={() => onEtape(2)}>
                Retour aux colonnes
              </button>
            </>
          )}
          <button className="btn ghost" disabled={occupe} onClick={() => void annuler()}>
            Annuler l'import
          </button>
          {etape === 3 && c.sousMinimum > 0 && (
            <span className="small muted">
              Les {entier(c.sousMinimum)} lignes sous le minimum restent de côté, à compléter plus
              tard.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const ETAPES_IMPORT = ['Déposer', 'Vérifier les colonnes', 'Intégrer'];

function FenetreImport({
  slug,
  apercus,
  integres,
  etapeDepart,
  onCrees,
  onTermine,
  onRafraichir,
  onFermer,
}: {
  slug: string;
  apercus: ImportBase[];
  integres: ResumeImportBase[];
  etapeDepart: 1 | 2 | 3;
  onCrees: (imports: ImportBase[]) => void;
  onTermine: (id: string) => void;
  onRafraichir: () => void;
  onFermer: () => void;
}) {
  const [etape, setEtape] = useState<1 | 2 | 3>(apercus.length > 0 ? etapeDepart : 1);
  const courant = apercus[0];
  // Nothing left to validate: the window goes back to the drop zone.
  const vue = courant ? etape : 1;

  return (
    <Fenetre
      titre="Importer une liste"
      sousTitre="Excel, CSV ou lignes collées, colonnes dans n'importe quel ordre. Rien n'entre dans la base avant votre validation."
      onFermer={onFermer}
    >
      <ol className="bv-pas" aria-label="Étapes de l'import">
        {ETAPES_IMPORT.map((libelle, i) => (
          <li key={libelle} className={i + 1 <= vue ? 'ok' : ''} aria-current={i + 1 === vue}>
            {i + 1}. {libelle}
          </li>
        ))}
      </ol>
      {vue === 1 || !courant ? (
        <div className="stack">
          <Depot
            slug={slug}
            onCrees={(imports) => {
              onCrees(imports);
              setEtape(2);
            }}
          />
          {integres.length > 0 && (
            <details>
              <summary>Imports déjà intégrés ({integres.length})</summary>
              <table className="tbl small">
                <thead>
                  <tr>
                    <th>Fichier</th>
                    <th>Source</th>
                    <th>Date</th>
                    <th className="r">Créées</th>
                    <th className="r">Fusionnées</th>
                    <th className="r">Restées de côté</th>
                  </tr>
                </thead>
                <tbody>
                  {integres.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.nomFichier}
                        {i.feuille !== 'Fichier' && i.feuille !== i.nomFichier && ` · ${i.feuille}`}
                      </td>
                      <td>{i.provenance}</td>
                      <td>{new Date(i.creeLe).toLocaleDateString('fr-FR')}</td>
                      <td className="r num">{entier(i.rapport?.creees ?? 0)}</td>
                      <td className="r num">{entier(i.rapport?.fusionnees ?? 0)}</td>
                      <td className="r num">{entier(i.compteurs.sousMinimum)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      ) : (
        <ApercuImport
          key={courant.id}
          slug={slug}
          initial={courant}
          etape={vue}
          onEtape={setEtape}
          onTermine={() => {
            onTermine(courant.id);
            setEtape(2);
          }}
          onRafraichir={onRafraichir}
        />
      )}
    </Fenetre>
  );
}

type Fenetres = null | { quoi: 'import'; etape: 1 | 2 | 3 } | { quoi: 'mail' } | { quoi: 'triage' };

export function Bases({ slug }: { slug: string }) {
  const [etat, setEtat] = useState<EtatBase | null>(null);
  const [apercus, setApercus] = useState<ImportBase[]>([]);
  const [filtres, setFiltres] = useState<FiltresBaseWeb>({});
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fenetre, setFenetre] = useState<Fenetres>(null);
  const [reponses, setReponses] = useState<{ aValider: ReponseBase[]; aClasser: number }>({
    aValider: [],
    aClasser: 0,
  });
  const recherche = useRef<HTMLInputElement>(null);
  // Closed previews: the list may still hold them until it is read again.
  const termines = useRef(new Set<string>());

  const charger = useCallback(
    () =>
      fetchBase(slug, filtres, page).then(
        (e) => {
          setEtat(e);
          setError(null);
        },
        (e: unknown) => setError(message(e)),
      ),
    [slug, filtres, page],
  );
  useEffect(() => void charger(), [charger]);

  const chargerReponses = useCallback(
    () => fetchReponsesBase(slug).then(setReponses, () => undefined),
    [slug],
  );
  useEffect(() => void chargerReponses(), [chargerReponses]);

  // « / » jumps to the search box, like in most list tools.
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key !== '/' || (e.target as HTMLElement).matches?.('input, select, textarea')) return;
      e.preventDefault();
      recherche.current?.focus();
    };
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, []);

  // Imports left waiting for validation come back after a reload.
  useEffect(() => {
    if (!etat) return;
    const attente = etat.imports.filter(
      (i) => i.statut === 'apercu' || i.compteurs.sousMinimum > 0,
    );
    const connus = new Set(apercus.map((a) => a.id));
    const manquants = attente.filter((i) => !connus.has(i.id) && !termines.current.has(i.id));
    if (manquants.length === 0) return;
    void Promise.all(manquants.map((i) => fetchImportBase(slug, i.id))).then((liste) =>
      setApercus((avant) => [...avant, ...liste.filter((l) => !avant.some((a) => a.id === l.id))]),
    );
  }, [etat, apercus, slug]);

  if (error && !etat) return <div className="empty">{error}</div>;
  if (!etat) return null;

  const terminer = (id: string) => {
    termines.current.add(id);
    setApercus((avant) => avant.filter((a) => a.id !== id));
    void charger();
  };
  const integres = etat.imports.filter((i) => i.statut === 'integre');
  const total = etat.compteurs.aEnrichir + etat.compteurs.prospectable;
  const fermer = () => {
    setFenetre(null);
    void charger();
    void chargerReponses();
  };
  const actualiser = () => {
    setInfo(null);
    actualiserHistoriqueBase(slug).then(
      (r) => {
        setInfo(
          `${entier(r.verifiees)} adresses vérifiées dans les CRM, ${entier(r.trouvees)} déjà connues.`,
        );
        void charger();
      },
      (e: unknown) => setInfo(message(e)),
    );
  };
  const taches = [
    ...apercus.map((a) => (
      <button
        key={a.id}
        className="bv-tache"
        onClick={() => setFenetre({ quoi: 'import', etape: 3 })}
      >
        Valider l'import « {a.nomFichier} » ({entier(a.compteurs.total)} lignes)
      </button>
    )),
    ...(reponses.aValider.length > 0
      ? [
          <button key="triage" className="bv-tache" onClick={() => setFenetre({ quoi: 'triage' })}>
            Classer {entier(reponses.aValider.length)} réponse
            {reponses.aValider.length > 1 ? 's' : ''}
          </button>,
        ]
      : []),
    ...(etat.compteurs.aEnrichir > 0
      ? [
          <button
            key="enrichir"
            className="bv-tache"
            onClick={() => {
              setFiltres({ zone: 'a_enrichir' });
              setPage(0);
            }}
          >
            {entier(etat.compteurs.aEnrichir)} fiches sans contact à enrichir
          </button>,
        ]
      : []),
  ];

  return (
    <div className="bv">
      <div className="bv-tete">
        <p className="muted">
          Toutes vos listes de prospection au même endroit, propres et sans doublons.
          {total > 0 &&
            ` ${entier(total)} fiches : ${entier(etat.compteurs.prospectable)} prospectables, ${entier(etat.compteurs.aEnrichir)} à enrichir.`}
        </p>
        <div className="bv-actions">
          <input
            ref={recherche}
            className="input bv-recherche"
            type="search"
            aria-label="Rechercher dans la base"
            placeholder="Entreprise, nom, email…   ( / )"
            value={filtres.q ?? ''}
            onChange={(e) => {
              setFiltres({ ...filtres, q: e.target.value });
              setPage(0);
            }}
          />
          <button className="btn" onClick={() => setFenetre({ quoi: 'mail' })}>
            Mettre à jour depuis les mails
          </button>
          <details className="bv-menu">
            <summary className="btn">Autres actions</summary>
            <div className="bv-menu-liste">
              <button className="btn ghost" disabled={total === 0} onClick={actualiser}>
                Actualiser l'historique
              </button>
              <a className="btn ghost" href={urlExportBase(slug, filtres)} download>
                Exporter en CSV
              </a>
            </div>
          </details>
          <button className="btn primary" onClick={() => setFenetre({ quoi: 'import', etape: 1 })}>
            + Importer une liste
          </button>
        </div>
      </div>

      {total > 0 && (
        <div
          className="bv-barre"
          role="img"
          aria-label={`${entier(etat.compteurs.prospectable)} prospectables, ${entier(etat.compteurs.aEnrichir)} à enrichir`}
        >
          <i className="prospectable" style={{ flex: etat.compteurs.prospectable }} />
          <i className="a-enrichir" style={{ flex: etat.compteurs.aEnrichir }} />
        </div>
      )}
      {info && <div className="small muted">{info}</div>}

      {taches.length > 0 && (
        <div className="bv-afaire" aria-label="À faire">
          <span className="small muted">À faire</span>
          {taches}
        </div>
      )}
      {reponses.aClasser > 0 && reponses.aValider.length === 0 && (
        <div className="small muted">
          {entier(reponses.aClasser)} réponse{reponses.aClasser > 1 ? 's' : ''} attend
          {reponses.aClasser > 1 ? 'ent' : ''} la routine « Base vivante ».
        </div>
      )}

      <BaseTable
        slug={slug}
        etat={etat}
        filtres={filtres}
        onFiltres={setFiltres}
        page={page}
        onPage={setPage}
        onChange={() => void charger()}
        onImporter={() => setFenetre({ quoi: 'import', etape: 1 })}
      />

      {fenetre?.quoi === 'import' && (
        <FenetreImport
          slug={slug}
          apercus={apercus}
          integres={integres}
          etapeDepart={fenetre.etape}
          onCrees={(imports) => {
            setApercus((avant) => [...avant, ...imports]);
            void charger();
          }}
          onTermine={terminer}
          onRafraichir={() => void charger()}
          onFermer={fermer}
        />
      )}
      {fenetre?.quoi === 'mail' && (
        <Fenetre
          titre="Mettre à jour depuis les mails"
          sousTitre="Lit la boîte Gmail d'un mandat, en lecture seule, depuis le début du mandat : met à jour le dernier contact, les réponses et les adresses en erreur de chaque fiche."
          onFermer={fermer}
        >
          <RapprochementMail slug={slug} onTermine={() => void charger()} />
        </Fenetre>
      )}
      {fenetre?.quoi === 'triage' && (
        <Fenetre titre="Classer les réponses" onFermer={fermer}>
          <ReponsesBase
            slug={slug}
            aValider={reponses.aValider}
            aClasser={reponses.aClasser}
            onChange={() => {
              void chargerReponses();
              void charger();
            }}
          />
        </Fenetre>
      )}
    </div>
  );
}
