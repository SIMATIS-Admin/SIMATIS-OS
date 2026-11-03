import type { AffairePipe } from '../../api.js';
import { eurCents, jourCourt } from '../../gestion.js';
import type { Verdict } from './verdict.js';

const RAISONS: Partial<Record<AffairePipe['statut'], string>> = {
  sans_date: 'Sans date',
  sans_montant: 'Sans montant',
  sans_probabilite: 'Sans probabilité',
};
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
}: {
  affaires: AffairePipe[];
  decalage: number;
  exclus: string[];
  onDecalage: (mois: number) => void;
  onExclus: (ids: string[]) => void;
  onDate: (id: string, date: string | null) => void;
}) {
  const compte = (a: AffairePipe) => a.statut === 'comptee' && !exclus.includes(a.id);
  const total = affaires.filter(compte).reduce((t, a) => t + pondere(a), 0);
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
              Chaque affaire compte pour <b>montant × probabilité</b>, encaissée après sa signature
              et le délai de paiement. La date de signature est propre à l’OS : la modifier ne
              change rien dans HubSpot.
            </p>
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
                      <td className="num">{a.probabilite == null ? '–' : `${a.probabilite} %`}</td>
                      <td className="r num">
                        {a.recurrent && a.mensuelCents
                          ? `${eurCents(a.mensuelCents)} / mois`
                          : eurCents(a.totalCents)}
                      </td>
                      <td>
                        <input
                          className="input"
                          type="date"
                          value={a.signature ?? ''}
                          aria-label={`Signature estimée ${a.titre}`}
                          title={a.signature ? jourCourt(a.signature) : undefined}
                          onChange={(e) => onDate(a.id, e.target.value || null)}
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
                    <b>Total pondéré pris en compte</b>
                  </td>
                  <td className="r num" data-testid="total-pipe">
                    <b>{eurCents(total)}</b>
                  </td>
                </tr>
              </tfoot>
            </table>
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
