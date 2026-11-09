import { randomUUID } from 'node:crypto';
import { ErreurIA, type ClientIA, type DemandeIA } from './client.js';

export function fileCodex() {
  const travaux = new Map<
    string,
    { demande: DemandeIA; finir: (resultat: unknown, ok: boolean) => void; pris: boolean }
  >();
  const client: ClientIA = {
    demander(demande) {
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const delai = setTimeout(() => {
          travaux.delete(id);
          reject(new ErreurIA('Le programme Codex local n’a pas répondu.', true));
        }, 600_000);
        travaux.set(id, {
          demande,
          pris: false,
          finir(resultat, ok) {
            clearTimeout(delai);
            travaux.delete(id);
            if (ok) resolve({ json: resultat, jetons: 0 });
            else reject(new ErreurIA('La recherche Codex a échoué sur le Mac.', true));
          },
        });
      });
    },
  };
  return {
    client,
    prendre() {
      for (const [id, travail] of travaux) {
        if (travail.pris) continue;
        travail.pris = true;
        return { id, demande: travail.demande };
      }
      return null;
    },
    finir(id: string, resultat: unknown, ok: boolean) {
      const travail = travaux.get(id);
      if (travail?.pris) travail.finir(resultat, ok);
    },
  };
}
