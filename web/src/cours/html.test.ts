// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { documentSlide, incorporerImages, lireSlideHtml } from './html.js';

describe('lireSlideHtml', () => {
  const SOURCE = `<section id="a" class="s"><h2>Un titre</h2><p>Texte</p>
<aside>Notes du formateur.</aside></section>`;
  it('garde la section sans ses notes, et lit titre et notes', () => {
    const s = lireSlideHtml(SOURCE, 'slides/a.html')!;
    expect(s.titre).toBe('Un titre');
    expect(s.notes).toBe('Notes du formateur.');
    expect(s.html).toContain('<h2>Un titre</h2>');
    expect(s.html).not.toContain('<aside');
  });
  it('prend le nom du fichier si la slide n’a pas de titre, et refuse un fichier sans section', () => {
    expect(lireSlideHtml('<section><p>x</p></section>', 'slides/b.html')!.titre).toBe(
      'slides/b.html',
    );
    expect(lireSlideHtml('<p>pas de section</p>', 'slides/c.html')).toBeNull();
  });
});

describe('incorporerImages', () => {
  it('remplace les images locales par leur contenu, et laisse celles qui manquent', async () => {
    const html =
      '<img src="img/a.png"><img src=\'img/b.png\'><img src="https://exemple.test/x.png">';
    const sortie = await incorporerImages(html, (c) =>
      c === 'img/a.png'
        ? Promise.resolve('data:image/png;base64,AAA')
        : Promise.reject(new Error()),
    );
    expect(sortie).toContain('src="data:image/png;base64,AAA"');
    expect(sortie).toContain("src='img/b.png'");
    expect(sortie).toContain('https://exemple.test/x.png');
  });
});

describe('documentSlide', () => {
  it('assemble la feuille de style, les polices et la slide sur 1920 x 1080', () => {
    const d = documentSlide('<section>x</section>', 'section{color:red}', [
      'https://fonts.googleapis.com/css2?family=Manrope',
    ]);
    expect(d).toContain(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope">',
    );
    expect(d).toContain('section{color:red}');
    expect(d).toContain('width:1920px;height:1080px');
    expect(d).toContain('<body><section>x</section></body>');
  });
  it('ne laisse pas une feuille de style fermer sa balise pour injecter du HTML', () => {
    const d = documentSlide('<section/>', 'a{}</style><script>alert(1)</script>', []);
    expect(d).not.toContain('</style><script>');
  });
});
