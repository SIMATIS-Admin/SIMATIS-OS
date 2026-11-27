import { useEffect, useState } from 'react';
import { operationCerveau } from '../api.js';
import type { FichierPartage } from '../cerveau.js';
import {
  dateLisible,
  dossierLisible,
  extension,
  famille,
  grouper,
  nomFichier,
  nomLisible,
  tailleLisible,
  typeMime,
  type Famille,
  type Tri,
} from '../fichiersPartages.js';
import { Icon } from '../icons.js';
import { PagePdf } from '../shell/PagePdf.js';
import { chargerPdf, type DocPdf } from '../shell/pdf.js';

const details = (f: FichierPartage) =>
  [tailleLisible(f.taille), f.auteur, dateLisible(f.modifie)].filter(Boolean).join(' · ');

function Type({ chemin }: { chemin: string }) {
  return <span className={`pf-type ${famille(chemin)}`}>{extension(chemin) || '?'}</span>;
}

const FILTRES: [Famille | 'tous', string][] = [
  ['tous', 'Tous'],
  ['pdf', 'PDF'],
  ['image', 'Images'],
  ['autre', 'Autres'],
];

export function ListeFichiers({
  fichiers,
  requete,
  choix,
  onChoisir,
}: {
  fichiers: FichierPartage[];
  requete: string;
  choix: string | null;
  onChoisir: (chemin: string) => void;
}) {
  const [filtre, setFiltre] = useState<Famille | 'tous'>('tous');
  const [tri, setTri] = useState<Tri>('dossier');
  const trouves = fichiers.filter(
    (f) =>
      !requete ||
      f.chemin.toLowerCase().includes(requete) ||
      nomLisible(f.chemin).toLowerCase().includes(requete),
  );
  const affiches = trouves.filter((f) => filtre === 'tous' || famille(f.chemin) === filtre);
  return (
    <>
      <div className="pb-liste-entete">
        <div>
          <h2>Fichiers</h2>
          <span>
            {affiches.length} fichier{affiches.length > 1 ? 's' : ''}
          </span>
        </div>
        <div className="pf-outils">
          <div className="pf-filtres">
            {FILTRES.map(([id, libelle]) => {
              const nb =
                id === 'tous'
                  ? trouves.length
                  : trouves.filter((f) => famille(f.chemin) === id).length;
              return (
                <button
                  key={id}
                  className={filtre === id ? 'on' : ''}
                  aria-pressed={filtre === id}
                  onClick={() => setFiltre(id)}
                >
                  {libelle} <b>{nb}</b>
                </button>
              );
            })}
          </div>
          <select aria-label="Trier" value={tri} onChange={(e) => setTri(e.target.value as Tri)}>
            <option value="dossier">Par dossier</option>
            <option value="date">Plus récents</option>
          </select>
        </div>
      </div>
      {affiches.length === 0 && (
        <p className="cerveau-note">
          {fichiers.length ? 'Aucun fichier ne correspond.' : 'Aucun autre fichier.'}
        </p>
      )}
      {affiches.length > 0 &&
        grouper(affiches, tri).map((g) => (
          <div key={g.titre}>
            <h3 className="pf-groupe">{g.titre}</h3>
            {g.fichiers.map((f) => (
              <button
                key={f.chemin}
                data-testid="fichier"
                title={f.chemin}
                className={f.chemin === choix ? 'pb-ligne pf-ligne on' : 'pb-ligne pf-ligne'}
                onClick={() => onChoisir(f.chemin)}
              >
                <Type chemin={f.chemin} />
                <span className="pf-texte">
                  <span className="pb-sujet">{nomLisible(f.chemin)}</span>
                  <span className="cerveau-note">
                    {tri === 'date' ? `${dossierLisible(f.chemin)} · ` : ''}
                    {details(f)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
    </>
  );
}

// Fichiers déjà reçus : rouvrir un aperçu est immédiat. La date fait partie de la clé, un fichier
// remplacé par l'autre est donc relu.
const recus = new Map<string, Uint8Array<ArrayBuffer>>();
const octets = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
const TEXTES = ['txt', 'csv', 'json', 'yaml', 'yml'];

function ApercuPdf({ url }: { url: string }) {
  const [doc, setDoc] = useState<DocPdf | null>(null);
  const [page, setPage] = useState(1);
  const [illisible, setIllisible] = useState(false);
  useEffect(() => {
    let vivant = true;
    chargerPdf(url).then(
      (d) => vivant && setDoc(d),
      () => vivant && setIllisible(true),
    );
    return () => {
      vivant = false;
    };
  }, [url]);
  if (illisible)
    return <p className="empty">Aperçu impossible : téléchargez le fichier pour l’ouvrir.</p>;
  if (!doc) return <p className="empty">Préparation de l’aperçu…</p>;
  return (
    <>
      <div className="pf-pages">
        <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Page précédente
        </button>
        <span className="cerveau-note">
          Page {page} sur {doc.numPages}
        </span>
        <button
          className="btn sm"
          disabled={page >= doc.numPages}
          onClick={() => setPage(page + 1)}
        >
          Page suivante
        </button>
      </div>
      <PagePdf key={page} doc={doc} n={page} actif />
    </>
  );
}

export function ApercuFichier({
  slug,
  fichier,
  lienKdrive,
  onRetour,
}: {
  slug: string;
  fichier: FichierPartage;
  lienKdrive: string | null | undefined;
  onRetour: () => void;
}) {
  const { chemin } = fichier;
  const cle = `${slug}|${chemin}|${fichier.modifie}`;
  const [donnees, setDonnees] = useState(() => recus.get(cle) ?? null);
  const [urls, setUrls] = useState<{ apercu: string; copie: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    if (donnees) return;
    let vivant = true;
    setErreur(null);
    operationCerveau(slug, { espace: 'partage', type: 'telecharger', chemin }).then(
      (r) => {
        const lus = octets(r.base64 ?? '');
        recus.set(cle, lus);
        if (vivant) setDonnees(lus);
      },
      (e: unknown) => vivant && setErreur(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      vivant = false;
    };
  }, [slug, chemin, cle, donnees, essai]);

  useEffect(() => {
    if (!donnees) return;
    // La copie à enregistrer reste un fichier brut : un SVG ou une page web venus de l'autre côté ne
    // s'ouvrent jamais comme une page de l'OS.
    const suite = {
      apercu: URL.createObjectURL(new Blob([donnees], { type: typeMime(chemin) })),
      copie: URL.createObjectURL(new Blob([donnees], { type: 'application/octet-stream' })),
    };
    setUrls(suite);
    return () => {
      URL.revokeObjectURL(suite.apercu);
      URL.revokeObjectURL(suite.copie);
    };
  }, [donnees, chemin]);

  const ext = extension(chemin);
  const apercu = () => {
    if (!urls || !donnees) return null;
    if (famille(chemin) === 'pdf') return <ApercuPdf url={urls.apercu} />;
    if (famille(chemin) === 'image')
      return (
        <div className="pf-image">
          <img src={urls.apercu} alt={nomLisible(chemin)} />
        </div>
      );
    if (ext === 'html' || ext === 'htm')
      return (
        <iframe
          className="pf-web"
          title={nomLisible(chemin)}
          sandbox=""
          srcDoc={new TextDecoder().decode(donnees)}
        />
      );
    if (TEXTES.includes(ext))
      return <pre className="pf-code">{new TextDecoder().decode(donnees)}</pre>;
    return <p className="empty">Pas d’aperçu pour ce type de fichier : téléchargez-le.</p>;
  };

  return (
    <div className="pf-apercu">
      <button className="btn sm pb-retour" onClick={onRetour}>
        ← Retour à la liste
      </button>
      <div className="pf-entete">
        <div>
          <h3>{nomLisible(chemin)}</h3>
          <p className="cerveau-note">{details(fichier)}</p>
          <code>{chemin}</code>
        </div>
        <div className="cerveau-actions">
          {urls && (
            <a className="btn primary" href={urls.copie} download={nomFichier(chemin)}>
              <Icon name="download" />
              Télécharger
            </a>
          )}
          {lienKdrive && (
            <a className="btn" href={lienKdrive} target="_blank" rel="noopener noreferrer">
              Dossier kDrive
            </a>
          )}
        </div>
      </div>
      {erreur ? (
        <div className="empty" role="alert">
          {erreur}{' '}
          <button className="btn" onClick={() => setEssai((n) => n + 1)}>
            Réessayer
          </button>
        </div>
      ) : donnees ? (
        apercu()
      ) : (
        <p className="empty">
          Chargement{fichier.taille ? ` de ${tailleLisible(fichier.taille)}` : ''}…
        </p>
      )}
    </div>
  );
}
