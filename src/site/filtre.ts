import type { DemandeSite } from './releve.js';

// Domaines d'e-mail sans rapport avec une entreprise française : suffixes de registres souvent
// utilisés pour des envois automatisés, et services d'adresses jetables.
const SUFFIXES_SUSPECTS = ['.my.id', '.web.id', '.biz.id', '.ru', '.xyz', '.top', '.click'];
const DOMAINES_JETABLES = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'yopmail.com',
  'tempmail.com',
  '10minutemail.com',
  'trashmail.com',
]);

// Un lien dans le message ou les noms : la forme de phishing la plus courante via un formulaire.
const LIEN =
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|online|site|xyz|top|click|link|app|io|ru)\/\S*/i;

// Combien d'accusés de réception au plus par passage de relevé : un afflux de demandes ne doit pas
// faire envoyer des dizaines de mails depuis la messagerie de Marc.
export const ACCUSES_MAX_PAR_RELEVE = 5;

export type VerdictDemande = { ok: boolean; raisons: string[] };

function domaineDe(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

// Contrôles côté OS, après ceux du site : ils décident seulement si l'accusé de réception part. La
// demande, même suspecte, reste dans l'Inbox (marquée), pour ne perdre aucun vrai prospect.
export function evaluerDemande(d: DemandeSite): VerdictDemande {
  const raisons: string[] = [];
  const domaine = domaineDe(d.email);

  if (SUFFIXES_SUSPECTS.some((s) => domaine.endsWith(s))) {
    raisons.push(`domaine e-mail inhabituel (${domaine})`);
  }
  if (DOMAINES_JETABLES.has(domaine)) raisons.push(`adresse jetable (${domaine})`);
  if (d.message && LIEN.test(d.message)) raisons.push('lien dans le message');
  if (LIEN.test(d.nom) || LIEN.test(d.entreprise)) raisons.push('lien dans le nom ou l’entreprise');

  return { ok: raisons.length === 0, raisons };
}
