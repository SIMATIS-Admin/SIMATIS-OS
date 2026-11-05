import { useState } from 'react';
import type {
  EmissionFacture,
  FactureAEmettre,
  FactureEmise,
  FacturesAEmettre,
  LigneFacture,
} from '../../api.js';
import { aujourdhui, eurCents, jourCourt } from '../../gestion.js';

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

function FormulaireEmission({
  facture,
  onEmettre,
  onFermer,
}: {
  facture: FactureAEmettre;
  // `false` = refusée : le formulaire reste ouvert avec ce qui a été saisi.
  onEmettre: (e: EmissionFacture) => Promise<boolean> | void;
  onFermer: () => void;
}) {
  const [numero, setNumero] = useState('');
  const [dateEmission, setDateEmission] = useState(aujourdhui());
  const [exclues, setExclues] = useState<string[]>([]);
  const bascule = (cle: string) =>
    setExclues((l) => (l.includes(cle) ? l.filter((x) => x !== cle) : [...l, cle]));
  return (
    <form
      style={{ margin: '12px 18px' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!numero.trim()) return;
        void (async () => {
          const ok = await onEmettre({
            mandat: facture.mandat,
            numero: numero.trim(),
            dateEmission,
            exclure: exclues,
          });
          if (ok !== false) onFermer();
        })();
      }}
    >
      <div className="g-champs2">
        <label className="field">
          <span>Numéro de la facture</span>
          <input className="input" value={numero} onChange={(e) => setNumero(e.target.value)} />
        </label>
        <label className="field">
          <span>Date d’émission</span>
          <input
            className="input"
            type="date"
            value={dateEmission}
            onChange={(e) => setDateEmission(e.target.value)}
          />
        </label>
      </div>
      {facture.lignes
        .filter((l) => l.montantHtCents != null)
        .map((l) => (
          <label key={l.cle} className="check" style={{ display: 'block' }}>
            <input
              type="checkbox"
              aria-label={`Inclure ${l.libelle}`}
              checked={!exclues.includes(l.cle)}
              onChange={() => bascule(l.cle)}
            />
            &nbsp;{l.libelle} · {eurCents(l.montantHtCents!)}
          </label>
        ))}
      <p className="small muted">
        Une ligne décochée reste à émettre. L’OS n’établit pas le document de facture : il
        enregistre celle que vous avez émise ailleurs.
      </p>
      <button className="btn primary" type="submit" disabled={!numero.trim()}>
        Émettre
      </button>{' '}
      <button className="btn" type="button" onClick={onFermer}>
        Annuler
      </button>
    </form>
  );
}

function Emise({
  facture,
  mandat,
  onEncaisser,
}: {
  facture: FactureEmise;
  mandat: string;
  onEncaisser: (id: string, date: string) => void;
}) {
  const [date, setDate] = useState(aujourdhui());
  return (
    <tr>
      <td className="num">{jourCourt(facture.dateEmission)}</td>
      <td className="g-lib" style={{ textAlign: 'left' }}>
        <b>{facture.numero}</b>
        <small>{mandat}</small>
      </td>
      <td className="r num">
        <b>{eurCents(facture.totalHtCents)}</b>
      </td>
      <td>
        {facture.etat === 'encaissee' ? (
          <span className="badge green">
            Encaissée{facture.dateEncaissement ? ` le ${jourCourt(facture.dateEncaissement)}` : ''}
          </span>
        ) : (
          <>
            <input
              className="input"
              type="date"
              aria-label={`Date d’encaissement de ${facture.numero}`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />{' '}
            <button className="btn sm" onClick={() => onEncaisser(facture.id, date)}>
              Marquer encaissée
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

export function Factures({
  donnees,
  mandats,
  onDelai,
  emises,
  onEmettre,
  onEncaisser,
}: {
  donnees: FacturesAEmettre;
  mandats: { slug: string; nom: string }[];
  onDelai: (mandat: string, jours: number | null) => void;
  emises: FactureEmise[];
  onEmettre: (e: EmissionFacture) => Promise<boolean> | void;
  onEncaisser: (id: string, date: string) => void;
}) {
  const nom = (slug: string) => mandats.find((m) => m.slug === slug)?.nom ?? slug;
  const [ouverte, setOuverte] = useState<string | null>(null);
  if (!donnees.factures.length && !donnees.sansMandat.length && !emises.length)
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
          {ouverte === f.mandat ? (
            <FormulaireEmission
              facture={f}
              onEmettre={onEmettre}
              onFermer={() => setOuverte(null)}
            />
          ) : (
            <div style={{ margin: '0 18px 12px' }}>
              <button className="btn primary" onClick={() => setOuverte(f.mandat)}>
                Émettre la facture
              </button>
            </div>
          )}
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
      {emises.length > 0 && (
        <section className="panel" aria-label="Factures émises" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <h2>Factures émises</h2>
          </div>
          <table className="tbl">
            <tbody>
              {emises.map((f) => (
                <Emise key={f.id} facture={f} mandat={nom(f.mandat)} onEncaisser={onEncaisser} />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
