import { useMemo, useState, type ReactNode } from 'react';
import type { OccurrenceRevenu } from '../../api.js';
import { eurCents, jourCourt } from '../../gestion.js';
import { filtrerMouvements, type FiltreMouvement, type Mouvement } from './fusion.js';

const PUCES: [FiltreMouvement, string][] = [
  ['tout', 'Tout'],
  ['depenses', 'Dépenses'],
  ['recettes', 'Recettes'],
  ['prevus', 'Prévus'],
  ['recurrents', 'Récurrents'],
];
const ETATS: Record<Mouvement['etat'], [string, string]> = {
  payee: ['Payée', 'green'],
  prevue: ['Prévue', 'amber'],
  emise: ['Facturée', 'blue'],
  encaissee: ['Encaissée', 'green'],
  ignoree: ['Ignorée', ''],
};

// Liste unique des dépenses et des recettes du mois. Le chargement des données et les tiroirs de
// modification restent dans Gestion : ce composant ne fait qu'afficher et signaler les clics.
export function Mouvements({
  mouvements,
  aFacturer,
  bandeau,
  periode,
  mandats,
  nomAff,
  filtreInitial = 'tout',
  onOuvrir,
  onDupliquer,
  onRetirer,
  onMarquerFacturee,
  onAjouter,
}: {
  mouvements: Mouvement[];
  aFacturer: OccurrenceRevenu[];
  bandeau: { label: string; valeur: string }[];
  periode: ReactNode;
  mandats: string[];
  nomAff: (a: { cible: string; mandat?: string }) => string;
  filtreInitial?: FiltreMouvement;
  onOuvrir: (m: Mouvement) => void;
  onDupliquer: (m: Mouvement) => void;
  onRetirer: (m: Mouvement) => void;
  onMarquerFacturee: (r: OccurrenceRevenu) => void;
  onAjouter: () => void;
}) {
  const [type, setType] = useState<FiltreMouvement>(filtreInitial);
  const [affectation, setAffectation] = useState('');
  const [refacturables, setRefacturables] = useState(false);
  const [recherche, setRecherche] = useState('');

  const visibles = useMemo(
    () => filtrerMouvements(mouvements, { type, affectation, refacturables, recherche }, nomAff),
    [mouvements, type, affectation, refacturables, recherche, nomAff],
  );
  const total = (sens: Mouvement['sens']) =>
    visibles
      .filter((m) => m.sens === sens && m.etat !== 'ignoree')
      .reduce((t, m) => t + Math.abs(m.montantCents), 0);

  return (
    <>
      {bandeau.length > 0 && (
        <div className="panel g-bandeau-tri" style={{ marginBottom: 18 }}>
          {bandeau.map((b) => (
            <div key={b.label}>
              <span className="small muted">{b.label}</span>
              <span className="v num">{b.valeur}</span>
            </div>
          ))}
        </div>
      )}
      {aFacturer.length > 0 && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <h2>Factures à émettre (30 prochains jours)</h2>
            <span className="badge amber">{aFacturer.length}</span>
          </div>
          <table className="tbl">
            <tbody>
              {aFacturer.map((r) => (
                <tr key={r.cle}>
                  <td className="num">{jourCourt(r.date)}</td>
                  <td className="g-lib">
                    <b>{r.libelle}</b>
                    <small>{r.certitude === 'probable' ? 'Probable' : ''}</small>
                  </td>
                  <td className="r num">
                    <b>{eurCents(r.montantHtCents)}</b>
                  </td>
                  <td className="g-act">
                    <button className="btn sm" onClick={() => onMarquerFacturee(r)}>
                      Marquer facturée
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ margin: '8px 18px' }}>
            Marquer facturée enregistre la référence de la facture émise ailleurs : l’OS ne crée
            aucune facture comptable.
          </p>
        </div>
      )}
      <div className="panel">
        <div className="g-filtres">
          {PUCES.map(([k, l]) => (
            <button
              key={k}
              className={`chip ${type === k ? 'on' : ''}`}
              aria-pressed={type === k}
              onClick={() => setType(k)}
            >
              {l}
            </button>
          ))}
          <span className="g-sep" />
          <select
            className="input"
            aria-label="Affectation"
            value={affectation}
            onChange={(e) => setAffectation(e.target.value)}
          >
            <option value="">Toutes les affectations</option>
            {['SIMATIS', 'KAIROS', ...mandats].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <button
            className={`chip ${refacturables ? 'on' : ''}`}
            aria-pressed={refacturables}
            onClick={() => setRefacturables(!refacturables)}
          >
            Refacturables
          </button>
          <span style={{ flex: 1 }} />
          {periode}
          <input
            className="input"
            type="search"
            placeholder="Rechercher un mouvement"
            aria-label="Rechercher"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        {visibles.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mouvement</th>
                <th>Origine</th>
                <th>État</th>
                <th className="r">Montant</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((m) => (
                <tr
                  key={`${m.sens}-${m.cle}`}
                  className={`click ${m.etat === 'ignoree' ? 'muted' : ''}`}
                  onClick={() => onOuvrir(m)}
                >
                  <td className="num">{jourCourt(m.date)}</td>
                  <td className="g-lib">
                    <b>{m.libelle}</b>
                    <small>{m.detail}</small>
                  </td>
                  <td>
                    <span className="badge">{m.origine}</span>
                  </td>
                  <td>
                    <span className={`badge ${ETATS[m.etat][1]}`}>{ETATS[m.etat][0]}</span>
                  </td>
                  <td className={`r num ${m.sens === 'recette' ? 'g-mv-pos' : 'g-mv-neg'}`}>
                    <b>
                      {m.sens === 'recette' ? '+' : '−'} {eurCents(Math.abs(m.montantCents))}
                    </b>{' '}
                    <small className="muted">{m.base}</small>
                  </td>
                  <td className="g-act" onClick={(e) => e.stopPropagation()}>
                    {m.sens === 'depense' && (
                      <button className="btn ghost sm" onClick={() => onDupliquer(m)}>
                        Dupliquer
                      </button>
                    )}
                    <button className="btn ghost sm" onClick={() => onRetirer(m)}>
                      {m.origine === 'Récurrent' ? 'Ignorer' : 'Supprimer'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="panel-b">
            <p className="muted" style={{ margin: 0 }}>
              Aucun mouvement ne correspond.{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onAjouter();
                }}
              >
                Ajouter un mouvement
              </a>
            </p>
          </div>
        )}
        <div className="g-mv-totaux" data-testid="totaux">
          <span>
            <span className="muted small">Dépenses TTC</span>{' '}
            <b className="num">{eurCents(total('depense'))}</b>
          </span>
          <span>
            <span className="muted small">Recettes HT</span>{' '}
            <b className="num">{eurCents(total('recette'))}</b>
          </span>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        Cliquer une ligne pour la modifier. Touche <b>N</b> : nouvelle dépense. Les dépenses sont en
        TTC, les recettes en HT : leurs totaux restent séparés.
      </p>
    </>
  );
}
