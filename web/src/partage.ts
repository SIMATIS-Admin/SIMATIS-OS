import type { NoeudCerveau } from './cerveau.js';

// Espace partagé AlpesIA × Simatis : les messages (echanges/) se lisent par conversation, comme une
// boîte mail ; les autres notes sont des documents rangés par dossier.

export type Fil = {
  // Chemin du premier message de la conversation.
  id: string;
  sujet: string;
  messages: NoeudCerveau[];
  // Question de l'autre sans réponse : c'est à vous de répondre.
  aRepondre: boolean;
  // Question de vous sans réponse : c'est à l'autre.
  enAttente: boolean;
};

const estEchange = (n: NoeudCerveau) => n.categorie === 'echanges';

export function fils(noeuds: NoeudCerveau[], moi: string | null | undefined): Fil[] {
  const messages = noeuds.filter(estEchange);
  const parId = new Map(messages.map((m) => [m.id, m]));
  const repondues = new Set(messages.flatMap((m) => (m.reponseA ? [m.reponseA] : [])));
  // Remonte les « en réponse à » jusqu'au premier message ; sur un cycle, le plus ancien l'emporte.
  const racine = (m: NoeudCerveau) => {
    const vus = new Set<string>();
    let courant = m;
    while (!vus.has(courant.id)) {
      vus.add(courant.id);
      const parent = courant.reponseA ? parId.get(courant.reponseA) : undefined;
      if (!parent) return courant.id;
      courant = parent;
    }
    return [...vus].sort()[0] as string;
  };
  const groupes = new Map<string, NoeudCerveau[]>();
  for (const m of messages) groupes.set(racine(m), [...(groupes.get(racine(m)) ?? []), m]);
  return [...groupes.entries()]
    .map(([id, ms]) => {
      const tri = ms.sort((a, b) => a.id.localeCompare(b.id));
      const sansReponse = tri.filter((m) => m.genre === 'question' && !repondues.has(m.id));
      return {
        id,
        sujet: (parId.get(id) ?? tri[0])?.titre.replace(/^Re\s*:\s*/i, '') ?? id,
        messages: tri,
        // Sans savoir qui consulte, on ne peut pas dire à qui revient la réponse.
        aRepondre: !!moi && sansReponse.some((m) => !!m.auteur && m.auteur !== moi),
        enAttente: !!moi && sansReponse.some((m) => m.auteur === moi),
      };
    })
    .sort((a, b) => (b.messages.at(-1)?.id ?? '').localeCompare(a.messages.at(-1)?.id ?? ''));
}

// Dossier d'un document : reference/ (Christophe), prospection/ (Marc), racine.
export const documents = (noeuds: NoeudCerveau[]) =>
  noeuds.filter((n) => !estEchange(n)).sort((a, b) => a.id.localeCompare(b.id));

// Texte d'un message sans son en-tête (de, date, type, sujet…).
export const sansEntete = (texte: string) => texte.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();

export const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
