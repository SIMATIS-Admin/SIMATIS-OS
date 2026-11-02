import { useMemo, useState } from 'react';
import {
  creerDepenseGestion,
  modifierDepenseGestion,
  occurrenceDepenseGestion,
  type AffectationGestion,
  type DepenseGestion,
  type NouvelleDepense,
} from '../api.js';
import { aujourdhui, effet12, eurCents, versCents, type Cadence } from '../gestion.js';
import { Drawer } from './Overlay.js';

const CADENCES: [Cadence, string][] = [
  ['aucune', 'Ponctuelle'],
  ['mensuelle', 'Mensuelle'],
  ['trimestrielle', 'Trimestrielle'],
  ['annuelle', 'Annuelle'],
];
export const CATEGORIES = [
  'Outils et abonnements',
  'Télécom',
  'Locaux',
  'Assurances',
  'Déplacements',
  'Honoraires',
  'Marketing',
  'Autres',
];

type Mandat = { slug: string; nom: string };
export type CibleTiroir = {
  // Série à modifier (absente : création). `occurrence` : date d'origine de l'échéance ouverte.
  depense?: DepenseGestion;
  occurrence?: string;
};

const cleAff = (a: AffectationGestion) => (a.cible === 'mandat' ? `mandat:${a.mandat}` : a.cible);

