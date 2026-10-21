import { bouton, echapper, habillerMail, paragraphe } from '../mail/gabarit.js';

const AGENDA = 'https://calendar.app.google/ZAAztHjmT4fnKaeC8';

// Accusé de réception du formulaire de contact : même promesse que la page « Merci » du site.
export function mailAccuse(p: { nom: string }): { subject: string; html: string } {
  return {
    subject: 'Votre demande est bien reçue',
    html: habillerMail(
      `<tr><td style="padding:26px 32px 4px;">${[
        paragraphe(`Bonjour ${echapper(p.nom)},`),
        paragraphe(
          'Merci pour votre demande, elle est bien reçue. Je reviens vers vous sous 48 heures ouvrées.',
        ),
        paragraphe(
          'Pour aller plus vite, vous pouvez réserver directement un créneau dans mon agenda.',
        ),
        bouton('Réserver un créneau', AGENDA),
      ].join('')}</td></tr>`,
    ),
  };
}
