import type { ReactNode } from 'react';
import { enLigne } from '../../cours/Markdown.js';

// Un résumé arrivé sans retours à la ligne (« **Titre** - point - point ») est remis en titres et
// listes pour l'affichage seulement : le texte envoyé à l'acquittement reste celui de Marc.
export const normaliser = (texte: string): string =>
  texte.includes('\n')
    ? texte
    : texte
        .replace(/\s+(\*\*[^*\n]{1,60}\*\*)\s+-\s+/g, '\n\n$1\n- ')
        .replace(/\s+-\s+(?=\S)/g, '\n- ');

// Un pavé de dix phrases ne se lit pas : au-delà de ce seuil, on le coupe en petits paragraphes
// (à la fin d'une phrase, jamais au milieu), pour l'affichage seulement.
const SEUIL_PAVE = 380;
const TAILLE_PARAGRAPHE = 260;
const FIN_DE_PHRASE = /(?<=[.!?])\s+(?=[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ«"(])/;

export function decouperPave(texte: string): string[] {
  if (texte.length <= SEUIL_PAVE) return [texte];
  const paragraphes: string[] = [];
  let courant = '';
  for (const phrase of texte.split(FIN_DE_PHRASE)) {
    courant = courant ? `${courant} ${phrase}` : phrase;
    if (courant.length >= TAILLE_PARAGRAPHE) {
      paragraphes.push(courant);
      courant = '';
    }
  }
  if (courant) paragraphes.push(courant);
  return paragraphes;
}

// Les deux premières lignes d'un compte rendu de visio : le titre, puis « date · heure · participants ».
const ENTETE_DATE = /\d{1,2}\/\d{1,2}\/\d{4}/;

function Entete({ titre, meta }: { titre: string; meta: string }) {
  const segments = meta.split(' · ').map((x) => x.trim());
  // Le dernier segment est la liste des participants quand il en contient plusieurs.
  const dernier = segments[segments.length - 1] ?? '';
  const participants = segments.length > 2 && dernier.includes(',') ? dernier.split(/,\s*/) : [];
  const infos = participants.length ? segments.slice(0, -1) : segments;
  return (
    <header className="cr-entete">
      <h3>{enLigne(titre)}</h3>
      <p className="cr-infos">
        {infos.map((x, i) => (
          <span key={i}>{x}</span>
        ))}
      </p>
      {participants.length > 0 && (
        <ul className="cr-participants" aria-label="Participants">
          {participants.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </header>
  );
}

// Titres (#, **Titre** seul sur sa ligne), listes à puces et paragraphes ; rien n'est écrit en HTML brut.
export function CompteRenduRendu({ texte }: { texte: string }) {
  const lignes = normaliser(texte).replace(/\r\n?/g, '\n').split('\n');
  const blocs: ReactNode[] = [];
  let puces: string[] = [];
  const viderPuces = () => {
    if (puces.length === 0) return;
    const items = puces;
    blocs.push(
      <ul key={`ul-${blocs.length}`}>
        {items.map((p, i) => (
          <li key={i}>{enLigne(p)}</li>
        ))}
      </ul>,
    );
    puces = [];
  };
  // L'en-tête n'existe que si le texte commence par un titre suivi d'une ligne datée.
  const brutes = lignes.map((l) => l.trim());
  const debut = brutes.findIndex((l) => l !== '');
  const titreEntete = brutes[debut];
  const metaEntete = brutes[debut + 1];
  const avecEntete =
    debut >= 0 &&
    !!titreEntete &&
    !/^(#|[-*]\s|\*\*)/.test(titreEntete) &&
    !!metaEntete &&
    ENTETE_DATE.test(metaEntete);
  if (avecEntete) blocs.push(<Entete key="entete" titre={titreEntete} meta={metaEntete} />);
  const depart = avecEntete ? debut + 2 : 0;
  for (const ligne of brutes.slice(depart)) {
    const puce = /^[-*]\s+(.+)$/.exec(ligne);
    if (puce) {
      puces.push(puce[1]!);
      continue;
    }
    viderPuces();
    if (!ligne) continue;
    const niveau = /^(#{1,4})\s+(.+)$/.exec(ligne);
    const gras = /^\*\*([^*]+)\*\*$/.exec(ligne);
    if (niveau) {
      // « ## » ouvre une grande partie, « ### » ou plus un intertitre (un nom, un thème).
      const grande = niveau[1]!.length <= 2;
      blocs.push(
        grande ? (
          <h3 key={blocs.length} className="cr-section">
            {enLigne(niveau[2]!)}
          </h3>
        ) : (
          <h4 key={blocs.length} className="cr-sous">
            {enLigne(niveau[2]!)}
          </h4>
        ),
      );
    } else if (gras) {
      blocs.push(
        <h4 key={blocs.length} className="cr-sous">
          {enLigne(gras[1]!)}
        </h4>,
      );
    } else {
      for (const paragraphe of decouperPave(ligne))
        blocs.push(<p key={blocs.length}>{enLigne(paragraphe)}</p>);
    }
  }
  viderPuces();
  return (
    <div className="cr-rendu" data-testid="compte-rendu-rendu">
      {blocs}
    </div>
  );
}
