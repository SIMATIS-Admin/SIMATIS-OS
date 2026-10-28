import { remplacer, Zone } from './champs.js';
import { CLES_ICP, CLES_PERSONA, type EtatAtelier } from './etat.js';

const sept = () => Array.from({ length: 7 }, () => '');

// Étape 5 : l'entreprise idéale (ICP), la personne à convaincre (persona), le message et les pistes.
export function Ciblage({
  etat,
  onChange,
}: {
  etat: EtatAtelier;
  onChange: (patch: Partial<EtatAtelier>) => void;
  partage: boolean;
}) {
  const i = Math.min(etat.icp, etat.icps.length - 1);
  const c = etat.icps[i]!;
  const majIcp = (suite: Partial<typeof c>) => onChange({ icps: remplacer(etat.icps, i, suite) });
  const liste = (cle: 'icp' | 'persona', j: number, v: string) =>
    majIcp({ [cle]: c[cle].map((x, k) => (k === j ? v : x)) });
  return (
    <div className="stack">
      <div className="at-grille">
        {etat.icps.map((x, k) => (
          <button
            key={k}
            type="button"
            className={`at-choix at-choix-bouton${k === i ? ' on' : ''}`}
            aria-pressed={k === i}
            onClick={() => onChange({ icp: k })}
          >
            <span className="small muted">{x.code}</span>
            <b>{x.name || 'Sans nom'}</b>
            <span className="small">{x.offer}</span>
          </button>
        ))}
      </div>
      <div className="at-ligne-outils">
        <button
          className="btn"
          type="button"
          onClick={() =>
            onChange({
              icps: [
                ...etat.icps,
                {
                  code: `ICP ${String.fromCharCode(65 + etat.icps.length)}`,
                  name: '',
                  offer: '',
                  icp: sept(),
                  persona: sept(),
                },
              ],
              icp: etat.icps.length,
            })
          }
        >
          Ajouter un ICP
        </button>
        {etat.icps.length > 1 && (
          <button
            className="btn"
            type="button"
            onClick={() =>
              onChange({ icps: etat.icps.filter((_, k) => k !== i), icp: Math.max(0, i - 1) })
            }
          >
            Supprimer cet ICP
          </button>
        )}
      </div>
      <div className="at-carte">
        <div className="at-champs-2">
          <label className="at-champ">
            Code
            <input value={c.code} onChange={(e) => majIcp({ code: e.target.value })} />
          </label>
          <label className="at-champ">
            Nom
            <input value={c.name} onChange={(e) => majIcp({ name: e.target.value })} />
          </label>
        </div>
        <label className="at-champ">
          Porte d’entrée
          <input value={c.offer} onChange={(e) => majIcp({ offer: e.target.value })} />
        </label>
      </div>
      <div className="at-grille">
        <div className="at-carte">
          <h3>ICP : l’entreprise idéale</h3>
          {CLES_ICP.map((k, j) => (
            <div key={k}>
              <b className="small">{k}</b>
              <Zone
                valeur={c.icp[j] ?? ''}
                etiquette={`ICP : ${k}`}
                onChange={(v) => liste('icp', j, v)}
              />
            </div>
          ))}
        </div>
        <div className="at-carte">
          <h3>Persona : la personne à convaincre</h3>
          {CLES_PERSONA.map((k, j) => (
            <div key={k}>
              <b className="small">{k}</b>
              <Zone
                valeur={c.persona[j] ?? ''}
                etiquette={`Persona : ${k}`}
                onChange={(v) => liste('persona', j, v)}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="at-carte">
        <h3>Caractéristique, avantage, bénéfice</h3>
        <div className="at-grille at-grille-3">
          {(
            [
              ['c', 'Caractéristique'],
              ['a', 'Avantage'],
              ['b', 'Bénéfice'],
            ] as const
          ).map(([cle, libelle]) => (
            <div key={cle}>
              <b className="small">{libelle}</b>
              <Zone
                valeur={etat.cab[cle]}
                etiquette={libelle}
                onChange={(v) => onChange({ cab: { ...etat.cab, [cle]: v } })}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="at-carte">
        <h3>Où chercher les premières cibles</h3>
        <div className="at-grille at-grille-3">
          {etat.pistes.map((p, k) => (
            <div className={`at-choix${p.on ? ' on' : ''}`} key={k}>
              <div className="at-ligne-outils">
                <input
                  className="at-titre-fait"
                  value={p.name}
                  aria-label="Nom de la piste"
                  onChange={(e) =>
                    onChange({ pistes: remplacer(etat.pistes, k, { name: e.target.value }) })
                  }
                />
                <button
                  className="btn"
                  type="button"
                  aria-pressed={p.on}
                  onClick={() => onChange({ pistes: remplacer(etat.pistes, k, { on: !p.on }) })}
                >
                  {p.on ? 'Retenue' : 'Retenir'}
                </button>
              </div>
              <Zone
                valeur={p.note}
                etiquette={`Note : ${p.name}`}
                placeholder="Qui, combien, par où commencer"
                onChange={(note) => onChange({ pistes: remplacer(etat.pistes, k, { note }) })}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
