// Email domains left out of the mirror (suppliers, bank…): the mailbox synced with HubSpot creates
// records for every correspondent, not only prospects.

const DOMAINE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

// Accepts what the pilot pastes: a domain, an address or a link.
export function normaliserDomaine(saisie: string): string | null {
  let d = saisie.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '');
  d = d.slice(d.lastIndexOf('@') + 1).replace(/^www\./, '');
  return DOMAINE.test(d) ? d : null;
}

// `valeur` is an email or a domain; a subdomain of an excluded domain is excluded too.
export function domaineExclu(valeur: string | null | undefined, exclus: string[]): boolean {
  if (!valeur || exclus.length === 0) return false;
  const d = valeur.trim().toLowerCase();
  const domaine = d.slice(d.lastIndexOf('@') + 1);
  return exclus.some((e) => domaine === e || domaine.endsWith(`.${e}`));
}
