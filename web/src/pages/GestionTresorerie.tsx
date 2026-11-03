import { useEffect, useMemo, useState } from 'react';
import {
  saveReglagesGestion,
  type PeriodeTresorerie,
  type ProjectionTresorerie,
  type ReglagesGestion,
} from '../api.js';
import { eurCents, jourCourt, libelleMois, versCents } from '../gestion.js';

const HORIZONS = [1, 3, 6, 12, 24];
const SCENARIOS: [ProjectionTresorerie['scenarios'][number]['scenario'], string, string][] = [
  ['securise', 'Sécurisé', 'var(--navy)'],
  ['central', 'Central', 'var(--teal)'],
  ['ambitieux', 'Ambitieux', 'var(--teal-mid, #7cc4b8)'],
];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type ParamsTresorerie = {
  horizon: number;
  granularite: 'mois' | 'semaine';
  retard: number;
  // Calculs d'affichage du pipe : décalage des signatures (mois) et affaires que Marc ne veut pas compter.
  decalage: number;
  exclus: string[];
};

const libellePeriode = (p: PeriodeTresorerie, g: 'mois' | 'semaine') =>
  g === 'mois' ? libelleMois(p.debut.slice(0, 7)) : `Semaine du ${jourCourt(p.debut)}`;

// Projection de trésorerie : trois scénarios, seuil d'alerte, chaque période explicable en un clic.
export function GestionTresorerie({
  slug,
  projection,
  params,
  onParams,
  onReglagesSaved,
}: {
  slug: string;
  projection: ProjectionTresorerie | null;
  params: ParamsTresorerie;
  onParams: (p: ParamsTresorerie) => void;
  onReglagesSaved: () => void;
}) {
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number][0]>('central');
  const [choisie, setChoisie] = useState<number | null>(null);
  const [retard, setRetard] = useState(String(params.retard || ''));
  const [reglage, setReglage] = useState(false);

  useEffect(() => setChoisie(null), [params.horizon, params.granularite, scenario]);

  const serie = projection?.scenarios.find((s) => s.scenario === scenario);
  const sansSolde = projection ? projection.reglages.soldeCents == null : false;
  const valeur = (p: PeriodeTresorerie) =>
    p.soldeFinCents == null ? p.variationCumuleeCents : p.soldeFinCents;

  const { min, max } = useMemo(() => {
    const vals = (projection?.scenarios ?? []).flatMap((s) => s.periodes.map(valeur));
    if (projection?.seuil.cents != null && !sansSolde) vals.push(projection.seuil.cents);
    vals.push(0);
    return { min: Math.min(...vals), max: Math.max(...vals, 1) };
  }, [projection, sansSolde]);

  const L = 760;
  const H = 220;
  const marge = { g: 8, d: 8, h: 12, b: 24 };
  const n = serie?.periodes.length ?? 0;
  const x = (i: number) =>
    marge.g + (n <= 1 ? (L - marge.g - marge.d) / 2 : (i * (L - marge.g - marge.d)) / (n - 1));
  const y = (v: number) => marge.h + ((max - v) * (H - marge.h - marge.b)) / Math.max(1, max - min);
  const periodeChoisie = serie && choisie != null ? serie.periodes[choisie] : null;

  return (
    <>
      {projection?.avertissements.map((a) => (
        <div className="alert blue" key={a} style={{ marginBottom: 10 }}>
          <div>{a}</div>
        </div>
      ))}
      {serie?.alerte && (
        <div className="alert red" role="alert" style={{ marginBottom: 10 }}>
          <div>
            Dans ce scénario, le solde passe sous le seuil d’alerte (
            {eurCents(projection!.seuil.cents!)}) à partir de{' '}
            {libellePeriode({ debut: serie.alerte.debut } as PeriodeTresorerie, params.granularite)}{' '}
            : {eurCents(serie.alerte.soldeFinCents)}.
          </div>
        </div>
      )}
      <div className="panel">
        <div className="panel-h">
          <h2>Projection de trésorerie</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="g-legende" role="group" aria-label="Scénario">
              {SCENARIOS.map(([k, l, c]) => (
                <button
                  key={k}
                  className={scenario === k ? 'on' : ''}
                  onClick={() => setScenario(k)}
                >
                  <i style={{ background: c }} />
                  {l}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Horizon">
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  className={params.horizon === h ? 'on' : ''}
                  onClick={() => onParams({ ...params, horizon: h })}
                >
                  {h} m
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Période">
              {(['mois', 'semaine'] as const).map((g) => (
                <button
                  key={g}
                  className={params.granularite === g ? 'on' : ''}
                  onClick={() => onParams({ ...params, granularite: g })}
                >
                  {g === 'mois' ? 'Mois' : 'Semaine'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="panel-b">
          {!projection ? (
            <p className="muted" style={{ margin: 0 }}>
              Chargement…
            </p>
          ) : (
            <>
              <svg
                viewBox={`0 0 ${L} ${H}`}
                className="g-svg"
                role="img"
                aria-label="Projection de trésorerie par scénario"
              >
                <line x1={marge.g} x2={L - marge.d} y1={y(0)} y2={y(0)} stroke="var(--line)" />
                {projection.seuil.cents != null && !sansSolde && (
                  <g>
                    <line
                      x1={marge.g}
                      x2={L - marge.d}
                      y1={y(projection.seuil.cents)}
                      y2={y(projection.seuil.cents)}
                      stroke="var(--red)"
                      strokeDasharray="5 4"
                    />
                    <text x={L - marge.d} y={y(projection.seuil.cents) - 4} textAnchor="end">
                      Seuil {eurCents(projection.seuil.cents)}
                    </text>
                  </g>
                )}
                {SCENARIOS.map(([k, , c]) => {
                  const s = projection.scenarios.find((z) => z.scenario === k);
                  if (!s) return null;
                  return (
                    <polyline
                      key={k}
                      fill="none"
                      stroke={c}
                      strokeWidth={k === scenario ? 3 : 1.5}
                      opacity={k === scenario ? 1 : 0.55}
                      points={s.periodes.map((p, i) => `${x(i)},${y(valeur(p))}`).join(' ')}
                    />
                  );
                })}
                {serie?.periodes.map((p, i) => (
                  <g key={p.debut}>
                    <rect
                      x={x(i) - L / Math.max(n, 1) / 2}
                      y={0}
                      width={L / Math.max(n, 1)}
                      height={H}
                      fill={choisie === i ? 'rgba(12,55,107,.08)' : 'transparent'}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setChoisie(i)}
                    >
                      <title>
                        {libellePeriode(p, params.granularite)} : {eurCents(valeur(p))}
                      </title>
                    </rect>
                    {(n <= 13 || i % Math.ceil(n / 12) === 0) && (
                      <text x={x(i)} y={H - 6} textAnchor="middle">
                        {params.granularite === 'mois'
                          ? libelleMois(p.debut.slice(0, 7)).slice(0, 4)
                          : jourCourt(p.debut)}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
              <div className="g-note">
                <div>
                  {sansSolde
                    ? 'Variation cumulée depuis aujourd’hui (le solde d’ouverture n’est pas renseigné). '
                    : 'Solde de fin de période. '}
                  Cliquez une période pour voir ses mouvements. Les encaissements en HT ou à date
                  supposée sont marqués « estimé ».
                </div>
              </div>
              <div className="g-seuil">
                <label>
                  Simuler un retard de paiement des clients (jours) :{' '}
                  <input
                    className="input num"
                    style={{ width: 80 }}
                    inputMode="numeric"
                    aria-label="Retard de paiement simulé en jours"
                    value={retard}
                    onChange={(e) => setRetard(e.target.value)}
                    onBlur={() => {
                      const v = Math.min(365, Math.max(0, Math.round(Number(retard) || 0)));
                      setRetard(v ? String(v) : '');
                      if (v !== params.retard) onParams({ ...params, retard: v });
                    }}
                  />
                </label>
                <span className="small muted">
                  Simulation locale : aucune facture n’est modifiée.
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {periodeChoisie && (
        <div className="panel" style={{ marginTop: 18 }}>
          <div className="panel-h">
            <h2>{libellePeriode(periodeChoisie, params.granularite)}</h2>
            <span className="small muted">
              Entrées {eurCents(periodeChoisie.entreesCents)} · sorties{' '}
              {eurCents(periodeChoisie.sortiesCents)}
            </span>
          </div>
          {periodeChoisie.mouvements.length ? (
            <table className="tbl">
              <tbody>
                {periodeChoisie.mouvements.map((m) => (
                  <tr key={`${m.ref}-${m.sens}-${m.date}`}>
                    <td className="num">{jourCourt(m.date)}</td>
                    <td className="g-lib">
                      <b>{m.libelle}</b>
                      <small>
                        {m.nature === 'depense' ? 'Dépense TTC' : 'Recette'}
                        {m.note ? ` · ${m.note}` : ''}
                      </small>
                    </td>
                    <td>{m.estime && <span className="badge amber">Estimé</span>}</td>
                    <td className="r num">
                      <b>
                        {m.sens === 'entree' ? '+' : '−'}
                        {eurCents(m.montantCents)}
                      </b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="panel-b">
              <p className="muted" style={{ margin: 0 }}>
                Aucun mouvement sur cette période.
              </p>
            </div>
          )}
        </div>
      )}

      <ReglagesTresorerie
        slug={slug}
        projection={projection}
        ouvert={reglage}
        onToggle={() => setReglage(!reglage)}
        onSaved={() => {
          setReglage(false);
          onReglagesSaved();
        }}
      />
    </>
  );
}

function ReglagesTresorerie({
  slug,
  projection,
  ouvert,
  onToggle,
  onSaved,
}: {
  slug: string;
  projection: ProjectionTresorerie | null;
  ouvert: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const r = projection?.reglages;
  const cents = (c: number | null | undefined) =>
    c == null ? '' : String(c / 100).replace('.', ',');
  const [solde, setSolde] = useState(cents(r?.soldeCents));
  const [date, setDate] = useState(r?.soldeDate ?? '');
  const [source, setSource] = useState(r?.soldeSource ?? '');
  const [mode, setMode] = useState<ReglagesGestion['seuilMode']>(r?.seuilMode ?? 'aucun');
  const [seuil, setSeuil] = useState(cents(r?.seuilCents));
  const [delai, setDelai] = useState(
    r?.delaiPaiementJours == null ? '' : String(r.delaiPaiementJours),
  );
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!r) return;
    setSolde(cents(r.soldeCents));
    setDate(r.soldeDate ?? '');
    setSource(r.soldeSource ?? '');
    setMode(r.seuilMode);
    setSeuil(cents(r.seuilCents));
    setDelai(r.delaiPaiementJours == null ? '' : String(r.delaiPaiementJours));
  }, [r]);

  const enregistrer = async () => {
    const soldeC = solde.trim()
      ? Math.round(Number(solde.replace(/\s/g, '').replace(',', '.')) * 100)
      : null;
    if (soldeC != null && !Number.isFinite(soldeC))
      return setErreur('Le solde doit être un montant.');
    const seuilC = mode === 'montant' ? versCents(seuil) : null;
    if (mode === 'montant' && seuilC == null) return setErreur('Indiquez le montant du seuil.');
    const delaiN = delai.trim() ? Number(delai) : null;
    if (delaiN != null && (!Number.isInteger(delaiN) || delaiN < 0 || delaiN > 365))
      return setErreur('Le délai est un nombre de jours entre 0 et 365.');
    try {
      await saveReglagesGestion(slug, {
        soldeCents: soldeC,
        soldeDate: soldeC == null ? null : date || null,
        soldeSource: soldeC == null ? null : source.trim() || null,
        seuilMode: mode,
        seuilCents: seuilC,
        delaiPaiementJours: delaiN,
      });
      setErreur(null);
      onSaved();
    } catch (e) {
      setErreur(message(e));
    }
  };

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div className="panel-h">
        <h2>Réglages de trésorerie</h2>
        <button className="btn sm" onClick={onToggle}>
          {ouvert ? 'Fermer' : 'Modifier'}
        </button>
      </div>
      <div className="panel-b">
        {!ouvert ? (
          <div className="g-ligne" style={{ flexDirection: 'column', gap: 4 }}>
            <span>
              Solde d’ouverture :{' '}
              {r?.soldeCents == null ? (
                <b>non renseigné</b>
              ) : (
                <b>
                  {eurCents(r.soldeCents)} au {r.soldeDate} ({r.soldeSource})
                </b>
              )}
            </span>
            <span>
              Seuil d’alerte :{' '}
              <b>
                {r?.seuilMode === 'aucun' || !r
                  ? 'aucun'
                  : r.seuilMode === 'bfr'
                    ? `BFR calculé${projection?.seuil.cents != null ? ` (${eurCents(projection.seuil.cents)})` : ''}`
                    : `montant fixé : ${eurCents(r.seuilCents ?? 0)}`}
              </b>
            </span>
            <span>
              Délai de paiement des clients :{' '}
              <b>
                {r?.delaiPaiementJours == null ? 'non défini' : `${r.delaiPaiementJours} jours`}
              </b>
            </span>
            {projection?.seuil.bfr && (
              <span className="small muted">
                BFR = créances facturées non encaissées (
                {eurCents(projection.seuil.bfr.creancesCents)}) − dettes échues non payées (
                {eurCents(projection.seuil.bfr.dettesCents)}) ={' '}
                {eurCents(projection.seuil.bfr.bfrCents)}. {projection.seuil.bfr.limites.join(' ')}
              </span>
            )}
          </div>
        ) : (
          <form
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              void enregistrer();
            }}
          >
            <div className="g-champs2">
              <label className="field">
                <span>Solde bancaire (€)</span>
                <input
                  className="input num"
                  inputMode="decimal"
                  value={solde}
                  onChange={(e) => setSolde(e.target.value)}
                  placeholder="Non renseigné"
                />
              </label>
              <label className="field">
                <span>Au (date du solde)</span>
                <input
                  className="input"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>Source du solde</span>
              <input
                className="input"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Ex. relevé bancaire du mois"
              />
            </label>
            <div className="field">
              <span>Seuil d’alerte</span>
              <div className="seg adaptable" role="group" aria-label="Seuil d'alerte">
                {(
                  [
                    ['aucun', 'Aucun'],
                    ['bfr', 'BFR calculé'],
                    ['montant', 'Montant que je fixe'],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    className={mode === k ? 'on' : ''}
                    onClick={() => setMode(k)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="small muted">
                {mode === 'bfr'
                  ? 'Créances facturées non encaissées moins dettes échues non payées, sans marge. Stocks et TVA ne sont pas comptés.'
                  : mode === 'montant'
                    ? 'Aucune valeur par défaut : vous fixez le montant.'
                    : 'Aucune alerte ne sera calculée.'}
              </div>
            </div>
            {mode === 'montant' && (
              <label className="field">
                <span>Seuil (€)</span>
                <input
                  className="input num"
                  inputMode="decimal"
                  value={seuil}
                  onChange={(e) => setSeuil(e.target.value)}
                />
              </label>
            )}
            <label className="field">
              <span>Délai de paiement habituel des clients (jours)</span>
              <input
                className="input num"
                inputMode="numeric"
                value={delai}
                onChange={(e) => setDelai(e.target.value)}
                placeholder="Non défini : encaissement à la date de facture"
              />
            </label>
            {erreur && (
              <div className="alert red" role="alert">
                {erreur}
              </div>
            )}
            <button className="btn primary" type="submit">
              Enregistrer
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
