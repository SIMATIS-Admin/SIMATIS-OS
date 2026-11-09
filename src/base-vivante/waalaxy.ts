import type { Executor } from '../db.js';
import { emailGenerique } from './nettoyage.js';
import { cellule, listerFiches, type FiltresBase } from './service.js';

// Waalaxy ne documente ni séparateur ni encodage : virgule et UTF-8 sans BOM, et ses colonnes
// se rattachent une à une à ses champs à l'import. Seule l'URL de profil est obligatoire.
export const COLONNES_WAALAXY = [
  'URL LinkedIn',
  'Prénom',
  'Nom',
  'Intitulé du poste',
  'Nom de l’entreprise',
  'Email',
] as const;
const SEPARATEUR = ',';

// Waalaxy recommande au plus 10 000 prospects par fichier.
export const LIGNES_PAR_FICHIER = 10_000;

// Un prospect Waalaxy est une personne : une page entreprise (/company/) n'en est pas une.
const PROFIL = /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\/[^ /]+/i;

export type ApercuWaalaxy = {
  retenues: number;
  parties: number;
  ecartees: { opposition: number; exclusion: number; sansProfil: number };
};

// Même règle que le reste de l'OS : une opposition ou une exclusion n'est jamais contactée,
// quel que soit le canal.
export async function exporterWaalaxy(
  db: Executor,
  instanceId: string,
  filtres: FiltresBase = {},
  partie = 1,
  taille = LIGNES_PAR_FICHIER,
): Promise<{ csv: string; apercu: ApercuWaalaxy }> {
  const retenues: string[] = [];
  const vus = new Set<string>();
  const ecartees = { opposition: 0, exclusion: 0, sansProfil: 0 };
  for (let decalage = 0; ; decalage += 200) {
    const { fiches } = await listerFiches(db, instanceId, { ...filtres, limite: 200, decalage });
    if (fiches.length === 0) break;
    for (const f of fiches) {
      if (f.opposition) ecartees.opposition++;
      else if (f.exclusion) ecartees.exclusion++;
      else if (!f.linkedin || !PROFIL.test(f.linkedin)) ecartees.sansProfil++;
      else if (!vus.has(f.linkedin)) {
        vus.add(f.linkedin);
        const email = f.email && !f.emailInvalide && !emailGenerique(f.email) ? f.email : null;
        retenues.push(
          [f.linkedin, f.prenom, f.nom, f.fonction, f.entreprise, email]
            .map((v) => cellule(v, SEPARATEUR))
            .join(SEPARATEUR),
        );
      }
    }
  }
  const parties = Math.max(1, Math.ceil(retenues.length / taille));
  const debut = (Math.max(1, partie) - 1) * taille;
  const corps = retenues.slice(debut, debut + taille);
  return {
    csv: `${[COLONNES_WAALAXY.join(SEPARATEUR), ...corps].join('\r\n')}\r\n`,
    apercu: { retenues: retenues.length, parties, ecartees },
  };
}
