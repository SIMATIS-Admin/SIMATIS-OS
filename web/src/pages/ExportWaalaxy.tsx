import { useEffect, useState } from 'react';
import {
  fetchApercuWaalaxy,
  urlExportWaalaxy,
  type ApercuWaalaxy,
  type FiltresBaseWeb,
} from '../api.js';

const entier = (n: number) => n.toLocaleString('fr-FR');

// Waalaxy ne reçoit que des personnes avec un profil LinkedIn : ce qui reste de côté est dit
// avant le téléchargement, avec sa raison.
export function ExportWaalaxy({ slug, filtres }: { slug: string; filtres: FiltresBaseWeb }) {
  const [apercu, setApercu] = useState<ApercuWaalaxy | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    fetchApercuWaalaxy(slug, filtres).then(
      (a) => actif && setApercu(a),
      (e: unknown) => actif && setErreur(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      actif = false;
    };
  }, [slug, filtres]);

  if (erreur)
    return (
      <p className="error" role="alert">
        {erreur}
      </p>
    );
  if (!apercu) return <p className="muted">Préparation du fichier…</p>;

  const { retenues, parties, ecartees } = apercu;
  const ecartes = [
    ecartees.sansProfil > 0 && `${entier(ecartees.sansProfil)} sans profil LinkedIn`,
    ecartees.opposition > 0 && `${entier(ecartees.opposition)} en opposition`,
    ecartees.exclusion > 0 &&
      `${entier(ecartees.exclusion)} exclu${ecartees.exclusion > 1 ? 's' : ''}`,
    ecartees.alerte > 0 && `${entier(ecartees.alerte)} en procédure ou radiation (BODACC)`,
  ].filter(Boolean);

  return (
    <div className="bv-export-waalaxy">
      {retenues === 0 ? (
        <p>Aucun contact de cette vue n’a de profil LinkedIn à exporter.</p>
      ) : (
        <>
          <p>
            <strong>{entier(retenues)} contacts</strong> prêts pour Waalaxy
            {parties > 1 ? `, répartis en ${parties} fichiers de 10 000 au plus` : ''}.
          </p>
          <ul>
            {Array.from({ length: parties }, (_, i) => (
              <li key={i}>
                <a className="btn" href={urlExportWaalaxy(slug, filtres, i + 1)} download>
                  Télécharger {parties > 1 ? `le fichier ${i + 1}` : 'le fichier'}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {apercu.nonVerifiees > 0 && (
        <p className="small muted">
          {entier(apercu.nonVerifiees)} contacts d’entreprises jamais vérifiées au BODACC :
          vérifiez-les dans l’onglet Entreprises avant d’exporter.
        </p>
      )}
      {ecartes.length > 0 && <p className="small muted">Laissés de côté : {ecartes.join(', ')}.</p>}
      <p className="small muted">
        Dans Waalaxy : Importer, puis « Importer via un fichier CSV ». Associez la colonne « URL
        LinkedIn », puis les autres champs. L’export suit la vue affichée (onglet, filtres,
        recherche).
      </p>
    </div>
  );
}
