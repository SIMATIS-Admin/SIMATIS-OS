import { strToU8, zipSync } from 'fflate';

const echapper = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colonne = (i: number) => String.fromCharCode(65 + i);

// Minimal .xlsx writer for tests: text cells only, one entry per sheet.
export function fabriquerXlsx(feuilles: { nom: string; lignes: string[][] }[]): Buffer {
  const fichiers: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${feuilles
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${feuilles
        .map((f, i) => `<sheet name="${echapper(f.nom)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${feuilles
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('')}</Relationships>`,
    ),
  };
  feuilles.forEach((f, i) => {
    const lignes = f.lignes
      .map(
        (l, r) =>
          `<row r="${r + 1}">${l
            .map((c, k) =>
              c === ''
                ? ''
                : `<c r="${colonne(k)}${r + 1}" t="inlineStr"><is><t>${echapper(c)}</t></is></c>`,
            )
            .join('')}</row>`,
      )
      .join('');
    fichiers[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lignes}</sheetData></worksheet>`,
    );
  });
  return Buffer.from(zipSync(fichiers));
}
