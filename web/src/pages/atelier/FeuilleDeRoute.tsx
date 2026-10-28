import { useState } from 'react';
import { echeanceTrimestre } from './calcul.js';
import { remplacer, Zone } from './champs.js';
import type { EtatAtelier } from './etat.js';
import { exportJson, exportMarkdown } from './exports.js';
import { telecharger as telechargerFichier } from './fichiers.js';

// Étape 6 : les actions réparties sur quatre trimestres, puis les exports (JSON pour l'OS,
// Markdown pour le second cerveau). Avec l'écran partagé actif, les exports n'ont rien de privé.
export function FeuilleDeRoute({
  etat,
  onChange,
  partage,
  entreprise,
  telecharger = telechargerFichier,
}: {
  etat: EtatAtelier;
  onChange: (patch: Partial<EtatAtelier>) => void;
  partage: boolean;
  entreprise: string;
  telecharger?: (nom: string, texte: string, mime: string) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const ctx = { entreprise };
  const markdown = () => exportMarkdown(etat, partage, ctx);
  const majAction = (i: number, suite: Partial<EtatAtelier['actions'][number]>) =>
    onChange({ actions: remplacer(etat.actions, i, suite) });

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      setMessage('Fiche copiée');
    } catch {
      setMessage('Copie refusée : utilise le téléchargement');
    }
  };

  return (
    <div className="stack">
      <div className="at-carte">
        <b>Rituel permanent</b> : revue de pipeline chaque semaine, revue des indicateurs chaque
        trimestre.
      </div>
      <div className="at-grille at-grille-4">
        {[0, 1, 2, 3].map((q) => (
          <div className="at-colonne" key={q}>
            <b>Trimestre {q + 1}</b>
            <span className="small muted">échéance {echeanceTrimestre(etat.date, q)}</span>
            {etat.actions.map((a, i) =>
              a.q !== q ? null : (
                <div className={`at-carte${a.on ? '' : ' at-ecartee'}`} key={i}>
                  <input
                    className="at-titre-fait"
                    value={a.bloc}
                    placeholder="Bloc"
                    aria-label="Bloc"
                    onChange={(e) => majAction(i, { bloc: e.target.value })}
                  />
                  <Zone
                    valeur={a.title}
                    etiquette="Action"
                    onChange={(title) => majAction(i, { title })}
                  />
                  <Zone
                    valeur={a.owner}
                    lignes={1}
                    etiquette="Qui"
                    onChange={(owner) => majAction(i, { owner })}
                  />
                  <Zone
                    valeur={a.metric}
                    etiquette="Mesure"
                    onChange={(metric) => majAction(i, { metric })}
                  />
                  <select
                    className="at-select"
                    aria-label="Trimestre"
                    value={a.q}
                    onChange={(e) => majAction(i, { q: Number(e.target.value) })}
                  >
                    {[0, 1, 2, 3].map((k) => (
                      <option key={k} value={k}>
                        Trimestre {k + 1}
                      </option>
                    ))}
                  </select>
                  <div className="at-ligne-outils">
                    <button
                      className="btn"
                      type="button"
                      aria-pressed={a.on}
                      onClick={() => majAction(i, { on: !a.on })}
                    >
                      {a.on ? 'Retenue' : 'Écartée'}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      aria-label="Supprimer l’action"
                      onClick={() => onChange({ actions: etat.actions.filter((_, k) => k !== i) })}
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
              onClick={() =>
                onChange({
                  actions: [
                    ...etat.actions,
                    { q, bloc: '', title: '', owner: '', metric: '', on: true },
                  ],
                })
              }
            >
              Ajouter une action
            </button>
          </div>
        ))}
      </div>
      <div className="at-carte">
        <h3>Ce que l’atelier remet</h3>
        <p className="small muted">
          Pour l’OS : un fichier JSON, une tâche par action retenue. Pour le second cerveau : une
          fiche Markdown, statut brouillon. Écran partagé actif : rien de privé n’en sort.
        </p>
        <div className="at-ligne-outils">
          <button
            className="btn go"
            type="button"
            onClick={() =>
              telecharger(
                `${etat.date}_Feuille_de_route.json`,
                JSON.stringify(exportJson(etat, partage, ctx), null, 2),
                'application/json',
              )
            }
          >
            Télécharger la feuille de route (JSON)
          </button>
          <button
            className="btn"
            type="button"
            onClick={() =>
              telecharger(`${etat.date}_Cadrage_strategique.md`, markdown(), 'text/markdown')
            }
          >
            Télécharger la fiche de cadrage (Markdown)
          </button>
          <button className="btn" type="button" onClick={() => void copier()}>
            Copier la fiche
          </button>
        </div>
        {message && (
          <p className="small" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
