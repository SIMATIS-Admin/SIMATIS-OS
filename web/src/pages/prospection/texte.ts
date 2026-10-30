// Le mail est du HTML (paragraphes et listes à puces) ; Marc le retouche en texte simple :
// paragraphes séparés par une ligne vide, puces par « - ».

const entites: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};
const decoder = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => entites[m] ?? m);
const echapper = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function htmlVersTexte(html: string): string {
  return decoder(
    html
      .replace(/<\/?(ul|ol)[^>]*>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/li>/gi, '')
      .replace(/<\/(p|div)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function texteVersHtml(texte: string): string {
  const blocs = texte.trim().split(/\n\s*\n/);
  return blocs
    .map((bloc) => {
      const lignes = bloc
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lignes.length > 0 && lignes.every((l) => l.startsWith('- '))) {
        return `<ul>${lignes.map((l) => `<li>${echapper(l.slice(2))}</li>`).join('')}</ul>`;
      }
      return `<p>${lignes.map(echapper).join('<br>')}</p>`;
    })
    .join('');
}
