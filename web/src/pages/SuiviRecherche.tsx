import { ProgressionRecherche } from './ProgressionRecherche.js';
import { useState } from 'react';
import { useRecherche } from './useRecherche.js';
import { RechercheProspects } from './RechercheProspects.js';

export function SuiviRecherche({ slug }: { slug: string }) {
  const { tache } = useRecherche(slug);
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      {tache && (
        <div className="recherche-suivi" role="status">
          <span>
            {tache.etat === 'en_cours'
              ? 'Recherche de prospects en cours…'
              : tache.etat === 'terminee'
                ? `Recherche terminée · ${tache.contacts?.length ?? 0} contact(s)`
                : tache.etat === 'a_completer'
                  ? 'Recherche à compléter'
                  : 'La recherche a échoué'}
          </span>
          <ProgressionRecherche tache={tache} />
          <button className="btn sm" onClick={() => setOuvert(true)}>
            {tache.etat === 'terminee' ? 'Voir les résultats' : 'Voir le suivi'}
          </button>
        </div>
      )}
      {ouvert && (
        <RechercheProspects
          slug={slug}
          fermer={() => setOuvert(false)}
          termine={() => {
            setOuvert(false);
            window.dispatchEvent(new Event('recherche-importee'));
          }}
        />
      )}
    </>
  );
}
