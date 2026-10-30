export type EnTetes = { name: string; value: string }[];

const valeur = (h: EnTetes, nom: string) =>
  h.find((e) => e.name.toLowerCase() === nom)?.value.trim() ?? null;

// Expéditeurs qui n'attendent aucune réponse, quel que soit le contenu.
const EXPEDITEUR_AUTOMATIQUE =
  /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounces?|alerts?)([+._-].*)?@/i;

// Notification, newsletter ou message d'un robot : un humain n'a pas à y répondre. Les en-têtes
// suffisent (RFC 2369, 3834 et conventions Microsoft), sans lire le contenu.
export function estAutomatique(h: EnTetes, de: string | null): boolean {
  const autoSubmitted = valeur(h, 'auto-submitted');
  const precedence = valeur(h, 'precedence')?.toLowerCase();
  return (
    valeur(h, 'list-unsubscribe') !== null ||
    (autoSubmitted !== null && autoSubmitted.toLowerCase() !== 'no') ||
    (precedence !== undefined && ['bulk', 'list', 'junk'].includes(precedence)) ||
    valeur(h, 'x-auto-response-suppress') !== null ||
    (de !== null && EXPEDITEUR_AUTOMATIQUE.test(de.replace(/^.*<|>$/g, '').trim()))
  );
}

// « Paul <p@x.fr>, q@x.fr » → ['p@x.fr', 'q@x.fr'] (en minuscules).
export function adressesDe(valeurEntete: string | null): string[] {
  return (valeurEntete?.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map((a) => a.toLowerCase());
}
