// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exporterResultatPdf } from './exportPdf.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Export PDF du résultat VMA', () => {
  it('isole toute la fiche, préserve le graphique et les accents, retire les commandes', async () => {
    const fiche = document.createElement('div');
    fiche.className = 'rc';
    fiche.innerHTML = `<h2>Résultat · Société &amp; Fictive</h2>
      <button>Exporter en PDF</button><div data-pdf-exclude>Erreur temporaire</div>
      <p>Objectif : 20 000 €</p><div role="img" aria-label="Trajectoire"><span style="width: 42%"></span></div>
      <ol><li>Dernière recommandation, à la fin d’une longue fiche.</li></ol>`;
    document.body.innerHTML = '<nav>Menu privé</nav>';
    document.body.append(fiche);
    const exporte = exporterResultatPdf(fiche, 'Test VMA - Société & Fictive');
    const frame = document.querySelector('iframe')!;
    const copie = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
    expect(copie.title).toBe('Test VMA - Société & Fictive');
    expect(copie.body.textContent).toContain('Dernière recommandation');
    expect(copie.body.textContent).toContain('20 000 €');
    expect(copie.body.textContent).not.toMatch(/Exporter|Menu privé|Erreur temporaire/);
    expect(copie.querySelector('[role="img"] span')?.getAttribute('style')).toContain('42%');
    expect(copie.documentElement.lang).toBe('fr');
    const imprimer = vi.spyOn(frame.contentWindow!, 'print').mockImplementation(() => {});
    vi.spyOn(frame.contentWindow!, 'focus').mockImplementation(() => {});
    frame.dispatchEvent(new Event('load'));
    await exporte;
    expect(imprimer).toHaveBeenCalledOnce();
    expect(fiche.querySelector('button')).toBeTruthy();
    frame.contentWindow!.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('signale un échec d’impression et enlève la copie', async () => {
    const exporte = exporterResultatPdf(document.createElement('div'), 'Test VMA');
    const frame = document.querySelector('iframe')!;
    vi.spyOn(frame.contentWindow!, 'focus').mockImplementation(() => {});
    vi.spyOn(frame.contentWindow!, 'print').mockImplementation(() => {
      throw new Error('échec');
    });
    frame.dispatchEvent(new Event('load'));
    await expect(exporte).rejects.toThrow('L’export PDF a échoué');
    expect(document.querySelector('iframe')).toBeNull();
  });
});
