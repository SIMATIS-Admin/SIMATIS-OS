import { bouton, habillerMail, paragraphe, salutation } from '../mail/gabarit.js';

const AGENDA = 'https://calendar.app.google/ZAAztHjmT4fnKaeC8';

// Accusé de réception du formulaire de contact : même promesse que la page « Merci » du site.
export function mailAccuse(p: { nom: string; objet?: string }): { subject: string; html: string } {
  if (p.objet === 'livre-blanc') {
    return {
      subject: 'Votre livre blanc « Le second cerveau »',
      html: habillerMail(
        `<tr><td style="padding:26px 32px 4px;">${[
          paragraphe(salutation(p.nom)),
          paragraphe(
            'Merci pour votre demande. Vous recevrez le livre blanc « Le second cerveau » sous 24 heures, à cette adresse.',
          ),
          paragraphe(
            'Si vous voulez en parler, vous pouvez réserver directement un créneau dans mon agenda.',
          ),
          bouton('Réserver un créneau', AGENDA),
        ].join('')}</td></tr>`,
      ),
    };
  }
  return {
    subject: 'Votre demande est bien reçue',
    html: habillerMail(
      `<tr><td style="padding:26px 32px 4px;">${[
        paragraphe(salutation(p.nom)),
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
