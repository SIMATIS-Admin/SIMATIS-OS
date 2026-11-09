import { useEffect, useState } from 'react';
import { fetchDiapositivesRestitution, fetchProjetsDiag, type Diapositive } from '../api.js';
import { Diaporama, type Slide } from '../shell/Diaporama.js';

// Une ligne de texte de diapositive devient une puce ; les tirets ou puces d'origine s'effacent.
const nettoyer = (ligne: string) => ligne.replace(/^\s*[-–—•·*]\s+/, '').trim();

export const lignesDe = (texte: string) =>
  texte
    .split('\n')
    .map(nettoyer)
    .filter((l) => l.length > 0);

// Les diapositives lues dans le deck publié (titre, texte, notes) deviennent un diaporama de l'OS :
// la première sert de page de titre, les suivantes montrent le titre et le texte en puces. Les
// notes d'orateur ne se voient pas en mode présentation.
export function slidesDepuis(diapos: Diapositive[], entreprise: string): Slide[] {
  return diapos.map((d, i) => {
    const lignes = lignesDe(d.texte);
    const notes = d.notes.trim() ? (
      <aside className="dia-notes">
        <b>Notes d’orateur</b>
        {d.notes.trim()}
      </aside>
    ) : null;
    if (i === 0)
      return {
        cle: `diapo-${i}`,
        classe: 'titre',
        contenu: (
          <>
            <div>
              <span className="dia-sur">{entreprise}</span>
              <h2>{d.titre}</h2>
              {lignes.map((l) => (
                <p key={l}>{l}</p>
              ))}
              {notes}
            </div>
          </>
        ),
      };
    return {
      cle: `diapo-${i}`,
      contenu: (
        <>
          <h2>{d.titre}</h2>
          {lignes.length > 0 && (
            <ul className={`dia-puce-liste ${lignes.length > 4 ? 'dense' : ''}`}>
              {lignes.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {notes}
        </>
      ),
    };
  });
}

// Support d'ouverture ou restitution d'un diagnostic, présenté dans l'OS à partir du texte déjà gardé.
export function DiaporamaProjet({
  slug,
  genre,
  id,
}: {
  slug: string;
  genre: 'support' | 'restitution';
  id: string;
}) {
  const [etat, setEtat] = useState<
    | { statut: 'chargement' }
    | { statut: 'erreur'; message: string }
    | { statut: 'pret'; slides: Slide[] }
  >({ statut: 'chargement' });

  useEffect(() => {
    let annule = false;
    const charger = async () => {
      if (genre === 'restitution') {
        const { nom, diapositives } = await fetchDiapositivesRestitution(slug, id);
        return slidesDepuis(diapositives, nom);
      }
      const projet = (await fetchProjetsDiag(slug)).find((p) => p.id === id);
      if (!projet?.supportTexte?.length)
        throw new Error('Le support n’a pas encore de diapositives.');
      return slidesDepuis(projet.supportTexte, projet.nom);
    };
    charger().then(
      (slides) => !annule && setEtat({ statut: 'pret', slides }),
      (e: unknown) =>
        !annule &&
        setEtat({
          statut: 'erreur',
          message: e instanceof Error ? e.message : 'Diaporama indisponible',
        }),
    );
    return () => {
      annule = true;
    };
  }, [slug, genre, id]);

  const retour = (
    <a className="btn sm" href={`#/${slug}/diagnostics/ouvrir/${encodeURIComponent(id)}`}>
      ← Retour au diagnostic
    </a>
  );
  if (etat.statut === 'chargement')
    return (
      <p className="empty" role="status">
        Chargement du diaporama…
      </p>
    );
  if (etat.statut === 'erreur')
    return (
      <div className="empty" role="alert">
        <p>{etat.message}</p>
        <p>Exportez le deck depuis le diagnostic pour le présenter ici. {retour}</p>
      </div>
    );
  return (
    <Diaporama
      nom={genre === 'support' ? 'Support d’ouverture' : 'Restitution'}
      slides={etat.slides}
      actions={retour}
    />
  );
}
