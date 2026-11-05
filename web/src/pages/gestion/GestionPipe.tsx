import { useState } from 'react';
import type { AffairePipe, HypothesePipe } from '../../api.js';
import { eurCents } from '../../gestion.js';
import type { Verdict } from './verdict.js';

const RAISONS: Partial<Record<AffairePipe['statut'], string>> = {
  sans_date: 'Sans date',
  sans_montant: 'Sans montant',
  sans_probabilite: 'Sans probabilité',
};
// La date ne part au serveur qu'une fois la saisie finie (sortie du champ) et plausible : Chrome émet
// une valeur à chaque chiffre tapé, y compris des années comme 0002.
function ChampDate({
  valeur,
  label,
  onValider,
}: {
  valeur: string | null;
  label: string;
  onValider: (date: string | null) => void;
}) {
  const [saisie, setSaisie] = useState(valeur ?? '');
  const valider = () => {
    if (saisie === (valeur ?? '')) return;
    if (saisie === '') onValider(null);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(saisie) && Number(saisie.slice(0, 4)) >= 2000)
      onValider(saisie);
    else setSaisie(valeur ?? '');
  };
  return (
    <input
      className="input"
      type="date"
      value={saisie}
      aria-label={label}
      onChange={(e) => setSaisie(e.target.value)}
      onBlur={valider}
    />
  );
}
// Nombre saisi pour la simulation : validé à la sortie du champ, vide = retour à la valeur du Pipeline.
function ChampNombre({
  valeur,
  label,
  max,
  onValider,
}: {
  valeur: number | null;
  label: string;
  max: number;
  onValider: (n: number | null) => void;
}) {
  const [saisie, setSaisie] = useState(valeur == null ? '' : String(valeur));
  const valider = () => {
    const n = saisie.trim() === '' ? null : Number(saisie.replace(',', '.'));
    if (n === valeur) return;
    if (n === null || (Number.isFinite(n) && n >= 0 && n <= max)) onValider(n);
    else setSaisie(valeur == null ? '' : String(valeur));
  };
  return (
    <input
      className="input"
      type="number"
      min={0}
      max={max}
      step="any"
      style={{ width: 110 }}
      value={saisie}
      aria-label={label}
      onChange={(e) => setSaisie(e.target.value)}
      onBlur={valider}
    />
  );
}
const pondere = (a: AffairePipe) => Math.round((a.totalCents * (a.probabilite ?? 0)) / 100);

// Phrase d'ouverture de Pilotage : le serveur a déjà calculé les alertes, on ne fait que les dire.
export function VerdictBandeau({ verdict }: { verdict: Verdict }) {
  return (
    <div className={`g-verdict ${verdict.niveau}`} role="status">
      <span className="g-verdict-dot" />
      <div>
        <b>{verdict.titre}</b>
        <span>{verdict.texte}</span>
      </div>
    </div>
  );
}

