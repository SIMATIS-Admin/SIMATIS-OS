import { useEffect, useState } from 'react';
import { fetchPipeline, type PipelineOpp } from '../api.js';
import { eur } from '../crm.js';

// Un devis part toujours d'une affaire du pipeline : le client, l'interlocuteur et l'intitulé en sont repris.
export function DevisAffaire({
  slug,
  avecDevis,
  onChoisir,
}: {
  slug: string;
  avecDevis: Set<string>;
  onChoisir: (opportuniteId: string) => void;
}) {
  const [opps, setOpps] = useState<PipelineOpp[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    fetchPipeline(slug).then(
      (p) => setOpps(p.opportunites.filter((o) => !o.clos)),
      () => setOpps([]),
    );
  }, [slug]);
  if (!opps) return <div className="empty">Chargement des affaires…</div>;
  const trouvees = opps
    .filter((o) => `${o.entreprise ?? ''} ${o.titre}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.etape === 'proposition') - Number(a.etape === 'proposition'));
  return (
    <>
      <p style={{ margin: '0 0 10px' }}>
        <b>Pour quelle affaire ?</b> Le reste est repris de l’affaire.
      </p>
      <input
        className="input"
        style={{ marginBottom: 12 }}
        placeholder="Rechercher une affaire ou un client"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="panel">
        <table className="tbl">
          <tbody>
            {trouvees.map((o) => (
              <tr key={o.id}>
                <td>
                  <b>{o.entreprise ?? '—'}</b>
                  <div className="small muted">{o.titre}</div>
                </td>
                <td>
                  <span className={`badge ${o.etape === 'proposition' ? 'blue' : 'navy'}`}>
                    {o.etape}
                  </span>
                </td>
                <td className="r num">
                  {o.montant === null
                    ? '—'
                    : `${eur(o.montant)}${o.modeFacturation === 'recurrent' ? ' / mois' : ''}`}
                </td>
                <td className="r">
                  <button
                    className={`btn sm ${avecDevis.has(o.id) ? '' : 'primary'}`}
                    onClick={() => onChoisir(o.id)}
                  >
                    {avecDevis.has(o.id) ? 'Ouvrir le devis' : 'Préparer le devis'}
                  </button>
                </td>
              </tr>
            ))}
            {!trouvees.length && (
              <tr>
                <td className="empty">Aucune affaire trouvée</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
