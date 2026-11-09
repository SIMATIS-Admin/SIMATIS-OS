import {
  emailGenerique,
  normaliserLinkedin,
  normaliserTelephone,
} from '../base-vivante/nettoyage.js';

export type Extrait = {
  telephones: string[];
  // Only the general addresses of the company (contact@, info@…): a named person's address is
  // personal data and is never kept.
  emails: string[];
  linkedin: string | null;
  // Contact and legal-notice pages of the same site, worth reading too.
  pages: string[];
  sirens: string[];
};

const unique = <T>(l: T[]): T[] => [...new Set(l)];
const sansBalises = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&');

const TELEPHONE =
  /(?<![\d+])(?:(?:\+|00)\s?33[\s.-]?(?:\(0\)[\s.-]?)?|0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const CONTACT = /contact|mention|legal|propos|qui[-_ ]sommes|nous[-_ ]joindre|societe/i;

const hoteSite = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

export function extraire(html: string, urlPage: string): Extrait {
  const hote = hoteSite(urlPage);
  const texte = sansBalises(html);

  const bruts: string[] = [];
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi))
    bruts.push(decodeURIComponent(m[1] ?? ''));
  for (const m of texte.matchAll(TELEPHONE)) {
    // « Fax : 04 … » is not the switchboard.
    const avant = texte.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    if (!/fax/i.test(avant)) bruts.push(m[0]);
  }
  const telephones = unique(bruts.flatMap((t) => normaliserTelephone(t) ?? []));

  const adresses: string[] = [];
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi))
    adresses.push(decodeURIComponent(m[1] ?? ''));
  adresses.push(...(texte.match(EMAIL) ?? []));
  const emails = unique(
    adresses
      .map((a) => a.trim().toLowerCase())
      .filter((a) => !/\.(png|jpe?g|gif|svg|webp)$/.test(a))
      .filter((a) => emailGenerique(a))
      .filter((a) => {
        const domaine = a.split('@')[1] ?? '';
        return domaine === hote || domaine.endsWith(`.${hote}`);
      }),
  );

  let linkedin: string | null = null;
  for (const m of html.matchAll(/https?:\/\/[a-z.]*linkedin\.com\/company\/[^"'\s<>]+/gi)) {
    linkedin = normaliserLinkedin(m[0]);
    if (linkedin) break;
  }

  const pages: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1] ?? '';
    if (
      /^(mailto|tel|javascript):/i.test(href) ||
      !(CONTACT.test(href) || CONTACT.test(sansBalises(m[2] ?? '')))
    )
      continue;
    try {
      const u = new URL(href, urlPage);
      if (hoteSite(u.toString()) === hote && /^https?:$/.test(u.protocol)) pages.push(u.toString());
    } catch {
      // A broken link is not a page to read.
    }
  }

  const sirens: string[] = [];
  for (const m of texte.matchAll(/(?:SIREN|SIRET|RCS)[^0-9]{0,40}(\d{3}[\s.]?\d{3}[\s.]?\d{3})/gi))
    sirens.push((m[1] ?? '').replace(/\D/g, ''));

  return { telephones, emails, linkedin, pages: unique(pages), sirens: unique(sirens) };
}
