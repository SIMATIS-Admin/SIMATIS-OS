import type { SlideCours } from './parseur.js';

// Une slide en HTML libre : une <section> dont la dernière <aside> porte les notes du formateur.
// Le contenu n'est jamais inséré dans la page de l'OS : il s'affiche dans un cadre isolé (sandbox).
export function lireSlideHtml(source: string, repli: string): SlideCours | null {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const section = doc.querySelector('section');
  if (!section) return null;
  const notes = [...section.querySelectorAll(':scope > aside')]
    .map((a) => (a.textContent ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
  section.querySelectorAll(':scope > aside').forEach((a) => a.remove());
  const titre = section.querySelector('h1, h2, h3')?.textContent?.trim() || repli;
  return { titre, type: 'concept', livrable: null, colonnes: [''], notes, html: section.outerHTML };
}

const IMAGE_LOCALE = /(\bsrc\s*=\s*)(["'])(img\/[^"']+)\2/gi;

// Le cadre isolé n'envoie pas les cookies de l'OS : les images du support sont lues ici, puis
// incorporées à la slide.
export async function incorporerImages(
  html: string,
  charger: (chemin: string) => Promise<string>,
): Promise<string> {
  const chemins = [...new Set([...html.matchAll(IMAGE_LOCALE)].map((m) => m[3]!))];
  const urls = new Map<string, string>();
  await Promise.all(
    chemins.map(async (c) => {
      try {
        urls.set(c, await charger(c));
      } catch {
        // Image absente : la slide s'affiche sans elle.
      }
    }),
  );
  return html.replace(IMAGE_LOCALE, (tout, debut: string, q: string, chemin: string) =>
    urls.has(chemin) ? `${debut}${q}${urls.get(chemin)}${q}` : tout,
  );
}

// Le document du cadre : la feuille de style du support, les polices demandées, la slide à
// 1920 × 1080. Rien ne s'y exécute (le cadre n'a pas le droit de lancer de script).
export function documentSlide(section: string, css: string, polices: string[]): string {
  const liens = polices
    .map((h) => `<link rel="stylesheet" href="${h.replace(/"/g, '%22')}">`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8">${liens}<style>html,body{margin:0;padding:0;background:#fff}body{width:1920px;height:1080px;overflow:hidden}body>section{position:relative;width:1920px;height:1080px;box-sizing:border-box;overflow:hidden}${css.replace(/<\/style/gi, '')}</style></head><body>${section}</body></html>`;
}
