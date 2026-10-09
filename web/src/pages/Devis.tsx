import { useCallback, useEffect, useState } from 'react';
import {
  fetchDevis,
  fetchPipeline,
  preparerDevis,
  saveLignesDevis,
  transmettreDevis,
  validerDevis,
  type DevisItem,
  type LigneDevis,
  type PipelineOpp,
} from '../api.js';
import { eur } from '../crm.js';
import { Icon } from '../icons.js';

const STATUT: Record<DevisItem['statut'], [string, string]> = {
  brouillon: ['Brouillon', 'amber'],
  valide: ['Validé par vous', 'blue'],
  transmis: ['Transmis', 'green'],
};

function Editeur({ slug, d, onChange }: { slug: string; d: DevisItem; onChange: () => void }) {
  const [lignes, setLignes] = useState<LigneDevis[]>(d.lignes);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setLignes(d.lignes), [d]);
  const edit = d.statut === 'brouillon';
  const manque = lignes.some((l) => l.prixUnitaire === null);
  const total = lignes.reduce((a, l) => a + (l.prixUnitaire ?? 0) * l.quantite, 0);
  const err = (e: unknown) => setMessage(e instanceof Error ? e.message : String(e));

  const prix = (k: number, valeur: string) => {
    const next = lignes.map((l, i) =>
      i === k
        ? { ...l, prixUnitaire: valeur === '' ? null : Math.max(0, Math.round(Number(valeur))) }
        : l,
    );
    setLignes(next);
    saveLignesDevis(slug, d.id, next).catch(err);
  };

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div className="panel-h">
        <div>
          <h2>{d.numero}</h2>
          <div className="small muted">
            {d.entreprise ?? '—'}, {d.opportunite}
          </div>
        </div>
        <span className={`badge ${STATUT[d.statut][1]}`}>{STATUT[d.statut][0]}</span>
      </div>
      <div className="panel-b stack">
        {edit && (
          <div className="alert amber">
            <Icon name="lock" />
            <div>
              Les prix restent vides tant que vous ne les fixez pas : l'OS ne propose jamais de prix
              ni de remise.
            </div>
          </div>
        )}
        <table className="tbl">
          <thead>
            <tr>
              <th>Désignation</th>
              <th className="r">Qté</th>
              <th className="r">Prix unitaire</th>
              <th className="r">Total</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, k) => (
              <tr key={k}>
                <td>{l.libelle}</td>
                <td className="r num">{l.quantite}</td>
                <td className="r">
                  {edit ? (
                    <input
                      className="input num"
                      style={{ width: 120, textAlign: 'right' }}
                      type="number"
                      min={0}
                      step={100}
                      placeholder="à fixer"
                      aria-label={`Prix unitaire : ${l.libelle}`}
                      value={l.prixUnitaire ?? ''}
                      onChange={(e) => prix(k, e.target.value)}
                    />
                  ) : (
                    eur(l.prixUnitaire ?? 0)
                  )}
                </td>
                <td className="r">
                  {l.prixUnitaire === null ? (
                    <span className="muted">–</span>
                  ) : (
                    eur(l.prixUnitaire * l.quantite)
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="r">
                <b>Total HT</b>
              </td>
              <td className="r">
                <b>{manque ? <span className="muted">à fixer</span> : eur(total)}</b>
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {edit && (
            <button
              className="btn primary"
              disabled={manque}
              title={manque ? "Fixez tous les prix d'abord" : undefined}
              onClick={() => void validerDevis(slug, d.id).then(onChange, err)}
            >
              Valider le devis
            </button>
          )}
          {d.statut === 'valide' && (
            <button
              className="btn go"
              onClick={() =>
                void transmettreDevis(slug, d.id).then(
                  () =>
                    setMessage(
                      'Transmission proposée : validez-la dans À valider, c’est un engagement auprès du client.',
                    ),
                  err,
                )
              }
            >
              <Icon name="send" />
              Transmettre au client
            </button>
          )}
        </div>
        {d.statut === 'transmis' && d.envoyeLe && (
          <p className="small muted" style={{ margin: 0 }}>
            Transmis le {new Date(d.envoyeLe).toLocaleDateString('fr-FR')}
            {d.validite
              ? `, valable jusqu'au ${new Date(d.validite).toLocaleDateString('fr-FR')}`
              : ''}
            .
          </p>
        )}
        {message && <p className="small">{message}</p>}
      </div>
    </div>
  );
}

export function Devis({ slug }: { slug: string }) {
  const [list, setList] = useState<DevisItem[] | null>(null);
  const [opps, setOpps] = useState<PipelineOpp[]>([]);
  const [choix, setChoix] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchDevis(slug).then(setList, (e: unknown) => setError(String(e)));
  }, [slug]);
  useEffect(() => {
    load();
    fetchPipeline(slug).then(
      (p) => setOpps(p.opportunites.filter((o) => !o.clos)),
      () => setOpps([]),
    );
  }, [slug, load]);

  if (error) return <div className="empty">{error}</div>;
  if (!list) return null;
  const courant = list.find((d) => d.id === selection);
  const nouveau = () =>
    preparerDevis(slug, choix).then(
      (d) => {
        setSelection(d.id);
        load();
      },
      (e: unknown) => setError(String(e)),
    );

  return (
    <>
      <div className="panel">
        {list.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Client</th>
                <th>Statut</th>
                <th className="r">Montant</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className="click" onClick={() => setSelection(d.id)}>
                  <td className="num">{d.numero}</td>
                  <td>
                    <b>{d.entreprise ?? '—'}</b>
                    <div className="small muted">{d.opportunite}</div>
                  </td>
                  <td>
                    <span className={`badge ${STATUT[d.statut][1]}`}>{STATUT[d.statut][0]}</span>
                  </td>
                  <td className="r">
                    {d.prixManquant ? <span className="muted">prix à fixer</span> : eur(d.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Aucun devis. Préparez-en un à partir d'une opportunité.</div>
        )}
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-b" style={{ display: 'flex', gap: 8 }}>
          <select
            className="input"
            aria-label="Opportunité"
            value={choix}
            onChange={(e) => setChoix(e.target.value)}
          >
            <option value="">Choisir une opportunité ouverte…</option>
            {opps.map((o) => (
              <option key={o.id} value={o.id}>
                {o.entreprise ? `${o.entreprise} : ` : ''}
                {o.titre}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={!choix} onClick={() => void nouveau()}>
            Préparer un devis
          </button>
        </div>
      </div>
      {courant && <Editeur slug={slug} d={courant} onChange={load} />}
    </>
  );
}
