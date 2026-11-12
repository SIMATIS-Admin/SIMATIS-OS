import { useState } from 'react';
import type { SujetVue } from '../../api.js';

// La réponse que la routine a rédigée pour ce mail. L'OS n'envoie rien : le pilote la relit, ouvre le
// brouillon dans sa messagerie (quand il existe) ou copie le texte, puis l'envoie lui-même.
export function ReponsePreparee({
  reponse,
}: {
  reponse: NonNullable<SujetVue['reponsePreparee']>;
}) {
  const [copie, setCopie] = useState<'oui' | 'non' | null>(null);
  const copier = () => {
    const texte = reponse.objet ? `${reponse.objet}\n\n${reponse.texte}` : reponse.texte;
    navigator.clipboard.writeText(texte).then(
      () => setCopie('oui'),
      () => setCopie('non'),
    );
  };
  return (
    <section className="reponse-preparee alert blue" aria-label="Réponse préparée">
      <b>Réponse préparée</b>
      {reponse.objet && <p className="small muted">Objet : {reponse.objet}</p>}
      <pre className="reponse-texte">{reponse.texte}</pre>
      <div className="decision">
        {reponse.lienBrouillon && (
          <a className="btn primary" href={reponse.lienBrouillon} target="_blank" rel="noreferrer">
            Ouvrir le brouillon
          </a>
        )}
        <button className="btn" onClick={copier}>
          Copier la réponse
        </button>
        {copie === 'oui' && <span className="small">Copiée.</span>}
        {copie === 'non' && (
          <span className="small">Copie impossible : sélectionnez le texte.</span>
        )}
      </div>
      <p className="small muted">Rien n'est envoyé : vous validez dans votre messagerie.</p>
    </section>
  );
}
