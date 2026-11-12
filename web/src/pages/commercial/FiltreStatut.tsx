import type { StatutCommercial } from '../../api.js';

export type ChoixStatut = 'tous' | StatutCommercial;

export const LIBELLE_STATUT: Record<StatutCommercial, string> = {
  suspect: 'Suspect',
  prospect: 'Prospect',
  client: 'Client',
};

const BOUTONS: [ChoixStatut, string][] = [
  ['tous', 'Toute la base'],
  ['suspect', 'Suspects'],
  ['prospect', 'Prospects'],
  ['client', 'Clients'],
];

// Une seule base, vue par statut : le statut est déduit des rendez-vous et des affaires gagnées.
export function FiltreStatut({
  lignes,
  valeur,
  onChange,
}: {
  lignes: { statut: StatutCommercial }[] | null;
  valeur: ChoixStatut;
  onChange: (v: ChoixStatut) => void;
}) {
  const nombre = (id: ChoixStatut) =>
    lignes ? (id === 'tous' ? lignes.length : lignes.filter((l) => l.statut === id).length) : null;
  return (
    <nav className="com-onglets com-statuts" aria-label="Statut">
      {BOUTONS.map(([id, label]) => (
        <button key={id} aria-pressed={valeur === id} onClick={() => onChange(id)}>
          {label}
          {nombre(id) !== null && <span className="muted"> · {nombre(id)}</span>}
        </button>
      ))}
    </nav>
  );
}

export const correspondAuStatut = (l: { statut: StatutCommercial }, choix: ChoixStatut) =>
  choix === 'tous' || l.statut === choix;
