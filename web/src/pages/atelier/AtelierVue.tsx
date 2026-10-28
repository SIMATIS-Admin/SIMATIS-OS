import type { EtatAtelier } from './etat.js';

// Provisoire : remplacé par l'atelier complet à la tâche suivante du plan.
export function AtelierVue({
  atelier,
  essai,
  onRetour,
}: {
  slug: string;
  atelier: { id: string; titre: string; entrepriseNom: string } | null;
  etatInitial: EtatAtelier;
  essai: boolean;
  onRetour: () => void;
  onTitre?: (titre: string | null) => void;
}) {
  return (
    <div className="stack">
      <button className="btn" type="button" onClick={onRetour}>
        ← Ateliers
      </button>
      <p>{essai ? 'Module d’essai' : atelier?.titre}</p>
    </div>
  );
}
