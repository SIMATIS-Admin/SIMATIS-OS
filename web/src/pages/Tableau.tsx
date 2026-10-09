import { useEffect, useRef, useState } from 'react';
import { fetchTableau, saveFunnel, type Funnel, type TableauReponse } from '../api.js';
import { eur } from '../crm.js';

type Cle = keyof Funnel;
const CURSEURS: { cle: Cle; libelle: string; min: number; max: number; step: number }[] = [
  { cle: 'leads', libelle: 'Leads par mois', min: 5, max: 200, step: 5 },
  { cle: 'l2p', libelle: 'Prospects rencontrés', min: 5, max: 80, step: 1 },
  { cle: 'p2d', libelle: 'Devis envoyés', min: 5, max: 100, step: 1 },
  { cle: 'd2c', libelle: 'Commandes', min: 5, max: 90, step: 1 },
  { cle: 'panier', libelle: 'Panier moyen', min: 2000, max: 60000, step: 500 },
];

// Same formulas as the server (pilotage/funnel.ts), for an instant redraw while sliding.
function simuler(f: Funnel) {
  const prospects = (f.leads * f.l2p) / 100;
  const devis = (prospects * f.p2d) / 100;
  const commandes = (devis * f.d2c) / 100;
  const caAnnuel = commandes * f.panier * 12;
  const parLead = (f.l2p / 100) * (f.p2d / 100) * (f.d2c / 100) * f.panier;
  return {
    prospects,
    devis,
    commandes,
    caAnnuel,
    leadsNecessaires: Math.ceil(f.objectif / 12 / parLead),
  };
}

export function Tableau({ slug }: { slug: string }) {
  const [data, setData] = useState<TableauReponse | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetchTableau(slug).then(
      (d) => {
        setData(d);
        setFunnel(d.funnel);
      },
      (e: unknown) => setError(String(e)),
    );
    return () => clearTimeout(timer.current);
  }, [slug]);

  if (error) return <div className="empty">{error}</div>;
  if (!data || !funnel) return null;

  const change = (cle: Cle, valeur: number) => {
    setFunnel({ ...funnel, [cle]: valeur });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveFunnel(slug, { [cle]: valeur }).catch((e: unknown) => setError(String(e)));
    }, 400);
  };
  const s = simuler(funnel);
  const valeurs: Record<Cle, number> = {
    leads: funnel.leads,
    l2p: s.prospects,
    p2d: s.devis,
    d2c: s.commandes,
    panier: funnel.panier,
    objectif: funnel.objectif,
  };
  const camp = data.derniereCampagne;

  return (
    <>
      <div className="grid g3">
        <div className="panel kpi">
          <span className="l">Pipeline ouvert</span>
          <span className="v">{eur(data.pipeline.montant)}</span>
          <span className="small muted">{data.pipeline.nombre} opportunités</span>
        </div>
        <div className="panel kpi">
          <span className="l">Opportunités chaudes (12 et plus)</span>
          <span className="v">{data.chaudes.nombre}</span>
          <span className="small muted">{eur(data.chaudes.montant)}</span>
        </div>
        <div className="panel kpi">
          <span className="l">Taux de réponse, dernière campagne</span>
          <span className="v">
            {camp ? `${Math.round((camp.reponses / camp.brouillons) * 100)} %` : 'Pas encore'}
          </span>
          <span className="small muted">
            {camp ? `${camp.rdv} rendez-vous obtenus` : 'Aucune campagne lancée'}
          </span>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-h">
          <div>
            <h2>Du lead à la commande</h2>
            <div className="small muted">
              Chiffre d'affaires = leads × taux lead → prospect × taux prospect → devis × taux devis
              → commande × panier moyen. Déplacez les curseurs pour simuler.
            </div>
          </div>
          <span className="badge amber">Modèle à valider</span>
        </div>
        <div className="panel-b">
          {CURSEURS.map((c) => {
            const pourcent = c.cle !== 'leads' && c.cle !== 'panier';
            return (
              <div key={c.cle} className="funnel-row">
                <div className="lbl">
                  {c.libelle}
                  {pourcent && <span className="muted small"> ({funnel[c.cle]} %)</span>}
                  <input
                    type="range"
                    aria-label={c.libelle}
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={funnel[c.cle]}
                    onChange={(e) => change(c.cle, Number(e.target.value))}
                  />
                </div>
                <div
                  className="funnel-bar"
                  style={{
                    width: `${c.cle === 'panier' ? 0 : Math.max(1, (valeurs[c.cle] / funnel.leads) * 100)}%`,
                  }}
                />
                <div className="v num">
                  {c.cle === 'panier'
                    ? eur(funnel.panier)
                    : c.cle === 'leads'
                      ? funnel.leads
                      : valeurs[c.cle].toFixed(1)}
                </div>
              </div>
            );
          })}
          <div className="verdict" style={{ marginTop: 18 }}>
            <div className="big">
              {eur(s.caAnnuel)}
              <small> / an</small>
            </div>
            <div>
              Objectif annuel <b className="num">{eur(funnel.objectif)}</b>.{' '}
              {s.caAnnuel >= funnel.objectif ? (
                'La trajectoire est tenue.'
              ) : (
                <>
                  Il faudrait <b className="num">{s.leadsNecessaires}</b> leads par mois à taux
                  constants, ou améliorer un taux de conversion.
                </>
              )}
            </div>
          </div>
          <p className="small muted">
            Suivez ces taux dès le début, même sans référence : ils deviennent fiables après
            quelques mois, selon la durée moyenne du cycle de vente.
          </p>
        </div>
      </div>
    </>
  );
}
