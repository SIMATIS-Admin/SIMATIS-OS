import { ChoixNature, remplacer, Zone } from './champs.js';
import type { EtatAtelier } from './etat.js';

// Étape 1 : ce que l'on sait déjà de l'entreprise, avec la nature de chaque information.
export function Cadrage({
  etat,
  onChange,
  partage,
}: {
  etat: EtatAtelier;
  onChange: (patch: Partial<EtatAtelier>) => void;
  partage: boolean;
}) {
  const faits = etat.facts;
  return (
    <div className="at-carte">
      <h3>Ce que l’on sait déjà</h3>
      <p className="muted small">
        Une information par ligne, avec sa nature : fait sourcé, déclaration, hypothèse ou question
        ouverte.
      </p>
      {faits.map((f, i) =>
        partage && f.prive ? null : (
          <div className="at-fait" key={i}>
            <input
              className="at-titre-fait"
              value={f.k}
              placeholder="Titre"
              aria-label="Titre de l’information"
              onChange={(e) => onChange({ facts: remplacer(faits, i, { k: e.target.value }) })}
            />
            <Zone
              valeur={f.v}
              etiquette="Contenu de l’information"
              onChange={(v) => onChange({ facts: remplacer(faits, i, { v }) })}
            />
            <div className="at-ligne-outils">
              <ChoixNature
                valeur={f.tag}
                onChange={(tag) => onChange({ facts: remplacer(faits, i, { tag }) })}
              />
              <input
                className="at-source"
                value={f.src}
                placeholder="Source"
                aria-label="Source"
                onChange={(e) => onChange({ facts: remplacer(faits, i, { src: e.target.value }) })}
              />
              {!partage && (
                <label className="small">
                  <input
                    type="checkbox"
                    checked={!!f.prive}
                    onChange={(e) =>
                      onChange({ facts: remplacer(faits, i, { prive: e.target.checked }) })
                    }
                  />{' '}
                  Réservé
                </label>
              )}
              <button
                className="btn"
                type="button"
                aria-label="Supprimer l’information"
                onClick={() => onChange({ facts: faits.filter((_, k) => k !== i) })}
              >
                Supprimer
              </button>
            </div>
          </div>
        ),
      )}
      <button
        className="btn"
        type="button"
        onClick={() => onChange({ facts: [...faits, { k: '', v: '', tag: 'hyp', src: '' }] })}
      >
        Ajouter une information
      </button>
    </div>
  );
}
