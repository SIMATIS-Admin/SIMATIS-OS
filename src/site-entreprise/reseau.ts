import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ReadableStreamReadResult } from 'node:stream/web';

// Lecture de pages web publiques (le site d'une entreprise). Le serveur tourne chez le pilote,
// sur son réseau : une adresse mal choisie ne doit jamais lui faire lire son routeur, ses
// services locaux ou un service de métadonnées. Chaque adresse, y compris celle d'une
// redirection, est donc résolue puis refusée si elle est privée.
export class ErreurSite extends Error {}

const MAX_OCTETS = 600_000;
const MAX_REDIRECTIONS = 4;
// ASCII only: an HTTP header cannot carry a typographic apostrophe.
const AGENT = 'SIMATIS-OS/1.0 (lecture des pages de contact des entreprises)';

export function adressePrivee(ip: string): boolean {
  const v6 = ip.toLowerCase();
  const mappee = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mappee?.[1]) return adressePrivee(mappee[1]);
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
  }
  return true;
}

export type PageLue = { url: string; html: string };
export type LecteurWeb = { lire(url: string): Promise<PageLue> };

type FetchSite = (
  url: string,
  init: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
) => Promise<Response>;

// Minimal robots.txt: the rules of `User-agent: *`, longest matching rule wins, Allow beats
// Disallow on a tie.
function autorise(robots: string, chemin: string): boolean {
  let groupe = false;
  const regles: { permis: boolean; motif: string }[] = [];
  for (const brute of robots.split(/\r?\n/)) {
    const ligne = brute.replace(/#.*/, '').trim();
    const [cle, ...reste] = ligne.split(':');
    const valeur = reste.join(':').trim();
    const k = (cle ?? '').toLowerCase();
    if (k === 'user-agent') groupe = valeur === '*' || valeur.toLowerCase().includes('simatis');
    else if (groupe && (k === 'disallow' || k === 'allow') && valeur)
      regles.push({ permis: k === 'allow', motif: valeur });
  }
  let meilleure: { permis: boolean; motif: string } | null = null;
  for (const r of regles) {
    if (!chemin.startsWith(r.motif.replace(/\*$/, ''))) continue;
    if (
      !meilleure ||
      r.motif.length > meilleure.motif.length ||
      (r.motif.length === meilleure.motif.length && r.permis)
    )
      meilleure = r;
  }
  return meilleure?.permis ?? true;
}

export function creerLecteurWeb({
  fetchFn = fetch,
  resoudre = async (hote: string) => (await lookup(hote, { all: true })).map((a) => a.address),
  delaiMs = 8000,
}: {
  fetchFn?: FetchSite;
  resoudre?: (hote: string) => Promise<string[]>;
  delaiMs?: number;
} = {}): LecteurWeb {
  const verifier = async (brute: string): Promise<URL> => {
    let u: URL;
    try {
      u = new URL(brute);
    } catch {
      throw new ErreurSite('Adresse de site invalide.');
    }
    if (
      !['http:', 'https:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      (u.port && u.port !== '80' && u.port !== '443')
    )
      throw new ErreurSite(
        'Adresse de site invalide : une adresse web (http ou https) est attendue.',
      );
    const hote = u.hostname.replace(/^\[|\]$/g, '');
    let adresses: string[];
    if (isIP(hote)) adresses = [hote];
    else {
      try {
        adresses = await resoudre(hote);
      } catch {
        adresses = [];
      }
      if (adresses.length === 0) throw new ErreurSite(`Site introuvable : ${hote}.`);
    }
    if (adresses.some(adressePrivee))
      throw new ErreurSite('Adresse refusée : elle mène au réseau privé de cette machine.');
    return u;
  };

  const appeler = async (url: string): Promise<Response> => {
    const stop = new AbortController();
    const minuteur = setTimeout(() => stop.abort(), delaiMs);
    try {
      return await fetchFn(url, {
        headers: {
          'user-agent': AGENT,
          accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5',
        },
        redirect: 'manual',
        signal: stop.signal,
      });
    } catch {
      throw new ErreurSite('Le site ne répond pas.');
    } finally {
      clearTimeout(minuteur);
    }
  };

  const lireTexte = async (res: Response): Promise<string> => {
    const lecteur = res.body?.getReader();
    if (!lecteur) return (await res.text()).slice(0, MAX_OCTETS);
    const morceaux: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_OCTETS) {
      const { done, value } = (await lecteur.read()) as ReadableStreamReadResult<Uint8Array>;
      if (done) break;
      morceaux.push(value);
      total += value.length;
    }
    await lecteur.cancel().catch(() => undefined);
    return new TextDecoder().decode(Buffer.concat(morceaux)).slice(0, MAX_OCTETS);
  };

  const robotsAutorise = async (u: URL): Promise<boolean> => {
    try {
      const res = await appeler(`${u.origin}/robots.txt`);
      if (!res.ok) return true;
      return autorise(await lireTexte(res), u.pathname + u.search);
    } catch {
      return true;
    }
  };

  return {
    async lire(depart) {
      let u = await verifier(depart);
      if (!(await robotsAutorise(u)))
        throw new ErreurSite('Le site demande aux robots de ne pas lire cette page (robots.txt).');
      for (let saut = 0; saut <= MAX_REDIRECTIONS; saut++) {
        const res = await appeler(u.toString());
        if (res.status >= 300 && res.status < 400) {
          const vers = res.headers.get('location');
          if (!vers) throw new ErreurSite('Redirection sans destination.');
          if (saut === MAX_REDIRECTIONS) break;
          u = await verifier(new URL(vers, u).toString());
          continue;
        }
        if (!res.ok) throw new ErreurSite(`Le site a répondu par une erreur (HTTP ${res.status}).`);
        if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? ''))
          throw new ErreurSite('Ce n’est pas une page web.');
        return { url: u.toString(), html: await lireTexte(res) };
      }
      throw new ErreurSite('Trop de redirections.');
    },
  };
}
