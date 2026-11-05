import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { texteDuDocx } from './docx-texte.js';
import { contenuRapportFictif } from './fixtures/rapport-fictif.js';
import { genererRapportWord } from './rapport-word.js';

describe('texteDuDocx', () => {
  it('lit le texte d un Word produit par l OS', () => {
    const texte = texteDuDocx(genererRapportWord(contenuRapportFictif));
    expect(texte).toContain('Atelier Fictif Nord');
    expect(texte).toContain('Installer la feuille de route.');
  });

  it('sépare les paragraphes par un saut de ligne et décode les entités', () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Un &amp; deux</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Trois &lt;test&gt;</w:t></w:r></w:p></w:body></w:document>';
    const docx = zipSync({ 'word/document.xml': strToU8(xml) });
    expect(texteDuDocx(docx)).toBe('Un & deux\nTrois <test>');
  });

  it('renvoie null pour un fichier qui n est pas un zip', () => {
    expect(texteDuDocx(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('renvoie null pour un zip sans corps de document', () => {
    expect(texteDuDocx(zipSync({ 'autre.txt': strToU8('x') }))).toBeNull();
  });

  it('renvoie null quand le corps est vide', () => {
    const docx = zipSync({
      'word/document.xml': strToU8('<w:document><w:body><w:p/></w:body></w:document>'),
    });
    expect(texteDuDocx(docx)).toBeNull();
  });
});
