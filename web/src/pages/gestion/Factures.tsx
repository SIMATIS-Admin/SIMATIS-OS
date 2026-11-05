import { useState } from 'react';
import type { FactureAEmettre, FacturesAEmettre, LigneFacture } from '../../api.js';
import { eurCents, jourCourt } from '../../gestion.js';

const SORTES: [LigneFacture['sorte'], string][] = [
  ['recurrent', 'Récurrent'],
  ['commission', 'Commission'],
  ['frais', 'Frais'],
  ['ik', 'IK'],
];

function Lignes({ lignes }: { lignes: LigneFacture[] }) {
  return (
    <table className="tbl">
      <tbody>
        {lignes.map((l) => (
          <tr key={l.cle}>
            <td className="num">{jourCourt(l.date)}</td>
            <td className="g-lib" style={{ textAlign: 'left' }}>
              <b>{l.libelle}</b>
              {l.avertissement && (
                <small style={{ color: 'var(--amber-ink, #92400e)' }}>{l.avertissement}</small>
              )}
              {l.certitude === 'probable' && <small>Probable</small>}
            </td>
            <td className="r num">
              {l.montantHtCents == null ? (
                <span className="muted">Montant inconnu</span>
              ) : (
                <b>{eurCents(l.montantHtCents)}</b>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Delai({
  facture,
  onDelai,
}: {
  facture: FactureAEmettre;
  onDelai: (mandat: string, jours: number | null) => void;
}) {
  const [saisie, setSaisie] = useState(
    facture.delaiJours == null ? '' : String(facture.delaiJours),
  );
  const valider = () => {
    const n = Number(saisie);
    const jours = saisie.trim() === '' || !Number.isInteger(n) || n < 0 ? null : n;
    onDelai(facture.mandat, jours);
  };
  return (
    <label className="field" style={{ maxWidth: 220 }}>
      <span>Délai de paiement (jours)</span>
      <input
        className="input num"
        inputMode="numeric"
        value={saisie}
        placeholder="Délai général"
        onChange={(e) => setSaisie(e.target.value)}
        onBlur={valider}
      />
    </label>
  );
}

export function Factures({
  donnees,
  mandats,
  onDelai,
}: {
  donnees: FacturesAEmettre;
  mandats: { slug: string; nom: string }[];
  onDelai: (mandat: string, jours: number | null) => void;
}) {
  const nom = (slug: string) => mandats.find((m) => m.slug === slug)?.nom ?? slug;
  if (!donnees.factures.length && !donnees.sansMandat.length)
    return (
      <div className="panel" style={{ padding: 18 }}>
        <p className="muted">Rien à facturer</p>
      </div>
    );
  return (
    <>
      {donnees.factures.map((f) => (
        <section
          key={f.mandat}
          className="panel"
          aria-label={nom(f.mandat)}
          style={{ marginBottom: 18 }}
        >
          <div className="panel-h">
            <h2>{nom(f.mandat)}</h2>
            <span className="badge blue num">{eurCents(f.totalHtCents)} HT</span>
          </div>
          <p className="small muted" style={{ margin: '0 18px 8px' }}>
            Émission prévue le {jourCourt(f.emissionPrevue)}
            {f.encaissementAttendu
              ? ` · encaissement attendu le ${jourCourt(f.encaissementAttendu)}`
              : ''}
          </p>
          {f.avertissements.map((a) => (
            <p key={a} className="alert amber" style={{ margin: '0 18px 8px' }}>
              {a}
            </p>
          ))}
          {SORTES.map(([sorte, titre]) => {
            const lignes = f.lignes.filter((l) => l.sorte === sorte);
            if (!lignes.length) return null;
            return (
              <div key={sorte}>
                <h3 style={{ margin: '8px 18px' }}>{titre}</h3>
                <Lignes lignes={lignes} />
              </div>
            );
          })}
          <div style={{ margin: '12px 18px' }}>
            <Delai facture={f} onDelai={onDelai} />
          </div>
        </section>
      ))}
      {donnees.sansMandat.length > 0 && (
        <section className="panel" aria-label="Recettes sans mandat" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <h2>Recettes sans mandat</h2>
          </div>
          <p className="small muted" style={{ margin: '0 18px 8px' }}>
            Ces recettes ne sont dans aucune facture : rattachez-les à un mandat.
          </p>
          <Lignes lignes={donnees.sansMandat} />
        </section>
      )}
    </>
  );
}
