import { describe, expect, it, vi } from 'vitest';
import { extraire } from './extraction.js';
import { ErreurSite, type LecteurWeb } from './reseau.js';
import { lireSite } from './lire-site.js';

const page = (corps: string) => `<!doctype html><html><body>${corps}</body></html>`;

describe('extraction des coordonnées d’une page', () => {
  it('trouve le standard, les numéros en lien tel: et en texte, sans les fax', () => {
    const r = extraire(
      page(`
        <a href="tel:+33437250573">Appelez-nous</a>
        <p>Standard : 04 37 25 05 73 — Direct : 04.78.00.11.22</p>
        <p>Fax : 04 78 99 88 77</p>
        <p>Mobile 06 12 34 56 78 ou 0033 4 72 00 00 00</p>`),
      'https://exemple.test/contact',
    );
    expect(r.telephones).toEqual(['+33437250573', '+33478001122', '+33612345678', '+33472000000']);
  });

  it('ne garde que les adresses générales du site, jamais les adresses de personnes', () => {
    const r = extraire(
      page(`
        <a href="mailto:contact@exemple.test">Écrire</a>
        <p>Service client : info@exemple.test</p>
        <p>Jean Dupont : jean.dupont@exemple.test</p>
        <p>Site créé par contact@agence-web.test</p>
        <img src="logo@2x.png">`),
      'https://www.exemple.test/',
    );
    expect(r.emails).toEqual(['contact@exemple.test', 'info@exemple.test']);
  });

  it('accepte les sous-domaines du site et écarte les autres', () => {
    const r = extraire(
      page('<p>contact@mail.exemple.test et contact@exemple.fr</p>'),
      'https://www.exemple.test/',
    );
    expect(r.emails).toEqual(['contact@mail.exemple.test']);
  });

  it('trouve la page LinkedIn de l’entreprise, pas un profil de personne', () => {
    const r = extraire(
      page(`<a href="https://fr.linkedin.com/in/jean-dupont">Jean</a>
            <a href="https://www.linkedin.com/company/Exemple-SAS/?trk=x">LinkedIn</a>`),
      'https://exemple.test/',
    );
    expect(r.linkedin).toBe('https://www.linkedin.com/company/exemple-sas');
    expect(extraire(page('<p>rien</p>'), 'https://exemple.test/').linkedin).toBeNull();
  });

  it('repère les pages de contact et de mentions légales du même site', () => {
    const r = extraire(
      page(`
        <a href="/contact">Contact</a>
        <a href="mentions-legales.html">Mentions légales</a>
        <a href="https://autre.test/contact">Ailleurs</a>
        <a href="/produits">Produits</a>
        <a href="/contact#haut">Contact (haut)</a>
        <a href="mailto:x@exemple.test">Mail</a>`),
      'https://exemple.test/accueil/',
    );
    expect(r.pages).toEqual([
      'https://exemple.test/contact',
      'https://exemple.test/accueil/mentions-legales.html',
    ]);
  });

  it('relève les numéros SIREN annoncés par la page (SIREN, SIRET, RCS)', () => {
    const r = extraire(
      page(
        `<p>SIREN : 123 456 789 — SIRET 123 456 789 00011 — RCS Lyon 987 654 321</p><p>Tél 123 456 789</p>`,
      ),
      'https://exemple.test/',
    );
    expect(r.sirens.sort()).toEqual(['123456789', '987654321']);
  });

  it('supporte une page vide ou mal formée', () => {
    expect(extraire('', 'https://exemple.test/')).toEqual({
      telephones: [],
      emails: [],
      linkedin: null,
      pages: [],
      sirens: [],
    });
    expect(() => extraire('<<<a href=>><p', 'https://exemple.test/')).not.toThrow();
  });
});

