const FRAME_ID = 'vma-export-pdf';

// Une copie isolée garde toute la fiche, même hors écran, sans imprimer la navigation de l’OS.
export function exporterResultatPdf(element: HTMLElement, titre: string): Promise<void> {
  document.getElementById(FRAME_ID)?.remove();
  const frame = document.createElement('iframe');
  frame.id = FRAME_ID;
  frame.title = 'Export PDF du résultat VMA';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;width:210mm;height:1px;border:0';

  const copie = document.implementation.createHTMLDocument(titre);
  copie.documentElement.lang = 'fr';
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((style) => {
    copie.head.append(style.cloneNode(true));
  });
  const contenu = element.cloneNode(true) as HTMLElement;
  contenu.querySelectorAll('button, [data-pdf-exclude]').forEach((node) => node.remove());
  copie.body.append(contenu);
  const style = copie.createElement('style');
  style.textContent = `
    @page { size: A4; margin: 15mm; }
    html, body { background: white; color: #172b43; margin: 0; padding: 0; height: auto; overflow: visible; }
    body { font-size: 11pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .rc { max-width: none; width: 100%; }
    .panel { box-shadow: none; overflow: visible; }
    .rc-carte { padding: 5mm; }
    .panel-h { flex-wrap: wrap; }
    h2 { font-size: 18pt; }
    .rc-grand { font-size: 30pt; }
    h2, .rc-eyebrow, .ft { break-after: avoid; }
    .rc-freins > li, .rc-niveau, .rc-piste, .rc-chips { break-inside: avoid; }
    p { orphans: 3; widows: 3; }
    .rc-freins .corps { min-width: 0; }
    .rc { overflow-wrap: anywhere; }
  `;
  copie.head.append(style);

  return new Promise((resolve, reject) => {
    frame.onload = () => {
      const imprimer = async () => {
        try {
          const fenetre = frame.contentWindow;
          if (!fenetre) throw new Error('La fenêtre d’export PDF est indisponible.');
          await frame.contentDocument?.fonts?.ready;
          fenetre.addEventListener('afterprint', () => frame.remove(), { once: true });
          fenetre.focus();
          fenetre.print();
          resolve();
        } catch {
          frame.remove();
          reject(new Error('L’export PDF a échoué. Veuillez réessayer.'));
        }
      };
      void imprimer();
    };
    frame.srcdoc = `<!doctype html>${copie.documentElement.outerHTML}`;
    document.body.append(frame);
  });
}
