import { useEffect, useState } from 'react';
import { saveTva, type SuiviTvaGestion } from '../api.js';
import { eurCents, libelleMois } from '../gestion.js';

// Suivi mensuel de la TVA. Déclaration mensuelle (confirmé) ; exigibilité à confirmer avec le comptable.
// Le montant réellement déclaré se saisit à la main, il n'est jamais transmis.
export function GestionTva({
  slug,
  mois,
  suivi,
  periode,
  onSaved,
}: {
  slug: string;
  mois: string;
  suivi: SuiviTvaGestion | null;
  periode: React.ReactNode;
  onSaved: () => void;
}) {
  const [declaree, setDeclaree] = useState('');
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const d = suivi?.declaree;
    setDeclaree(d?.montantCents == null ? '' : String(d.montantCents / 100).replace('.', ','));
    setNote(d?.note ?? '');
  }, [suivi]);

  const enregistrer = async () => {
    const brut = declaree.trim();
    const n = brut ? Number(brut.replace(/\s/g, '').replace(',', '.')) : null;
    if (n != null && !Number.isFinite(n))
      return setErreur('Le montant déclaré doit être un nombre.');
    try {
      await saveTva(slug, mois, {
        declareeCents: n == null ? null : Math.round(n * 100),
        note: note.trim() || null,
      });
      setErreur(null);
      onSaved();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="alert blue" style={{ marginBottom: 14 }}>
        <div>
          <b>Déclaration mensuelle</b> (confirmée) · <b>exigibilité à confirmer</b> avec le
          comptable : l’estimation ci-dessous retient la date de facture et reste <b>incertaine</b>.
        </div>
      </div>
      <div className="panel g-bandeau-tri" style={{ marginBottom: 18 }}>
        <div>
          <span className="small muted">TVA collectée (estimée)</span>
          <span className="v">{suivi ? eurCents(suivi.collecteeCents) : '–'}</span>
        </div>
        <div>
          <span className="small muted">TVA déductible (estimée)</span>
          <span className="v">{suivi ? eurCents(suivi.deductibleCents) : '–'}</span>
        </div>
        <div>
          <span className="small muted">
            {suivi && suivi.estimeeCents < 0 ? 'Crédit estimé' : 'À payer, estimé'}
          </span>
          <span className="v">{suivi ? eurCents(Math.abs(suivi.estimeeCents)) : '–'}</span>
        </div>
        <div>
          <span className="small muted">Déclaré (saisi)</span>
          <span className="v">
            {suivi?.declaree?.montantCents == null
              ? 'Non renseigné'
              : eurCents(suivi.declaree.montantCents)}
          </span>
        </div>
      </div>
      <div className="panel">
        <div className="panel-h">
          <h2>TVA de {libelleMois(mois)}</h2>
          {periode}
        </div>
        <div className="panel-b">
          {suivi?.avertissements.map((a) => (
            <p className="small muted" key={a} style={{ margin: '0 0 6px' }}>
              {a}
            </p>
          ))}
          {suivi && suivi.recettesIncertainesExclues > 0 && (
            <p className="small muted">
              {suivi.recettesIncertainesExclues} recette(s) probable(s) ou hypothétique(s) exclue(s)
              de l’estimation.
            </p>
          )}
          <form
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              void enregistrer();
            }}
            style={{ marginTop: 12 }}
          >
            <div className="g-champs2">
              <label className="field">
                <span>Montant réellement déclaré (€)</span>
                <input
                  className="input num"
                  inputMode="decimal"
                  value={declaree}
                  onChange={(e) => setDeclaree(e.target.value)}
                  placeholder="Non renseigné"
                />
              </label>
              <label className="field">
                <span>Note</span>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            {erreur && (
              <div className="alert red" role="alert">
                {erreur}
              </div>
            )}
            <button className="btn primary" type="submit">
              Enregistrer
            </button>
            <span className="small muted" style={{ marginLeft: 10 }}>
              Saisie manuelle : rien n’est transmis à l’administration.
            </span>
          </form>
        </div>
      </div>
    </>
  );
}