describe('lecture d’un site entier', () => {
  const lecteur = (pages: Record<string, string>): LecteurWeb & { appels: string[] } => {
    const appels: string[] = [];
    return {
      appels,
      lire(url) {
        appels.push(url);
        const html = pages[url];
        if (html === undefined)
          return Promise.reject(new ErreurSite('Le site a répondu par une erreur (HTTP 404).'));
        return Promise.resolve({ url, html });
      },
    };
  };

  it('rassemble l’accueil, le contact et les mentions légales, et confirme le site par le SIREN', async () => {
    const l = lecteur({
      'https://exemple.test/': page(
        '<a href="/contact">Contact</a><a href="/mentions-legales">Mentions</a><a href="https://www.linkedin.com/company/exemple">in</a>',
      ),
      'https://exemple.test/contact': page('<p>Standard 04 37 25 05 73 — contact@exemple.test</p>'),
      'https://exemple.test/mentions-legales': page(
        '<p>Société EXEMPLE, SIREN 123 456 789. info@exemple.test</p>',
      ),
    });
    const r = await lireSite(l, 'https://exemple.test/', '123456789');
    expect(r).toEqual({
      url: 'https://exemple.test/',
      telephones: ['+33437250573'],
      emails: ['contact@exemple.test', 'info@exemple.test'],
      linkedin: 'https://www.linkedin.com/company/exemple',
      confirme: true,
      pages: 3,
    });
  });

  it('ne confirme pas un site dont le SIREN diffère ou n’apparaît pas', async () => {
    const accueil = page('<a href="/mentions">Mentions</a>');
    const autre = lecteur({
      'https://exemple.test/': accueil,
      'https://exemple.test/mentions': page('<p>SIREN 999 999 999</p>'),
    });
    expect((await lireSite(autre, 'https://exemple.test/', '123456789')).confirme).toBe(false);
    const sans = lecteur({ 'https://exemple.test/': page('<p>Bonjour</p>') });
    expect((await lireSite(sans, 'https://exemple.test/', '123456789')).confirme).toBe(false);
  });

  it('continue quand une page secondaire est illisible, mais échoue si l’accueil l’est', async () => {
    const l = lecteur({
      'https://exemple.test/': page('<a href="/contact">Contact</a><p>04 37 25 05 73</p>'),
    });
    const r = await lireSite(l, 'https://exemple.test/', '123456789');
    expect(r.telephones).toEqual(['+33437250573']);
    await expect(lireSite(lecteur({}), 'https://exemple.test/', '123456789')).rejects.toThrow(
      ErreurSite,
    );
  });

  it('lit au plus trois pages secondaires et au plus trois numéros et adresses', async () => {
    const liens = Array.from(
      { length: 6 },
      (_, i) => `<a href="/contact-${i}">Contact ${i}</a>`,
    ).join('');
    const pages: Record<string, string> = {
      'https://exemple.test/': page(
        `${liens}<p>01 11 11 11 11 02 22 22 22 22 03 33 33 33 33 04 44 44 44 44</p><p>contact@exemple.test info@exemple.test accueil@exemple.test commercial@exemple.test</p>`,
      ),
    };
    for (let i = 0; i < 6; i++) pages[`https://exemple.test/contact-${i}`] = page('<p>x</p>');
    const l = lecteur(pages);
    const r = await lireSite(l, 'https://exemple.test/', '123456789');
    expect(l.appels).toHaveLength(4);
    expect(r.telephones).toHaveLength(3);
    expect(r.emails).toHaveLength(3);
  });

  it('suit la redirection de l’accueil pour juger les liens et les adresses', async () => {
    const lire = vi.fn((url: string) =>
      Promise.resolve({
        url: url === 'https://exemple.test/' ? 'https://www.exemple.test/accueil' : url,
        html: page('<a href="/contact">Contact</a>contact@exemple.test'),
      }),
    );
    const r = await lireSite({ lire }, 'https://exemple.test/', '123456789');
    expect(r.url).toBe('https://www.exemple.test/accueil');
    expect(r.emails).toEqual(['contact@exemple.test']);
  });
});
