import { ChoixNature, remplacer, Zone } from './champs.js';
import type { EtatAtelier } from './etat.js';

// Étape 3 : forces et faiblesses, vision, scénario retenu, offre qui porte l'année, accès au marché.
export function Modele({
  etat,
  onChange,
}: {
  etat: EtatAtelier;
  onChange: (patch: Partial<EtatAtelier>) => void;
  partage: boolean;
}) {
  return (
    <div className="stack">
      <div className="at-carte">
        <h3>Forces, faiblesses, opportunités, menaces</h3>
        <div className="at-grille">
          {etat.swot.map((q, i) => (
            <div className="at-quadrant" key={q.t}>
              <b>{q.t}</b>
              {q.items.map((it, j) => (
                <div className="at-fait" key={j}>
                  <Zone
                    valeur={it.v}
                    etiquette={`${q.t} : contenu`}
                    onChange={(v) =>
                      onChange({
                        swot: remplacer(etat.swot, i, { items: remplacer(q.items, j, { v }) }),
                      })
                    }
                  />
                  <div className="at-ligne-outils">
                    <ChoixNature
                      valeur={it.tag}
                      onChange={(tag) =>
                        onChange({
                          swot: remplacer(etat.swot, i, { items: remplacer(q.items, j, { tag }) }),
                        })
                      }
                    />
                    <button
                      className="btn"
                      type="button"
                      aria-label="Supprimer cette ligne"
                      onClick={() =>
                        onChange({
                          swot: remplacer(etat.swot, i, {
                            items: q.items.filter((_, k) => k !== j),
                          }),
                        })
                      }
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="btn"
                type="button"
                onClick={() =>
                  onChange({
                    swot: remplacer(etat.swot, i, { items: [...q.items, { v: '', tag: 'hyp' }] }),
                  })
                }
              >
                Ajouter
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="at-carte">
        <h3>Vision</h3>
        <label className="at-champ">
          Année
          <input
            value={etat.vision.annee}
            onChange={(e) => onChange({ vision: { ...etat.vision, annee: e.target.value } })}
          />
        </label>
        <Zone
          valeur={etat.vision.phrase}
          lignes={3}
          etiquette="Vision"
          placeholder="Une phrase et quelques repères chiffrés"
          onChange={(phrase) => onChange({ vision: { ...etat.vision, phrase } })}
        />
      </div>

      <div className="at-carte">
        <h3>Scénario de croissance retenu</h3>
        <div className="at-grille at-grille-3">
          {etat.scenarios.map((s, i) => (
            <div className={`at-choix${etat.scen === i ? ' on' : ''}`} key={i}>
              <div className="at-ligne-outils">
                <b>{s.name}</b>
                <button
                  className="btn"
                  type="button"
                  aria-pressed={etat.scen === i}
                  onClick={() => onChange({ scen: i })}
                >
                  {etat.scen === i ? 'Retenu' : 'Retenir'}
                </button>
              </div>
              <label className="at-champ">
                CA sur 12 mois (€)
                <input
                  type="number"
                  value={s.ca}
                  onChange={(e) =>
                    onChange({ scenarios: remplacer(etat.scenarios, i, { ca: e.target.value }) })
                  }
                />
              </label>
              <Zone
                valeur={s.pros}
                etiquette={`${s.name} : avantages`}
                placeholder="Avantages"
                onChange={(pros) => onChange({ scenarios: remplacer(etat.scenarios, i, { pros }) })}
              />
              <Zone
                valeur={s.cons}
                etiquette={`${s.name} : limites`}
                placeholder="Limites"
                onChange={(cons) => onChange({ scenarios: remplacer(etat.scenarios, i, { cons }) })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="at-carte">
        <h3>Offre qui porte l’année</h3>
        <div className="at-grille at-grille-3">
          {etat.motors.map((m, i) => (
            <div className={`at-choix${etat.motor === i ? ' on' : ''}`} key={i}>
              <button
                className="at-choix-bouton"
                type="button"
                aria-pressed={etat.motor === i}
                onClick={() => onChange({ motor: i })}
              >
                <b>{m.name}</b>
              </button>
              <Zone
                valeur={m.desc}
                etiquette={`${m.name} : description`}
                onChange={(desc) => onChange({ motors: remplacer(etat.motors, i, { desc }) })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="at-carte">
        <h3>Accès au marché</h3>
        <div className="at-grille at-grille-3">
          {etat.save.map((c, i) => (
            <div className="at-quadrant" key={c.t}>
              <b>{c.t}</b>
              <Zone
                valeur={c.v}
                lignes={3}
                etiquette={`${c.t} : réponse`}
                placeholder="À préciser"
                onChange={(v) => onChange({ save: remplacer(etat.save, i, { v }) })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="at-carte">
        <h3>Modèle économique</h3>
        <Zone
          valeur={etat.modeleNote}
          lignes={3}
          etiquette="Décisions de séance"
          placeholder="Décisions prises en séance"
          onChange={(modeleNote) => onChange({ modeleNote })}
        />
      </div>
    </div>
  );
}
