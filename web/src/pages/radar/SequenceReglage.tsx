import { useEffect, useState } from 'react';
import { enregistrerSequence, fetchSequence, type SequenceFroid } from '../../api.js';

const MAX_RELANCES = 4;

// Les jours depuis le premier mail (J+4, J+9, J+15) deviennent les jours entre deux touches (4, 5, 6).
export const versDelais = (jours: number[]): number[] | null => {
  const valides = jours.every(
    (j, i) => Number.isInteger(j) && j >= 1 && j <= 120 && (i === 0 || j > (jours[i - 1] ?? 0)),
  );
  return valides && jours.length > 0 ? jours.map((j, i) => j - (jours[i - 1] ?? 0)) : null;
};

// La séquence à froid : un mail d'approche, puis des relances aux jours choisis. Rien ne part tout
// seul : chaque mail reste un brouillon à relire.
export function SequenceReglage({ slug }: { slug: string }) {
  const [sequence, setSequence] = useState<SequenceFroid | null>(null);
  const [edition, setEdition] = useState<string[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    fetchSequence(slug).then(
      (s) => actif && Array.isArray(s.cumul) && setSequence(s),
      () => undefined,
    );
    return () => {
      actif = false;
    };
  }, [slug]);

  if (!sequence) return null;
  const enregistrer = () => {
    const delais = versDelais((edition ?? []).map(Number));
    if (!delais) {
      setErreur('Les jours doivent aller en croissant, de 1 à 120.');
      return;
    }
    enregistrerSequence(slug, delais).then(
      (s) => {
        setSequence(s);
        setEdition(null);
        setErreur(null);
      },
      (e: unknown) => setErreur(e instanceof Error ? e.message : String(e)),
    );
  };
  return (
    <section className="radar-sequence" aria-label="Séquence de relance">
      <h2>Séquence de relance</h2>
      {edition === null ? (
        <>
          <p>
            Mail d’approche, puis relances à <b>{sequence.cumul.map((j) => `J+${j}`).join(', ')}</b>
            . Chaque mail reste un brouillon à relire : rien ne part sans votre clic.
          </p>
          <button className="btn" onClick={() => setEdition(sequence.cumul.map(String))}>
            Modifier la séquence
          </button>
        </>
      ) : (
        <>
          <div className="radar-sequence-jours">
            {edition.map((j, i) => (
              <label key={i} className="small">
                Relance {i + 1}, jour
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={120}
                  aria-label={`Relance ${i + 1}, jour`}
                  value={j}
                  onChange={(e) =>
                    setEdition(edition.map((x, k) => (k === i ? e.target.value : x)))
                  }
                />
              </label>
            ))}
          </div>
          <div className="radar-actions">
            {edition.length < MAX_RELANCES && (
              <button
                className="btn"
                onClick={() => setEdition([...edition, String(Number(edition.at(-1) ?? 0) + 6)])}
              >
                Ajouter une relance
              </button>
            )}
            {edition.length > 1 && (
              <button className="btn" onClick={() => setEdition(edition.slice(0, -1))}>
                Retirer la dernière
              </button>
            )}
            <button className="btn primary" onClick={enregistrer}>
              Enregistrer
            </button>
            <button className="btn" onClick={() => setEdition(null)}>
              Annuler
            </button>
          </div>
          {erreur && (
            <p className="error" role="alert">
              {erreur}
            </p>
          )}
        </>
      )}
    </section>
  );
}
