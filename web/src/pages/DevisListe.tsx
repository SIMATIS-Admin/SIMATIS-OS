import type { DevisItem } from '../api.js';
import { eur } from '../crm.js';

export const STATUT: Record<DevisItem['statut'], [string, string]> = {
  brouillon: ['Brouillon', 'amber'],
  valide: ['Validé', 'blue'],
  transmis: ['Envoyé', 'navy'],
  accepte: ['Accepté', 'green'],
  refuse: ['Refusé', 'red'],
};

export function DevisListe({
  liste,
  onOuvrir,
}: {
  liste: DevisItem[];
  onOuvrir: (id: string) => void;
}) {
  const envoyes = liste.filter((d) => d.statut === 'transmis');
  const enAttente = envoyes.reduce((a, d) => a + d.totaux.ht, 0);
  const aFixer = liste.filter((d) => d.totaux.prixManquant).length;
  return (
    <>
      <div className="d-kpis">
        <div className="panel">
          <div className="panel-b">
            <span className="muted small">En attente de réponse</span>
            <span className="v">{eur(enAttente)}</span>
            <span className="muted small">{envoyes.length} devis envoyé(s) · HT</span>
          </div>
        </div>
        <div className="panel">
          <div className="panel-b">
            <span className="muted small">Prix à fixer</span>
            <span className="v">{aFixer}</span>
            <span className="muted small">brouillon(s) incomplet(s)</span>
          </div>
        </div>
      </div>
      <div className="panel">
        {liste.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Client</th>
                <th>Mission</th>
                <th>Statut</th>
                <th className="r">Montant HT</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((d) => (
                <tr key={d.id} className="click" onClick={() => onOuvrir(d.id)}>
                  <td className="num">{d.numero}</td>
                  <td>
                    <b>{d.entreprise ?? '—'}</b>
                    {d.contact && <div className="small muted">{d.contact}</div>}
                  </td>
                  <td>{d.titre || d.opportunite}</td>
                  <td>
                    <span className={`badge ${STATUT[d.statut][1]}`}>{STATUT[d.statut][0]}</span>
                    {d.versions > 1 && <div className="small muted">version {d.version}</div>}
                  </td>
                  <td className="r">
                    {d.totaux.prixManquant ? (
                      <span className="badge amber">prix à fixer</span>
                    ) : (
                      eur(d.totaux.ht)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Aucun devis. Préparez-en un à partir d’une affaire.</div>
        )}
      </div>
    </>
  );
}
