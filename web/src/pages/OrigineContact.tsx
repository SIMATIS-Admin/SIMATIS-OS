import { useEffect, useState } from 'react';
import { lireOrigineContactBase, type OrigineContactBase } from '../api.js';
import { Fenetre } from './Fenetre.js';

const texteAvecSources = (texte: string) =>
  texte.split(/(\[[^\]]+\]\(https:\/\/[^\s)]+\))/g).map((partie, i) => {
    const lien = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(partie);
    return lien ? (
      <a key={i} href={lien[2]} target="_blank" rel="noopener noreferrer">
        {lien[1]}
      </a>
    ) : (
      partie
    );
  });

export function OrigineContact({
  slug,
  id,
  nom,
  fermer,
}: {
  slug: string;
  id: string;
  nom: string;
  fermer: () => void;
}) {
  const [origine, setOrigine] = useState<OrigineContactBase | null>(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    let actif = true;
    void lireOrigineContactBase(slug, id).then(
      (r) => {
        if (actif) setOrigine(r);
      },
      () => {
        if (actif) setErreur('Impossible de charger la note d’origine.');
      },
    );
    return () => {
      actif = false;
    };
  }, [slug, id]);
  return (
    <Fenetre
      titre="Origine et contexte du contact"
      sousTitre={nom}
      onFermer={fermer}
      pied={
        <button className="btn" onClick={fermer}>
          Fermer
        </button>
      }
    >
      {erreur && <p role="alert">{erreur}</p>}
      {!origine && !erreur && <p role="status">Chargement de la note…</p>}
      {origine && (
        <>
          <p>
            <strong>Provenance :</strong> {origine.provenance}
            {origine.collecteLe
              ? ` · Collecté le ${new Date(origine.collecteLe).toLocaleDateString('fr-FR')}`
              : ''}
          </p>
          {!origine.notes.length && (
            <p>
              Aucune note de recherche détaillée n’a été conservée pour ce contact. La provenance
              ci-dessus est l’information disponible.
            </p>
          )}
          {origine.notes.map((n, i) => (
            <article key={i} className="origine-note">
              <h3>{n.origine}</h3>
              <p className="small muted">{new Date(n.date).toLocaleDateString('fr-FR')}</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{texteAvecSources(n.texte)}</p>
              {n.source && /^https:\/\//i.test(n.source) && (
                <a href={n.source} target="_blank" rel="noopener noreferrer">
                  Consulter la source
                </a>
              )}
            </article>
          ))}
        </>
      )}
    </Fenetre>
  );
}
