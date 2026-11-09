import { extraire } from './extraction.js';
import { ErreurSite, type LecteurWeb } from './reseau.js';

export type SiteLu = {
  // Address of the home page once redirections are followed.
  url: string;
  telephones: string[];
  emails: string[];
  linkedin: string | null;
  // True when the site's legal notices quote the company's SIREN: it is really its site.
  confirme: boolean;
  pages: number;
};

const MAX_PAGES_SECONDAIRES = 3;
const MAX_VALEURS = 3;

// Reads the home page, then its contact and legal-notice pages, and gathers the company's
// switchboard, general e-mail addresses and LinkedIn page. Only the home page has to answer.
export async function lireSite(
  lecteur: LecteurWeb,
  depart: string,
  siren: string,
): Promise<SiteLu> {
  const accueil = await lecteur.lire(depart);
  const extraits = [extraire(accueil.html, accueil.url)];
  let lues = 1;
  for (const adresse of extraits[0]?.pages.slice(0, MAX_PAGES_SECONDAIRES) ?? []) {
    try {
      const p = await lecteur.lire(adresse);
      extraits.push(extraire(p.html, p.url));
      lues++;
    } catch (e) {
      if (!(e instanceof ErreurSite)) throw e;
    }
  }
  const tous = <T>(f: (e: (typeof extraits)[number]) => T[]): T[] => [
    ...new Set(extraits.flatMap(f)),
  ];
  return {
    url: accueil.url,
    telephones: tous((e) => e.telephones).slice(0, MAX_VALEURS),
    emails: tous((e) => e.emails).slice(0, MAX_VALEURS),
    linkedin: extraits.find((e) => e.linkedin)?.linkedin ?? null,
    confirme: tous((e) => e.sirens).includes(siren),
    pages: lues,
  };
}
