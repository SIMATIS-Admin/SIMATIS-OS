import { Zone } from './champs.js';
import type { EtatAtelier } from './etat.js';

const DIAG = [
  ['non-prevu', 'Non prévu'],
  ['a-faire', 'À réaliser'],
  ['fait', 'Réalisé'],
] as const;
const VMA = [
  ['a-passer', 'À passer en séance'],
  ['passe', 'Passé'],
] as const;

// Étape 2 : où en est l'entreprise ? État du diagnostic et du test VMA, identité et ambition.
export function EtapeDiagnostic({
  etat,
  onChange,
}: {
  etat: EtatAtelier;
  onChange: (patch: Partial<EtatAtelier>) => void;
  partage: boolean;
}) {
  return (
    <div className="at-grille">
      <div className="at-carte">
        <h3>Diagnostic d’endurance</h3>
        <select
          className="at-select"
          aria-label="Diagnostic d’endurance"
          value={etat.diag}
          onChange={(e) => onChange({ diag: e.target.value as EtatAtelier['diag'] })}
        >
          {DIAG.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Zone
          valeur={etat.diagNote}
          lignes={3}
          etiquette="Note sur le diagnostic"
          placeholder="Date, profil, axes faibles…"
          onChange={(diagNote) => onChange({ diagNote })}
        />
      </div>
      <div className="at-carte">
        <h3>Test de VMA</h3>
        <select
          className="at-select"
          aria-label="Test de VMA"
          value={etat.vma}
          onChange={(e) => onChange({ vma: e.target.value as EtatAtelier['vma'] })}
        >
          {VMA.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Zone
          valeur={etat.vmaNote}
          lignes={3}
          etiquette="Note sur le test de VMA"
          placeholder="VMA, ambition, freins"
          onChange={(vmaNote) => onChange({ vmaNote })}
        />
      </div>
      <div className="at-carte">
        <h3>Fiche d’identité</h3>
        {(
          [
            ['effectif', 'Effectif'],
            ['ca', 'Chiffre d’affaires actuel'],
            ['clients', 'Clients phares'],
          ] as const
        ).map(([cle, libelle]) => (
          <label className="at-champ" key={cle}>
            {libelle}
            <input
              value={etat.identity[cle]}
              onChange={(e) => onChange({ identity: { ...etat.identity, [cle]: e.target.value } })}
            />
          </label>
        ))}
      </div>
      <div className="at-carte">
        <h3>Ambition</h3>
        {(
          [
            ['ca', 'CA visé'],
            ['echeance', 'Échéance'],
            ['niveau', 'Niveau d’ambition'],
            ['freins', 'Freins les plus lourds'],
          ] as const
        ).map(([cle, libelle]) => (
          <label className="at-champ" key={cle}>
            {libelle}
            <input
              value={etat.ambition[cle]}
              onChange={(e) => onChange({ ambition: { ...etat.ambition, [cle]: e.target.value } })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
