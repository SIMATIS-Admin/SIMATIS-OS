import type { Executor } from '../db.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import type { ProjetVue } from './service.js';
import type { Projet } from './schema.js';

// Pré-requis du rapport : le résultat de l'étape 2 et la revue validée à l'étape 3.
export function rapportPret(
  projet: Pick<Projet, 'dims' | 'revue'>,
): { ok: true } | { ok: false; raison: string } {
  if (!projet.dims) return { ok: false, raison: "Saisissez d'abord le résultat à l'étape 2." };
  if (projet.revue?.statut !== 'validée')
    return { ok: false, raison: "Validez d'abord la revue à l'étape 3." };
  return { ok: true };
}

// Le pilote demande le rapport à l'étape 4 : le runner le rédige, puis Claude enregistre son lien.
export function demanderRapport(db: Executor, instance: Instance, id: string): Promise<ProjetVue> {
  return envoyerMessage(
    db,
    instance,
    id,
    'Rédige le rapport du projet à partir de la revue validée.',
    {
      type: 'rapport',
      etape: 4,
      maj: { rapportLienStatut: 'en_cours' },
      verifier: (projet) => {
        const pret = rapportPret(projet);
        if (!pret.ok) throw new ChatIndisponible(pret.raison);
        if (projet.rapportLienStatut === 'en_cours')
          throw new ChatIndisponible('Un rapport est déjà en cours de rédaction.');
      },
    },
  );
}
