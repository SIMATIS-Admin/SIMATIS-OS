import { useEffect, useRef } from 'react';
import type { DocPdf } from './pdf.js';

// Une page du PDF du deck, dessinée à la taille de l'écran. Elle ne se dessine qu'une fois
// affichée : un deck de plusieurs dizaines de pages ne remplit pas la mémoire d'un coup.
export function PagePdf({ doc, n, actif }: { doc: DocPdf; n: number; actif: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dessine = useRef(false);
  useEffect(() => {
    const cible = canvas.current;
    if (!actif || dessine.current || !cible) return;
    dessine.current = true;
    void doc.getPage(n).then(async (page) => {
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        2.5,
        (window.innerWidth * (window.devicePixelRatio || 1)) / base.width,
      );
      const viewport = page.getViewport({ scale });
      cible.width = Math.round(viewport.width);
      cible.height = Math.round(viewport.height);
      const contexte = cible.getContext('2d');
      if (contexte) await page.render({ canvasContext: contexte, viewport }).promise;
    });
  }, [actif, doc, n]);
  return <canvas ref={canvas} className="dia-pdf" role="img" aria-label={`Page ${n} du deck`} />;
}
