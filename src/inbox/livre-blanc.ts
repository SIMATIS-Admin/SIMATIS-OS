import { bouton, echapper, habillerMail, paragraphe, salutation } from '../mail/gabarit.js';
import { AGENDA } from '../site/accuse.js';

// Les livres blancs d'AlpesIA se téléchargent depuis cette page, après un formulaire qui récupère
// les coordonnées du prospect : le mail renvoie là, jamais vers un fichier.
export const PAGE_LIVRES_BLANCS = 'https://alpes-ia.fr/livres-blancs';

export const LIVRES_BLANCS = [
  { numero: 1, titre: 'Tout est dans votre tête. C’est le problème.', sujet: 'le second cerveau' },
  {
    numero: 2,
    titre: 'Vous avez essayé ChatGPT. Et après ?',
    sujet: 'ce que l’IA fait quand on lui confie un travail entier',
  },
] as const;
export type NumeroLivreBlanc = (typeof LIVRES_BLANCS)[number]['numero'];

export const estNumeroLivreBlanc = (n: unknown): n is NumeroLivreBlanc =>
  LIVRES_BLANCS.some((lb) => lb.numero === n);

export type DestinataireLivreBlanc = { email: string; nom: string | null };

// Une entrée Inbox qui demande un livre blanc, et à qui l'envoyer. Les demandes du site portent
// l'adresse dans leur résumé (« Email : … ») ; sans adresse lisible, le bouton n'est pas proposé.
export function destinataireLivreBlanc(
  titre: string,
  resume: string | null,
): DestinataireLivreBlanc | null {
  if (!/livres?\s+blancs?/i.test(titre) || !resume) return null;
  const email = /^Email : (\S+@\S+)\s*$/m.exec(resume)?.[1];
  if (!email) return null;
  const nom = /^Contact : ([^,\n]+)/m.exec(resume)?.[1]?.trim();
  return { email, nom: nom || null };
}

export function mailLivreBlanc(p: { numero: NumeroLivreBlanc; nom: string | null }): {
  subject: string;
  html: string;
} {
  const lb = LIVRES_BLANCS.find((l) => l.numero === p.numero) ?? LIVRES_BLANCS[0];
  return {
    subject: `Votre livre blanc n° ${lb.numero} : « ${lb.titre} »`,
    html: habillerMail(
      `<tr><td style="padding:26px 32px 4px;">${[
        paragraphe(salutation(p.nom)),
        paragraphe(
          `Merci pour votre demande. Voici le livre blanc n° ${lb.numero}, « ${echapper(lb.titre)} » : ${echapper(lb.sujet)}.`,
        ),
        bouton('Télécharger le livre blanc', PAGE_LIVRES_BLANCS),
        paragraphe('Il se télécharge depuis la page des livres blancs, après un court formulaire.'),
        paragraphe(
          'Si vous voulez en parler, vous pouvez réserver directement un créneau dans mon agenda.',
        ),
        bouton('Réserver un créneau', AGENDA),
      ].join('')}</td></tr>`,
    ),
  };
}
