import { strFromU8, unzipSync } from 'fflate';

const ENTITES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

// Texte brut du corps d'un Word, pour le donner à relire à Claude. Pas de mise en forme : seuls les
// mots et les fins de paragraphe comptent. `null` quand le fichier n'est pas un .docx lisible ou vide.
export function texteDuDocx(octets: Uint8Array): string | null {
  try {
    const xml = unzipSync(octets, { filter: (f) => f.name === 'word/document.xml' })[
      'word/document.xml'
    ];
    if (!xml) return null;
    const texte = strFromU8(xml)
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\/>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => ENTITES[e]!)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
    return texte === '' ? null : texte;
  } catch {
    return null;
  }
}
