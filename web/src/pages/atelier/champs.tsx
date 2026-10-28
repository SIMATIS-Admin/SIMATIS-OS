import { NATURES, type Nature } from './etat.js';

// Champs partagés par les étapes : zone de texte discrète et choix de la nature d'une information.
export function Zone({
  valeur,
  onChange,
  lignes = 2,
  placeholder,
  etiquette,
}: {
  valeur: string;
  onChange: (v: string) => void;
  lignes?: number;
  placeholder?: string;
  etiquette?: string;
}) {
  return (
    <textarea
      className="at-zone"
      rows={lignes}
      value={valeur}
      placeholder={placeholder}
      aria-label={etiquette}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ChoixNature({
  valeur,
  onChange,
}: {
  valeur: Nature;
  onChange: (n: Nature) => void;
}) {
  return (
    <select
      className={`at-nature at-nature-${valeur}`}
      value={valeur}
      aria-label="Nature de l’information"
      onChange={(e) => onChange(e.target.value as Nature)}
    >
      {(Object.keys(NATURES) as Nature[]).map((n) => (
        <option key={n} value={n}>
          {NATURES[n]}
        </option>
      ))}
    </select>
  );
}

// Remplace l'élément `i` d'une liste sans toucher aux autres.
export const remplacer = <T,>(liste: T[], i: number, suite: Partial<T>): T[] =>
  liste.map((x, k) => (k === i ? { ...x, ...suite } : x));