// Saisie rapide : trois champs suffisent (libellé, montant, date) ; le reste est dans « Plus d'options ».
export function GestionTiroir({
  slug,
  mandats,
  cible,
  duplique,
  onClose,
  onSaved,
}: {
  slug: string;
  mandats: Mandat[];
  cible: CibleTiroir;
  duplique?: boolean;
  onClose: () => void;
  onSaved: (encore: boolean) => void;
}) {
  const source = cible.depense;
  const edition = !!source && !duplique;
  const [libelle, setLibelle] = useState(source?.libelle ?? '');
  const [montant, setMontant] = useState(
    source ? String(source.montantTtcCents / 100).replace('.', ',') : '',
  );
  const [date, setDate] = useState(
    duplique ? aujourdhui() : (cible.occurrence ?? source?.dateDebut ?? aujourdhui()),
  );
  const [cadence, setCadence] = useState<Cadence>(source?.recurrence ?? 'aucune');
  const [statut, setStatut] = useState<'reelle' | 'prevue'>(source?.statut ?? 'reelle');
  const [affectations, setAffectations] = useState<AffectationGestion[]>(
    source?.affectations.length ? source.affectations : [{ cible: 'simatis' }],
  );
  const [payeur, setPayeur] = useState<'societe' | 'associe'>(source?.payeur ?? 'societe');
  const [refacturable, setRefacturable] = useState(source?.refacturable ?? false);
  const [categorie, setCategorie] = useState(source?.categorie ?? 'Autres');
  const [tva, setTva] = useState(
    source?.tvaCents ? String(source.tvaCents / 100).replace('.', ',') : '',
  );
  const [justificatif, setJustificatif] = useState(source?.justificatif ?? '');
  const [fin, setFin] = useState(source?.dateFin ?? '');
  const [portee, setPortee] = useState<'cette' | 'suivantes'>('cette');
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const cents = versCents(montant);
  const serie = cadence !== 'aucune';
  const effet = useMemo(() => (cents ? effet12(cents, cadence) : null), [cents, cadence]);
  const choix: { cle: string; libelle: string; aff: AffectationGestion }[] = [
    { cle: 'simatis', libelle: 'SIMATIS', aff: { cible: 'simatis' } },
    { cle: 'kairos', libelle: 'KAIROS', aff: { cible: 'kairos' } },
    ...mandats.map((m) => ({
      cle: `mandat:${m.slug}`,
      libelle: m.nom,
      aff: { cible: 'mandat' as const, mandat: m.slug },
    })),
  ];
  const bascule = (aff: AffectationGestion) =>
    setAffectations((l) =>
      l.some((x) => cleAff(x) === cleAff(aff))
        ? l.filter((x) => cleAff(x) !== cleAff(aff))
        : [...l, aff],
    );

  const enregistrer = async (encore: boolean) => {
    const tvaCents = tva.trim() ? versCents(tva) : null;
    if (!libelle.trim() || !cents) return setErreur('Libellé et montant TTC sont obligatoires.');
    if (tva.trim() && !tvaCents) return setErreur('La TVA doit être un montant en euros.');
    const donnees: NouvelleDepense = {
      libelle: libelle.trim(),
      categorie,
      montantTtcCents: cents,
      tvaCents,
      statut,
      recurrence: cadence,
      dateDebut: date,
      dateFin: serie && fin ? fin : null,
      payeur,
      affectations: affectations.length ? affectations : [{ cible: 'simatis' }],
      refacturable,
      justificatif: justificatif.trim() || null,
    };
    setOccupe(true);
    setErreur(null);
    try {
      if (edition && source) {
        if (source.recurrence !== 'aucune' && cible.occurrence && portee === 'suivantes') {
          await occurrenceDepenseGestion(slug, source.id, cible.occurrence, {
            portee,
            serie: { ...donnees, dateDebut: undefined },
          });
        } else if (source.recurrence !== 'aucune' && cible.occurrence) {
          // Cette échéance seule : seul son montant réel s'écarte de la série.
          await occurrenceDepenseGestion(slug, source.id, cible.occurrence, {
            portee: 'cette',
            etat: 'payee',
            datePaiement: date,
            montantTtcCents: cents,
          });
        } else await modifierDepenseGestion(slug, source.id, donnees);
      } else await creerDepenseGestion(slug, donnees);
      onSaved(encore);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Drawer
      label="Saisie d'une dépense"
      onClose={onClose}
      head={
        <>
          <h2>
            {edition
              ? 'Modifier la dépense'
              : duplique
                ? 'Dupliquer la dépense'
                : 'Nouvelle dépense'}
          </h2>
          <div className="small muted">Trois champs suffisent : libellé, montant, date.</div>
        </>
      }
    >
      <form
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void enregistrer(false);
        }}
      >
        <label className="field">
          <span>Libellé</span>
          <input
            className="input"
            autoFocus
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            placeholder="Ex. abonnement, repas client, matériel"
          />
        </label>
        <div className="g-champs2">
          <label className="field">
            <span>Montant TTC (€)</span>
            <input
              className="input num"
              inputMode="decimal"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              placeholder="0,00"
            />
          </label>
          <label className="field">
            <span>{serie ? 'Première échéance' : 'Date'}</span>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <div className="field">
          <span>Fréquence</span>
          <div className="seg adaptable" role="group" aria-label="Fréquence">
            {CADENCES.map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={cadence === k ? 'on' : ''}
                onClick={() => setCadence(k)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>État</span>
          <div className="seg" role="group" aria-label="État">
            {(
              [
                ['reelle', 'Déjà payée'],
                ['prevue', 'Prévisionnelle'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={statut === k ? 'on' : ''}
                onClick={() => setStatut(k)}
              >
                {l}
              </button>
            ))}
          </div>
          {serie && (
            <div className="small muted">
              Pour une série, chaque échéance passée est comptée payée, chaque échéance à venir est
              prévue.
            </div>
          )}
        </div>
        <div className="g-effet" aria-live="polite">
          {effet ? (
            serie ? (
              <>
                <b>{eurCents(effet.parMois)}</b> / mois en moyenne ·{' '}
                <b>{eurCents(effet.total12)}</b> sur 12 mois
              </>
            ) : (
              <>
                <b>{eurCents(effet.total12)}</b> une seule fois, à la date indiquée
              </>
            )
          ) : (
            <span className="muted">
              Saisissez un montant pour voir l’effet sur les 12 prochains mois.
            </span>
          )}
        </div>
        <div className="field">
          <span>Affectée à</span>
          <div className="g-chips-aff" role="group" aria-label="Affectation">
            {choix.map((c) => (
              <button
                key={c.cle}
                type="button"
                className={`chip ${affectations.some((a) => cleAff(a) === c.cle) ? 'on' : ''}`}
                onClick={() => bascule(c.aff)}
              >
                {c.libelle}
              </button>
            ))}
          </div>
          <div className="small muted">Une affectation analytique n’est pas une refacturation.</div>
        </div>
        <div className="field">
          <span>Paiement</span>
          <div className="seg" role="group" aria-label="Paiement">
            {(
              [
                ['societe', 'Par la société'],
                ['associe', 'Avancé par l’associé'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={payeur === k ? 'on' : ''}
                onClick={() => setPayeur(k)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={refacturable}
            onChange={(e) => setRefacturable(e.target.checked)}
          />
          &nbsp;Refacturable à un client
        </label>
        {refacturable && (
          <div className="small muted">
            Indique ce qui pourra être refacturé. La refacturation réelle se suivra dans Revenus et
            facturation ; elle ne réduit jamais la dépense.
          </div>
        )}
        <details className="g-plus">
          <summary>Plus d’options</summary>
          <div className="g-champs2">
            <label className="field">
              <span>Catégorie</span>
              <select
                className="input"
                value={categorie}
                onChange={(e) => setCategorie(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>TVA comprise (€)</span>
              <input
                className="input num"
                inputMode="decimal"
                value={tva}
                onChange={(e) => setTva(e.target.value)}
                placeholder="Non renseignée"
              />
            </label>
          </div>
          <label className="field">
            <span>Justificatif (référence ou lien)</span>
            <input
              className="input"
              value={justificatif}
              onChange={(e) => setJustificatif(e.target.value)}
              placeholder="Numéro de facture ou lien vers la pièce"
            />
          </label>
          {serie && (
            <label className="field">
              <span>Dernière échéance (facultatif)</span>
              <input
                className="input"
                type="date"
                value={fin}
                onChange={(e) => setFin(e.target.value)}
              />
            </label>
          )}
        </details>
        {edition && source?.recurrence !== 'aucune' && cible.occurrence && (
          <div className="field">
            <span>Cette modification s’applique à</span>
            <div className="seg adaptable" role="group" aria-label="Portée">
              {(
                [
                  ['cette', 'Cette occurrence seulement'],
                  ['suivantes', 'Cette occurrence et les suivantes'],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={portee === k ? 'on' : ''}
                  onClick={() => setPortee(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}
        {erreur && (
          <div className="alert red" role="alert">
            {erreur}
          </div>
        )}
        <div className="g-fin">
          <button className="btn primary" type="submit" disabled={occupe}>
            Enregistrer
          </button>
          {!edition && (
            <button
              className="btn"
              type="button"
              disabled={occupe}
              onClick={() => void enregistrer(true)}
            >
              Enregistrer et ajouter une autre
            </button>
          )}
          <button className="btn ghost" type="button" onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </Drawer>
  );
}
