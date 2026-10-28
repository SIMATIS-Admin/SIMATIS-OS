import { entonnoir } from './calcul.js';
import type { EtatAtelier, Objectifs as ObjectifsEtat } from './etat.js';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const eur = (n: number) => `${fmt(n)} €`;

const CHAMPS: { cle: keyof ObjectifsEtat; libelle: string }[] = [
  { cle: 'part', libelle: 'Part en abonnement (%)' },
  { cle: 'panier', libelle: 'Panier moyen ponctuel (€)' },
  { cle: 'abo', libelle: 'Abonnement mensuel (€)' },
  { cle: 'mois', libelle: 'Mois facturés par abonné' },
  { cle: 'tx1', libelle: 'Rendez-vous → vente (%)' },
  { cle: 'tx2', libelle: 'Contact → rendez-vous (%)' },
];

// Étape « Objectifs » : du chiffre d'affaires visé au nombre de contacts à toucher. La carte
// « Pour Marc » (commission) n'existe pas à l'écran quand l'écran est partagé.
export function Objectifs({
  etat,
  onChange,
  partage,
}: {
  etat: EtatAtelier;
  onChange: (obj: Partial<ObjectifsEtat>) => void;
  partage: boolean;
}) {
  const f = entonnoir(etat.obj);
  // Toute saisie rend les valeurs au statut de saisie réelle : elles ne sont plus « d'exemple ».
  const saisie = (cle: keyof ObjectifsEtat, valeur: string) =>
    onChange({ [cle]: valeur, exemple: false });
  return (
    <div className="at-grille">
      <div className="at-carte">
        <h3>Objectif de l’année</h3>
        <p className="muted small">Combien de chiffre d’affaires, et quelle part en abonnement ?</p>
        <label className="at-champ">
          Chiffre d’affaires visé (€)
          <input type="number" value={etat.obj.ca} onChange={(e) => saisie('ca', e.target.value)} />
        </label>
        <div className="at-champs-2">
          {CHAMPS.map((c) => (
            <label key={c.cle} className="at-champ">
              {c.libelle}
              <input
                type="number"
                value={etat.obj[c.cle] as number | string}
                onChange={(e) => saisie(c.cle, e.target.value)}
              />
            </label>
          ))}
        </div>
        {etat.obj.exemple && (
          <p className="small muted">Valeurs d’exemple : à remplacer par celles de l’entreprise.</p>
        )}
      </div>
      <div className="at-carte">
        <h3>Ce que ça demande</h3>
        <p className="muted small">Calculé à partir des champs de gauche.</p>
        <div className="at-kpis">
          <div className="at-kpi">
            <b data-testid="k-ventes">{fmt(f.ventes)}</b>
            <span>ventes ponctuelles</span>
          </div>
          <div className="at-kpi">
            <b data-testid="k-abonnes">{fmt(f.abonnes)}</b>
            <span>nouveaux abonnés</span>
          </div>
          <div className="at-kpi">
            <b data-testid="k-mrr">{eur(f.mrr)}</b>
            <span>récurrent mensuel en fin d’année</span>
          </div>
          <div className="at-kpi">
            <b data-testid="k-rdv">{fmt(f.rdv)}</b>
            <span>rendez-vous</span>
          </div>
          <div className="at-kpi">
            <b data-testid="k-contacts">{fmt(f.contacts)}</b>
            <span>contacts à toucher</span>
          </div>
        </div>
      </div>
      {!partage && (
        <div className="at-carte at-prive">
          <h3>Pour Marc</h3>
          <p className="muted small">
            Réservé : même taux sur le récurrent, tant que l’affaire court.
          </p>
          <label className="at-champ">
            Taux de commission (%)
            <input
              type="number"
              value={etat.obj.taux}
              onChange={(e) => saisie('taux', e.target.value)}
            />
          </label>
          <div className="at-kpis">
            <div className="at-kpi">
              <b data-testid="k-commission">{eur(f.commission)}</b>
              <span>commission sur 12 mois</span>
            </div>
            <div className="at-kpi">
              <b data-testid="k-commission-rec">{eur(f.commissionRecurrente)}</b>
              <span>commission annuelle sur les abonnements en cours</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