// Les affaires ouvertes du Pipeline vues comme des encaissements futurs. Rien ici n'est écrit chez
// un tiers : la date est celle de l'OS, l'interrupteur et le curseur sont des simulations d'affichage.
export function GestionPipe({
  affaires,
  decalage,
  exclus,
  onDecalage,
  onExclus,
  onDate,
  inclure,
  hypotheses,
  onInclure,
  onHypothese,
  onReinitialiser,
}: {
  affaires: AffairePipe[];
  decalage: number;
  exclus: string[];
  onDecalage: (mois: number) => void;
  onExclus: (ids: string[]) => void;
  onDate: (id: string, date: string | null) => void;
  inclure: boolean;
  hypotheses: Record<string, HypothesePipe>;
  onInclure: (inclure: boolean) => void;
  onHypothese: (id: string, h: HypothesePipe | null) => void;
  onReinitialiser: () => void;
}) {
  const compte = (a: AffairePipe) => a.statut === 'comptee' && !exclus.includes(a.id);
  const total = affaires.filter(compte).reduce((t, a) => t + pondere(a), 0);
  const totalBrut = affaires.filter(compte).reduce((t, a) => t + a.totalCents, 0);
  // Une hypothèse vide retombe sur la valeur du Pipeline : on ne garde que les champs réglés.
  const regler = (id: string, champ: keyof HypothesePipe, n: number | null) => {
    const h = { ...hypotheses[id], [champ]: n };
    onHypothese(id, h.montant == null && h.probabilite == null ? null : h);
  };
  const sansDate = affaires.filter((a) => a.statut === 'sans_date').length;
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div className="panel-h">
        <h2>Ce que le pipe apporte</h2>
        <span className="badge blue">relié au Pipeline</span>
      </div>
      <div className="panel-b">
        {affaires.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Aucune affaire ouverte dans le Pipeline : rien n’est ajouté à la projection.
          </p>
        ) : (
          <>
            <p className="muted small" style={{ margin: '0 0 10px' }}>
              Chaque affaire est encaissée après sa signature et le délai de paiement. Chaque
              scénario la compte à sa façon (pondérée, au montant total, ou pas du tout) : voir les
              réglages de trésorerie. La date, le montant et la probabilité sont propres à la
              simulation : les modifier ne change rien dans HubSpot ni dans le Pipeline.
            </p>
            <div className="g-whatif">
              <label>
                <input
                  type="checkbox"
                  checked={inclure}
                  onChange={(e) => onInclure(e.target.checked)}
                />{' '}
                <b>Inclure le pipe dans la projection</b>
              </label>
              {Object.keys(hypotheses).length > 0 && (
                <button type="button" className="btn" onClick={onReinitialiser}>
                  Réinitialiser les hypothèses
                </button>
              )}
            </div>
            {!inclure && (
              <p className="small" style={{ margin: '0 0 10px' }}>
                <span className="badge amber">pipe exclu</span> La projection ne compte que le
                facturé, les récurrents et les dépenses.
              </p>
            )}
            <div className="g-whatif">
              <b>Et si les signatures glissent ?</b>
              <input
                type="range"
                min={0}
                max={6}
                step={1}
                value={decalage}
                aria-label="Décalage des signatures (mois)"
                onChange={(e) => onDecalage(Number(e.target.value))}
              />
              <span className="num">{decalage ? `+${decalage} mois` : 'aucun retard'}</span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Compter</th>
                  <th>Affaire</th>
                  <th>Probabilité</th>
                  <th className="r">Montant</th>
                  <th>Signature estimée</th>
                  <th className="r">Pondéré</th>
                </tr>
              </thead>
              <tbody>
                {affaires.map((a) => {
                  const raison = RAISONS[a.statut];
                  return (
                    <tr key={a.id} className={raison ? 'sans' : exclus.includes(a.id) ? 'off' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={a.statut === 'comptee' && !exclus.includes(a.id)}
                          disabled={a.statut !== 'comptee'}
                          aria-label={`Compter ${a.titre}`}
                          onChange={(e) =>
                            onExclus(
                              e.target.checked
                                ? exclus.filter((x) => x !== a.id)
                                : [...exclus, a.id],
                            )
                          }
                        />
                      </td>
                      <td className="g-lib">
                        <b>{a.titre}</b>
                        <small>
                          {a.entreprise ?? ''}
                          {raison && (
                            <>
                              {a.entreprise ? ' · ' : ''}
                              <span className="badge amber">{raison}</span>
                            </>
                          )}
                        </small>
                      </td>
                      <td>
                        <ChampNombre
                          key={`${a.id}-p-${a.probabilite ?? ''}`}
                          valeur={a.probabilite}
                          label={`Probabilité ${a.titre} (%)`}
                          max={100}
                          onValider={(n) => regler(a.id, 'probabilite', n)}
                        />{' '}
                        %
                      </td>
                      <td className="r num">
                        <ChampNombre
                          key={`${a.id}-m-${a.recurrent ? a.mensuelCents : a.totalCents}`}
                          valeur={
                            a.recurrent
                              ? a.mensuelCents == null
                                ? null
                                : a.mensuelCents / 100
                              : a.totalCents
                                ? a.totalCents / 100
                                : null
                          }
                          label={`Montant ${a.titre} (€${a.recurrent ? ' / mois' : ''})`}
                          max={999_999_999}
                          onValider={(n) => regler(a.id, 'montant', n)}
                        />{' '}
                        €{a.recurrent ? ' / mois' : ''}
                        {a.surcharge && (
                          <>
                            {' '}
                            <span className="badge amber">modifié</span>
                          </>
                        )}
                      </td>
                      <td>
                        <ChampDate
                          key={`${a.id}-${a.signature ?? ''}`}
                          valeur={a.signature}
                          label={`Signature estimée ${a.titre}`}
                          onValider={(date) => onDate(a.id, date)}
                        />
                      </td>
                      <td className="r num">
                        <b>{a.statut === 'comptee' ? eurCents(pondere(a)) : '–'}</b>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="r">
                    <b>Valeur pondérée des affaires comptées</b>
                  </td>
                  <td className="r num" data-testid="total-pipe">
                    <b>{eurCents(total)}</b>
                  </td>
                </tr>
                <tr>
                  <td colSpan={5} className="r">
                    <b>Montant total des affaires comptées</b>
                  </td>
                  <td className="r num" data-testid="total-brut-pipe">
                    <b>{eurCents(totalBrut)}</b>
                  </td>
                </tr>
              </tfoot>
            </table>
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              Les affaires décochées ne sont pas mémorisées. Si une affaire est déjà facturée dans
              Gestion, décochez-la pour ne pas la compter deux fois.
            </p>
            {sansDate > 0 && (
              <p className="small" style={{ margin: '10px 0 0' }}>
                <span className="badge amber">{sansDate} sans date</span> Elle n’entre pas dans la
                projection tant que sa date de signature n’est pas estimée.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
