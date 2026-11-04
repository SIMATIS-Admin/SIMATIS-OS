import type { RechercheEnCours } from '../api.js';

export function ProgressionRecherche({ tache }: { tache: RechercheEnCours }) {
  const trouves = tache.contacts?.length ?? 0;
  return (
    <div className="recherche-progression">
      <progress aria-label="Contacts vérifiés" value={trouves} max={tache.nombre} />
      <span>
        {trouves} / {tache.nombre} contacts vérifiés
        {tache.etat === 'en_cours' ? ` · Recherche ${tache.passage ?? 1} en cours…` : ''}
      </span>
    </div>
  );
}
