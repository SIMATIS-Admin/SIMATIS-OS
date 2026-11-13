import { useEffect, useRef, useState } from 'react';

// Une slide en HTML libre, affichée telle quelle à la taille de la zone : un cadre de 1920 × 1080
// réduit à l'échelle. Le cadre est isolé (sandbox sans droits) : aucun script, aucun accès à l'OS.
export function SlideHtml({ document: doc, titre }: { document: string; titre: string }) {
  const zone = useRef<HTMLDivElement>(null);
  const [echelle, setEchelle] = useState(0.5);
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    const mesurer = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setEchelle(Math.min(width / 1920, height / 1080));
    };
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div className="cours-html" ref={zone}>
      <div style={{ width: 1920 * echelle, height: 1080 * echelle }}>
        <iframe
          title={titre}
          sandbox=""
          srcDoc={doc}
          style={{ width: 1920, height: 1080, transform: `scale(${echelle})` }}
        />
      </div>
    </div>
  );
}
