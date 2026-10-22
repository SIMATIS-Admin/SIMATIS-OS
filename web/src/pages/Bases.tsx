import { useCallback, useEffect, useRef, useState } from 'react';
import {
  annulerImportBase,
  completerLigneBase,
  creerImportBase,
  fetchBase,
  fetchImportBase,
  integrerImportBase,
  reglerCorrespondanceBase,
  type ChampBase,
  type EtatBase,
  type ImportBase,
  type LigneImportBase,
  type StatutLigneBase,
  type ZoneBase,
} from '../api.js';
import { Icon } from '../icons.js';

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

const PAR_PAGE = 50;

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
    <div className="panel">
      <div className="panel-h">
        <div>
          <h2>Importer une liste</h2>
          <div className="small muted">
            Excel, CSV ou lignes collées, colonnes dans n'importe quel ordre. Rien n'entre dans la
            base avant votre validation.
          </div>
        </div>
      </div>
      <div className="panel-b">
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
  onTermine,
  onRafraichir,
}: {
  slug: string;
  initial: ImportBase;
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
    <div className="panel">
      <div className="panel-h">
        <div>
          <h2>
            {imp.nomFichier}
            {imp.feuille !== 'Fichier' && imp.feuille !== imp.nomFichier && ` · ${imp.feuille}`}
          </h2>
          <div className="small muted">
            Source : {imp.provenance}
            {imp.mandat ? ` · mandat ${imp.mandat}` : ''} · {entier(c.total)} lignes lues
          </div>
        </div>
      </div>
      <div className="panel-b stack">
        <div className="chips" aria-label="Résultat de la lecture">
          <span className="badge green">{entier(c.prospectables)} prospectables</span>
          <span className="badge amber">{entier(c.aEnrichir)} à enrichir</span>
          <span className="badge red">{entier(c.sousMinimum)} sous le minimum</span>
          <span className="badge">{entier(c.doublonsInternes)} doublons du fichier</span>
        </div>

        <details open>
          <summary>Colonnes du fichier</summary>
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
        </details>

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
          <p className="small muted">Les 40 premières lignes de chaque catégorie sont affichées.</p>
        </div>

        {error && (
          <div className="alert amber">
            <Icon name="info" />
            <div>{error}</div>
          </div>
        )}
        <div>
          <button
            className="btn primary"
            disabled={occupe || c.prospectables + c.aEnrichir === 0}
            onClick={() => void integrer()}
          >
            Intégrer {entier(c.prospectables + c.aEnrichir)} fiches à la base
          </button>{' '}
          <button className="btn ghost" disabled={occupe} onClick={() => void annuler()}>
            Annuler l'import
          </button>
          {c.sousMinimum > 0 && (
            <span className="small muted">
              {' '}
              Les {entier(c.sousMinimum)} lignes sous le minimum restent dans le sas.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function Bases({ slug }: { slug: string }) {
  const [etat, setEtat] = useState<EtatBase | null>(null);
  const [apercus, setApercus] = useState<ImportBase[]>([]);
  const [zone, setZone] = useState<ZoneBase | undefined>();
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Closed previews: the list may still hold them until it is read again.
  const termines = useRef(new Set<string>());

  const charger = useCallback(
    () =>
      fetchBase(slug, zone, recherche, page).then(
        (e) => {
          setEtat(e);
          setError(null);
        },
        (e: unknown) => setError(message(e)),
      ),
    [slug, zone, recherche, page],
  );
  useEffect(() => void charger(), [charger]);

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

  const total = etat.compteurs.aEnrichir + etat.compteurs.prospectable;
  const terminer = (id: string) => {
    termines.current.add(id);
    setApercus((avant) => avant.filter((a) => a.id !== id));
    void charger();
  };
  const integres = etat.imports.filter((i) => i.statut === 'integre');

  return (
    <div className="stack">
      <Depot
        slug={slug}
        onCrees={(imports) => {
          setApercus((avant) => [...avant, ...imports]);
          void charger();
        }}
      />

      {apercus.map((a) => (
        <ApercuImport
          key={a.id}
          slug={slug}
          initial={a}
          onTermine={() => terminer(a.id)}
          onRafraichir={() => void charger()}
        />
      ))}

      <div className="panel">
        <div className="panel-h">
          <div>
            <h2>Base vivante</h2>
            <div className="small muted">
              {entier(total)} fiches : {entier(etat.compteurs.prospectable)} prospectables,{' '}
              {entier(etat.compteurs.aEnrichir)} à enrichir. Une fiche à enrichir n'entre jamais
              dans un CRM.
            </div>
          </div>
        </div>
        <div className="panel-b">
          <div className="chips">
            {(
              [
                [undefined, 'Toutes'],
                ['prospectable', 'Prospectables'],
                ['a_enrichir', 'À enrichir'],
              ] as const
            ).map(([z, libelle]) => (
              <button
                key={libelle}
                className={`chip ${zone === z ? 'on' : ''}`}
                onClick={() => {
                  setZone(z);
                  setPage(0);
                }}
              >
                {libelle}
              </button>
            ))}
            <input
              className="input"
              style={{ maxWidth: 260 }}
              aria-label="Rechercher dans la base"
              placeholder="Entreprise, nom, email…"
              value={recherche}
              onChange={(e) => {
                setRecherche(e.target.value);
                setPage(0);
              }}
            />
          </div>
          {etat.fiches.length === 0 ? (
            <div className="empty">
              {total === 0
                ? 'La base est vide : importez une première liste.'
                : 'Aucune fiche ne correspond.'}
            </div>
          ) : (
            <table className="tbl small">
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Contact</th>
                  <th>Fonction</th>
                  <th>Email</th>
                  <th>Téléphone</th>
                  <th>Zone</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {etat.fiches.map((f) => (
                  <tr key={f.id}>
                    <td>{f.entreprise}</td>
                    <td>{[f.prenom, f.nom].filter(Boolean).join(' ')}</td>
                    <td>{f.fonction ?? '—'}</td>
                    <td>{f.email ?? '—'}</td>
                    <td>{f.telephone ?? '—'}</td>
                    <td>{libelleZone(f.zone)}</td>
                    <td>
                      {f.provenance}
                      {f.mandat && <div className="small muted">{f.mandat}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {etat.total > PAR_PAGE && (
            <div className="chips">
              <button
                className="btn sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Précédent
              </button>
              <span className="small muted">
                {entier(page * PAR_PAGE + 1)}–{entier(Math.min(etat.total, (page + 1) * PAR_PAGE))}{' '}
                sur {entier(etat.total)}
              </span>
              <button
                className="btn sm"
                disabled={(page + 1) * PAR_PAGE >= etat.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </button>
            </div>
          )}
        </div>
      </div>

      {integres.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <h2>Imports déjà intégrés</h2>
          </div>
          <div className="panel-b">
            <table className="tbl small">
              <thead>
                <tr>
                  <th>Fichier</th>
                  <th>Source</th>
                  <th>Date</th>
                  <th className="r">Créées</th>
                  <th className="r">Fusionnées</th>
                  <th className="r">Restées dans le sas</th>
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
          </div>
        </div>
      )}
    </div>
  );
}
