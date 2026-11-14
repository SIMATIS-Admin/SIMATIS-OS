import { useEffect, useState } from 'react';
import { enregistrerSourceCours, lireSourceCours } from '../api.js';

// Édition du fichier de la slide affichée : le texte brut (variables {{…}} intactes), enregistré
// avec la version lue pour ne jamais écraser une modification faite ailleurs.
export function Editeur({
  slug,
  deck,
  fichier,
  onEnregistre,
  onFermer,
}: {
  slug: string;
  deck: string;
  fichier: string;
  onEnregistre: () => void;
  onFermer: () => void;
}) {
  const [texte, setTexte] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [modifie, setModifie] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setTexte(null);
    setModifie(false);
    setMessage(null);
    lireSourceCours(slug, deck, fichier).then(
      (r) => {
        if (annule) return;
        setTexte(r.contenu);
        setVersion(r.version);
      },
      (e: unknown) => !annule && setMessage(e instanceof Error ? e.message : 'Lecture impossible'),
    );
    return () => {
      annule = true;
    };
  }, [slug, deck, fichier]);

  const enregistrer = async () => {
    if (texte === null) return;
    try {
      setVersion(await enregistrerSourceCours(slug, deck, fichier, texte, version));
      setModifie(false);
      setMessage('Enregistré');
      onEnregistre();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Enregistrement impossible');
    }
  };

  return (
    <aside className="cours-edition" aria-label="Édition de la slide">
      <div className="cours-edition-tete">
        <b>{fichier}</b>
        {modifie && <span> · non enregistré</span>}
      </div>
      <textarea
        aria-label={`Contenu de ${fichier}`}
        spellCheck={false}
        value={texte ?? ''}
        disabled={texte === null}
        onChange={(e) => {
          setTexte(e.target.value);
          setModifie(true);
          setMessage(null);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            void enregistrer();
          } else if (e.key === 'Escape') onFermer();
        }}
      />
      <div className="cours-edition-pied">
        <button
          className="btn sm"
          type="button"
          disabled={texte === null || !modifie}
          onClick={() => void enregistrer()}
        >
          Enregistrer
        </button>
        <button className="btn sm" type="button" onClick={onFermer}>
          Fermer
        </button>
        {message && <span role="status">{message}</span>}
      </div>
    </aside>
  );
}
