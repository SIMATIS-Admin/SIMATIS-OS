import { useState } from 'react';
import {
  creerRevenuGestion,
  modifierRevenuGestion,
  occurrenceRevenuGestion,
  reinitialiserOccurrenceRevenu,
  type RevenuGestion,
} from '../api.js';
import { aujourdhui, eurCents, versCents, type Cadence } from '../gestion.js';
import { Drawer } from './Overlay.js';

export const TYPES_REVENU: [RevenuGestion['type'], string][] = [
  ['commission', 'Commission'],
  ['abonnement', 'Abonnement'],
  ['refacturation', 'Refacturation'],
  ['autre', 'Autre'],
];
export const ETATS_REVENU: [RevenuGestion['etat'], string][] = [
  ['prevue', 'Prévue'],
  ['emise', 'Facturée'],
  ['encaissee', 'Encaissée'],
];
const CERTITUDES: [RevenuGestion['certitude'], string][] = [
  ['certaine', 'Certaine'],
  ['probable', 'Probable'],
  ['hypothese', 'Hypothèse'],
];
const CADENCES: [Cadence, string][] = [
  ['aucune', 'Ponctuelle'],
  ['mensuelle', 'Mensuelle'],
  ['trimestrielle', 'Trimestrielle'],
  ['annuelle', 'Annuelle'],
];

export type CibleRevenu = {
  // Série ou recette à modifier (absente : création). `occurrence` : échéance ouverte d'une série.
  revenu?: RevenuGestion;
  occurrence?: string;
  // Raccourci « Marquer facturée » depuis la liste des factures à émettre.
  etat?: RevenuGestion['etat'];
};

