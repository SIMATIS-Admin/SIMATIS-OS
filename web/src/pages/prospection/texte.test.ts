import { describe, expect, it } from 'vitest';
import { htmlVersTexte, texteVersHtml } from './texte.js';

describe('texte du mail', () => {
  const html =
    '<p>Bonjour Camille,</p><p>Seriez-vous disponible ?</p><ul><li>Jeudi 12 novembre à 9h30</li><li>Mardi 17 novembre à 14h</li></ul><p>Bien à vous,</p>';

  it('met le HTML en texte lisible', () => {
    expect(htmlVersTexte(html)).toBe(
      'Bonjour Camille,\n\nSeriez-vous disponible ?\n\n- Jeudi 12 novembre à 9h30\n- Mardi 17 novembre à 14h\n\nBien à vous,',
    );
  });

  it('refait le HTML : paragraphes et puces', () => {
    expect(texteVersHtml(htmlVersTexte(html))).toBe(html);
  });

  it('échappe le texte tapé : aucun HTML ne passe', () => {
    expect(texteVersHtml('Salut <b>x</b> & "y"')).toBe(
      '<p>Salut &lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;</p>',
    );
  });

  it('garde les retours à la ligne simples dans un paragraphe', () => {
    expect(texteVersHtml('Ligne 1\nLigne 2')).toBe('<p>Ligne 1<br>Ligne 2</p>');
  });
});
