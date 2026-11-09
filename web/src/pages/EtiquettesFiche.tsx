import { useState } from 'react';
import { etiqueterBase } from '../api.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Free labels on a contact: typed by hand, suggested from the ones already in use.
export function EtiquettesFiche({
  slug,
  ficheId,
  tags,
  suggestions,
  onChange,
}: {
  slug: string;
  ficheId: string;
  tags: string[];
  suggestions: string[];
  onChange: () => void;
}) {
  const [saisie, setSaisie] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const agir = async (action: () => Promise<unknown>) => {
    setOccupe(true);
    setErreur(null);
    try {
      await action();
      onChange();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <section className="bv-etiquettes" aria-label="Étiquettes">
      <h3 className="bv-sous-titre">Étiquettes</h3>
      {erreur && (
        <p className="error" role="alert">
          {erreur}
        </p>
      )}
      <p>
        {tags.length === 0 && <span className="muted">Aucune étiquette.</span>}
        {tags.map((t) => (
          <span key={t} className="badge">
            {t}{' '}
            <button
              className="bv-fermer"
              aria-label={`Retirer l’étiquette ${t}`}
              disabled={occupe}
              onClick={() => void agir(() => etiqueterBase(slug, [ficheId], { retirer: [t] }))}
            >
              ×
            </button>
          </span>
        ))}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = saisie.trim();
          if (t)
            void agir(async () => {
              await etiqueterBase(slug, [ficheId], { ajouter: [t] });
              setSaisie('');
            });
        }}
      >
        <input
          className="input"
          aria-label="Ajouter une étiquette"
          list={`etiquettes-${ficheId}`}
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
        />
        <datalist id={`etiquettes-${ficheId}`}>
          {suggestions
            .filter((s) => !tags.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>{' '}
        <button className="btn sm" disabled={occupe || !saisie.trim()}>
          Ajouter
        </button>
      </form>
    </section>
  );
}