// Saisie d'une recette : libellé, montant HT, date et mandat suffisent ; fréquence et certitude
// (pour une commission) sont à un clic.
export function GestionRevenuTiroir({
  slug,
  mandats,
  cible,
  onClose,
  onSaved,
}: {
  slug: string;
  mandats: { slug: string; nom: string }[];
  cible: CibleRevenu;
  onClose: () => void;
  onSaved: () => void;
}) {
  const revenu = cible.revenu;
  const echeance = cible.occurrence;
  const serie = !!revenu && revenu.recurrence !== 'aucune' && !!echeance;
  const [libelle, setLibelle] = useState(revenu?.libelle ?? '');
  const [montant, setMontant] = useState(
    revenu ? String(revenu.montantHtCents / 100).replace('.', ',') : '',
  );
  const [date, setDate] = useState(echeance ?? revenu?.date ?? aujourdhui());
  const [mandat, setMandat] = useState(revenu?.mandat ?? '');
  const [type, setType] = useState<RevenuGestion['type']>(revenu?.type ?? 'commission');
  const [etat, setEtat] = useState<RevenuGestion['etat']>(cible.etat ?? revenu?.etat ?? 'prevue');
  const [cadence, setCadence] = useState<Cadence>(revenu?.recurrence ?? 'aucune');
  const [certitude, setCertitude] = useState<RevenuGestion['certitude']>(
    revenu?.certitude ?? 'certaine',
  );
  const [fin, setFin] = useState(revenu?.dateFin ?? '');
  const [encaisse, setEncaisse] = useState(revenu?.dateEncaissement ?? aujourdhui());
  const [facture, setFacture] = useState(revenu?.referenceFacture ?? '');
  const [portee, setPortee] = useState<'cette' | 'suivantes'>('cette');
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  // Une série se règle échéance par échéance : l'état ne se choisit pas à la création.
  const creeSerie = !revenu && cadence !== 'aucune';
  const etatVisible = !creeSerie && !(serie && portee === 'suivantes');

  const enregistrer = async () => {
    const cents = versCents(montant);
    if (!libelle.trim() || !cents) return setErreur('Libellé et montant HT sont obligatoires.');
    const commun = {
      libelle: libelle.trim(),
      type,
      mandat: mandat || null,
      montantHtCents: cents,
      certitude,
      referenceFacture: facture.trim() || null,
    };
    setOccupe(true);
    setErreur(null);
    try {
      if (revenu && serie && echeance) {
        if (portee === 'suivantes') {
          await occurrenceRevenuGestion(slug, revenu.id, echeance, {
            portee,
            serie: { ...commun, dateFin: fin || null },
          });
        } else if (etat === 'prevue') {
          await reinitialiserOccurrenceRevenu(slug, revenu.id, echeance);
        } else {
          await occurrenceRevenuGestion(slug, revenu.id, echeance, {
            portee: 'cette',
            etat,
            dateEncaissement: etat === 'encaissee' ? encaisse : null,
            montantHtCents: cents,
            referenceFacture: commun.referenceFacture,
          });
        }
      } else if (revenu) {
        await modifierRevenuGestion(slug, revenu.id, {
          ...commun,
          etat,
          date,
          dateEncaissement: etat === 'encaissee' ? encaisse : null,
          dateFin: cadence === 'aucune' ? null : fin || null,
        });
      } else {
        await creerRevenuGestion(slug, {
          ...commun,
          etat: creeSerie ? 'prevue' : etat,
          date,
          dateEncaissement: !creeSerie && etat === 'encaissee' ? encaisse : null,
          recurrence: cadence,
          dateFin: cadence === 'aucune' ? null : fin || null,
        });
      }
      onSaved();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Drawer
      label="Saisie d'une recette"
      onClose={onClose}
      head={
        <>
          <h2>{revenu ? 'Modifier la recette' : 'Nouvelle recette'}</h2>
          <div className="small muted">
            Commission, abonnement ou refacturation, ponctuelle ou récurrente.
          </div>
        </>
      }
    >
      <form
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void enregistrer();
        }}
      >
        <label className="field">
          <span>Libellé</span>
          <input
            className="input"
            autoFocus
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            placeholder="Ex. commission sur contrat signé"
          />
        </label>
        <div className="g-champs2">
          <label className="field">
            <span>Montant HT (€)</span>
            <input
              className="input num"
              inputMode="decimal"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              placeholder="0,00"
            />
          </label>
          <label className="field">
            <span>
              {cadence !== 'aucune'
                ? 'Première échéance'
                : etat === 'prevue'
                  ? 'Date prévue'
                  : 'Date de facture'}
            </span>
            <input
              className="input"
              type="date"
              value={date}
              disabled={serie}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span>Mandat</span>
          <select className="input" value={mandat} onChange={(e) => setMandat(e.target.value)}>
            <option value="">Aucun mandat</option>
            {mandats.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.nom}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Nature</span>
          <div className="seg adaptable" role="group" aria-label="Nature">
            {TYPES_REVENU.map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={type === k ? 'on' : ''}
                onClick={() => setType(k)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {!revenu && (
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
        )}
        <div className="field">
          <span>Certitude</span>
          <div className="seg" role="group" aria-label="Certitude">
            {CERTITUDES.map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={certitude === k ? 'on' : ''}
                onClick={() => setCertitude(k)}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="small muted">
            Une recette probable ou hypothétique n’est jamais comptée comme certaine.
          </div>
        </div>
        {etatVisible && (
          <div className="field">
            <span>{serie ? 'État de cette échéance' : 'État'}</span>
            <div className="seg" role="group" aria-label="État">
              {ETATS_REVENU.map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={etat === k ? 'on' : ''}
                  onClick={() => setEtat(k)}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="small muted">
              Prévue, facturée et encaissée restent distinctes : seule l’encaissée est de l’argent
              reçu.
            </div>
          </div>
        )}
        {etatVisible && etat === 'encaissee' && (
          <label className="field">
            <span>Date d’encaissement</span>
            <input
              className="input"
              type="date"
              value={encaisse}
              onChange={(e) => setEncaisse(e.target.value)}
            />
          </label>
        )}
        {(cadence !== 'aucune' || serie) && portee === 'suivantes' && (
          <div className="small muted">
            Le montant saisi s’applique à toutes les échéances suivantes.
          </div>
        )}
        {cadence !== 'aucune' && !serie && (
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
        <label className="field">
          <span>Référence de facture (facultatif)</span>
          <input
            className="input"
            value={facture}
            onChange={(e) => setFacture(e.target.value)}
            placeholder="Numéro de la facture émise ailleurs"
          />
        </label>
        {serie && (
          <div className="field">
            <span>Cette modification s’applique à</span>
            <div className="seg adaptable" role="group" aria-label="Portée">
              {(
                [
                  ['cette', 'Cette échéance seulement'],
                  ['suivantes', 'Cette échéance et les suivantes'],
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
        {creeSerie && montant && versCents(montant) ? (
          <div className="g-effet">
            <b>{eurCents(versCents(montant)!)}</b> HT à chaque échéance, facturé échéance par
            échéance.
          </div>
        ) : null}
        {erreur && (
          <div className="alert red" role="alert">
            {erreur}
          </div>
        )}
        <div className="g-fin">
          <button className="btn primary" type="submit" disabled={occupe}>
            Enregistrer
          </button>
          <button className="btn ghost" type="button" onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </Drawer>
  );
}
