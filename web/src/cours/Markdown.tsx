import { Fragment, type ReactNode } from 'react';

// Markdown volontairement restreint : titres h3, listes, tableaux, citations, code, images, et un
// bloc ```svg pour les schémas. Rien n'est écrit en HTML brut : le texte passe par React, le SVG est
// affiché comme image (un script qu'il contiendrait ne s'exécute pas).
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)/g;

export function enLigne(texte: string): ReactNode[] {
  const noeuds: ReactNode[] = [];
  let dernier = 0;
  for (const m of texte.matchAll(INLINE)) {
    if (m.index > dernier) noeuds.push(texte.slice(dernier, m.index));
    const [brut] = m;
    if (m[1]) noeuds.push(<code key={m.index}>{brut.slice(1, -1)}</code>);
    else if (m[2]) noeuds.push(<strong key={m.index}>{brut.slice(2, -2)}</strong>);
    else noeuds.push(<em key={m.index}>{brut.slice(1, -1)}</em>);
    dernier = m.index + brut.length;
  }
  if (dernier < texte.length) noeuds.push(texte.slice(dernier));
  return noeuds;
}

const cellules = (ligne: string) =>
  ligne
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

const estSeparateur = (ligne: string) =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(ligne);

export function Markdown({
  source,
  resoudre,
}: {
  source: string;
  // Adresse d'une image du support (img/…) : fournie par le lecteur, qui connaît le deck.
  resoudre: (src: string) => string;
}) {
  const lignes = source.replace(/\r\n?/g, '\n').split('\n');
  const blocs: ReactNode[] = [];
  let i = 0;
  const cle = () => blocs.length;
  while (i < lignes.length) {
    const ligne = lignes[i]!;
    if (ligne.trim() === '') {
      i++;
      continue;
    }
    const code = /^```(\w*)[ \t]*$/.exec(ligne);
    if (code) {
      const corps: string[] = [];
      i++;
      while (i < lignes.length && !/^```[ \t]*$/.test(lignes[i]!)) corps.push(lignes[i++]!);
      i++;
      if (code[1] === 'svg')
        blocs.push(
          <img
            key={cle()}
            className="cours-svg"
            alt="Schéma"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(corps.join('\n'))}`}
          />,
        );
      else
        blocs.push(
          <pre key={cle()}>
            <code>{corps.join('\n')}</code>
          </pre>,
        );
      continue;
    }
    const titre = /^(#{3,4})[ \t]+(.+)$/.exec(ligne);
    if (titre) {
      blocs.push(
        titre[1]!.length === 3 ? (
          <h3 key={cle()}>{enLigne(titre[2]!)}</h3>
        ) : (
          <h4 key={cle()}>{enLigne(titre[2]!)}</h4>
        ),
      );
      i++;
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)[ \t]*$/.exec(ligne);
    if (image) {
      blocs.push(<img key={cle()} alt={image[1]} src={resoudre(image[2]!)} />);
      i++;
      continue;
    }
    if (/^>/.test(ligne)) {
      const citation: string[] = [];
      while (i < lignes.length && /^>/.test(lignes[i]!))
        citation.push(lignes[i++]!.replace(/^>[ \t]?/, ''));
      blocs.push(<blockquote key={cle()}>{enLigne(citation.join(' '))}</blockquote>);
      continue;
    }
    if (/^\s*\|/.test(ligne) && i + 1 < lignes.length && estSeparateur(lignes[i + 1]!)) {
      const tete = cellules(ligne);
      i += 2;
      const rangees: string[][] = [];
      while (i < lignes.length && /^\s*\|/.test(lignes[i]!)) rangees.push(cellules(lignes[i++]!));
      blocs.push(
        <table key={cle()}>
          <thead>
            <tr>
              {tete.map((c, k) => (
                <th key={k}>{enLigne(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rangees.map((r, k) => (
              <tr key={k}>
                {r.map((c, j) => (
                  <td key={j}>{enLigne(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    const puce = /^[-*][ \t]+/;
    const numero = /^\d+[.)][ \t]+/;
    if (puce.test(ligne) || numero.test(ligne)) {
      const ordonnee = numero.test(ligne);
      const motif = ordonnee ? numero : puce;
      const items: string[] = [];
      while (i < lignes.length && motif.test(lignes[i]!))
        items.push(lignes[i++]!.replace(motif, ''));
      const lis = items.map((t, k) => <li key={k}>{enLigne(t)}</li>);
      blocs.push(ordonnee ? <ol key={cle()}>{lis}</ol> : <ul key={cle()}>{lis}</ul>);
      continue;
    }
    const paragraphe: string[] = [];
    while (
      i < lignes.length &&
      lignes[i]!.trim() !== '' &&
      !/^(```|#{3,4} |>|[-*] |\d+[.)] |!\[|\s*\|)/.test(lignes[i]!)
    )
      paragraphe.push(lignes[i++]!);
    if (paragraphe.length === 0) paragraphe.push(lignes[i++]!);
    blocs.push(<p key={cle()}>{enLigne(paragraphe.join(' '))}</p>);
  }
  return (
    <>
      {blocs.map((b, k) => (
        <Fragment key={k}>{b}</Fragment>
      ))}
    </>
  );
}
