import { useState } from 'react';
import { Icon } from '../icons.js';
import { RechercheStrategie } from './radar/RechercheStrategie.js';

// La porte d'entrée des recherches de suspects. « Selon mon ICP » s'ouvre ici ; les autres entrées
// ouvrent la fenêtre correspondante de la Base des suspects, qui garde les outils.
export function Recherches({ slug }: { slug: string }) {
  const [icp, setIcp] = useState(false);
  const base = `#/${slug}/bases`;
  return (
    <section className="recherches">
      <p className="muted recherches-intro">
        Trouvez de nouveaux suspects, puis vérifiez-les avant qu'ils entrent dans la base.
      </p>
      <div className="recherches-cartes">
        <button
          type="button"
          className={`recherche-carte ${icp ? 'on' : ''}`}
          aria-pressed={icp}
          onClick={() => setIcp(!icp)}
        >
          <Icon name="flag" />
          <b>Selon mon ICP</b>
          <span className="small muted">La cible définie dans l'Atelier stratégique.</span>
        </button>
        <div className="recherche-carte">
          <Icon name="search" />
          <b>Recherche libre</b>
          <span className="small muted">Décrire une cible, ou laisser tourner chaque jour.</span>
          <span className="recherche-liens">
            <a className="link" href={`${base}/ouvrir/entreprises`}>
              Chercher des entreprises
            </a>
            <a className="link" href={`${base}/ouvrir/recherche`}>
              Trouver des contacts
            </a>
            <a className="link" href={`${base}/ouvrir/routine-recherche`}>
              Recherche quotidienne
            </a>
          </span>
        </div>
        <a className="recherche-carte" href={`${base}/ouvrir/import`}>
          <Icon name="db" />
          <b>Importer une liste</b>
          <span className="small muted">Un fichier ou des lignes copiées.</span>
        </a>
      </div>
      {icp && <RechercheStrategie slug={slug} onAjoute={() => undefined} />}
      <p className="recherches-pied">
        <a className="link" href={base}>
          Voir la base des suspects
        </a>
      </p>
    </section>
  );
}
