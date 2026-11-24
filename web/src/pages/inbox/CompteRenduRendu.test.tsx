// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CompteRenduRendu, decouperPave } from './CompteRenduRendu.js';

afterEach(cleanup);

const phrase = 'Le client décrit son besoin fictif avec précision.';

describe('CompteRenduRendu', () => {
  it('range titre, date et participants dans un en-tête', () => {
    render(
      <CompteRenduRendu
        texte={
          'Réunion fictive\n24/11/2026 · 11 h 00 – 11 h 35 · Alice Test, Bob Test\n\n## Résumé\nTexte.'
        }
      />,
    );
    const zone = screen.getByTestId('compte-rendu-rendu');
    expect(within(zone).getByRole('heading', { name: 'Réunion fictive' })).toBeTruthy();
    expect(within(zone).getByRole('list', { name: 'Participants' }).children).toHaveLength(2);
    expect(within(zone).getByRole('heading', { name: 'Résumé' })).toBeTruthy();
    expect(zone.textContent).not.toContain('##');
  });

  it("n'invente pas d'en-tête quand la 2e ligne n'est pas datée", () => {
    render(<CompteRenduRendu texte={'Une première ligne.\nUne seconde ligne.'} />);
    expect(screen.queryByRole('list', { name: 'Participants' })).toBeNull();
  });

  it('coupe un pavé en paragraphes, à la fin des phrases', () => {
    const pave = Array.from({ length: 20 }, () => phrase).join(' ');
    const morceaux = decouperPave(pave);
    expect(morceaux.length).toBeGreaterThan(2);
    for (const m of morceaux) expect(m.endsWith('.')).toBe(true);
    expect(morceaux.join(' ')).toBe(pave);
  });

  it('laisse un paragraphe court en un seul morceau', () => {
    expect(decouperPave(phrase)).toEqual([phrase]);
  });

  it('distingue les parties (##) des intertitres (###)', () => {
    render(<CompteRenduRendu texte={'## Actions\n### Alice\n- Faire un devis'} />);
    expect(screen.getByRole('heading', { name: 'Actions', level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Alice', level: 4 })).toBeTruthy();
  });
});
