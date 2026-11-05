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
  // Le champ montre le délai propre au mandat ; le délai général n'est qu'un repli affiché en indice.
  const initial = facture.delaiMandatJours == null ? '' : String(facture.delaiMandatJours);
  const [saisie, setSaisie] = useState(initial);
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = () => {
    const texte = saisie.trim();
    const n = Number(texte);
    const valide = texte === '' || (/^\d+$/.test(texte) && n >= 0 && n <= 365);
    if (!valide) return setErreur('Indiquez un nombre entier de jours entre 0 et 365.');
    setErreur(null);
    if (texte === initial) return;
    onDelai(facture.mandat, texte === '' ? null : n);
  };
  return (
    <label className="field" style={{ maxWidth: 260 }}>
      <span>Délai de paiement (jours)</span>
      <input
        className="input num"
        inputMode="numeric"
        value={saisie}
        placeholder={
          facture.delaiJours == null
            ? 'Aucun délai défini'
            : `Délai général : ${facture.delaiJours}`
        }
        aria-invalid={erreur != null}
        onChange={(e) => setSaisie(e.target.value)}
        onBlur={valider}
      />
      {erreur && <small role="alert">{erreur}</small>}
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
