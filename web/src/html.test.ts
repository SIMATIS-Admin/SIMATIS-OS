// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlSur } from './html.js';

describe('htmlSur', () => {
  it('keeps simple formatting', () => {
    expect(htmlSur('<p>Bonjour <b>Agathe</b>,<br>à bientôt</p>')).toBe(
      '<p>Bonjour <b>Agathe</b>,<br>à bientôt</p>',
    );
  });

  it('drops scripts, attributes, links and images', () => {
    const out = htmlSur(
      '<p onclick="x()">Hi<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:x">lien</a></p>',
    );
    expect(out).toBe('<p>Hilien</p>');
    expect(out).not.toMatch(/script|onerror|onclick|href|img/);
  });

  it('escapes text', () => {
    expect(htmlSur('a &lt;b&gt; < c')).toBe('a &lt;b&gt; &lt; c');
  });
});
