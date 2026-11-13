// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from './Markdown.js';

afterEach(cleanup);
const rendu = (source: string) =>
  render(<Markdown source={source} resoudre={(s) => `/deck/${s}`} />).container;

describe('Markdown des supports', () => {
  it('rend titres h3, paragraphes, gras, italique et code en ligne', () => {
    const c = rendu('### Titre\n\nUn **gras**, un *italique* et du `code`.');
    expect(c.querySelector('h3')?.textContent).toBe('Titre');
    expect(c.querySelector('strong')?.textContent).toBe('gras');
    expect(c.querySelector('em')?.textContent).toBe('italique');
    expect(c.querySelector('p code')?.textContent).toBe('code');
  });
  it('rend les listes à puces et numérotées', () => {
    const c = rendu('- un\n- deux\n\n1. premier\n2. second');
    expect(c.querySelectorAll('ul li')).toHaveLength(2);
    expect(c.querySelectorAll('ol li')).toHaveLength(2);
  });
  it('rend un tableau, une citation et un bloc de code', () => {
    const c = rendu(
      '| A | B |\n|---|---|\n| 1 | 2 |\n\n> Une citation\n\n```js\nconst a = 1;\n```',
    );
    expect(c.querySelectorAll('th')).toHaveLength(2);
    expect(c.querySelector('td')?.textContent).toBe('1');
    expect(c.querySelector('blockquote')?.textContent).toBe('Une citation');
    expect(c.querySelector('pre code')?.textContent).toBe('const a = 1;');
  });
  it('résout les images du support', () => {
    expect(rendu('![schéma](img/a.png)').querySelector('img')?.getAttribute('src')).toBe(
      '/deck/img/a.png',
    );
  });
  it('affiche un bloc svg comme image : un script reste inerte', () => {
    const c = rendu(
      '```svg\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n```',
    );
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('img.cours-svg')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });
  it('n interprète pas de HTML brut', () => {
    const c = rendu('<img src=x onerror=alert(1)> et <b>gras</b>');
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('b')).toBeNull();
    expect(c.textContent).toContain('<b>gras</b>');
  });
});
