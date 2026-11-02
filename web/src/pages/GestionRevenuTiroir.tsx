import { useState } from 'react';
import {
  creerRevenuGestion,
  modifierRevenuGestion,
  type NouveauRevenu,
  type RevenuGestion,
} from '../api.js';
import { aujourdhui, versCents } from '../gestion.js';
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

// Saisie d'une recette unique : libellé, montant HT, date et mandat suffisent.
export function GestionRevenuTiroir({
  slug,
  mandats,
  revenu,
  onClose,
  onSaved,
}: {
  slug: string;
  mandats: { slug: string; nom: string }[];
  revenu?: RevenuGestion;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [libelle, setLibelle] = useState(revenu?.libelle ?? '');
  const [montant, setMontant] = useState(
    revenu ? String(revenu.montantHtCents / 100).replace('.', ',') : '',
  );
  const [date, setDate] = useState(revenu?.date ?? aujourdhui());
  const [mandat, setMandat] = useState(revenu?.mandat ?? '');
  const [type, setType] = useState<RevenuGestion['type']>(revenu?.type ?? 'commission');
  const [etat, setEtat] = useState<RevenuGestion['etat']>(revenu?.etat ?? 'prevue');
  const [encaisse, setEncaisse] = useState(revenu?.dateEncaissement ?? aujourdhui());
  const [facture, setFacture] = useState(revenu?.referenceFacture ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const enregistrer = async () => {
    const cents = versCents(montant);
    if (!libelle.trim() || !cents) return setErreur('Libellé et montant HT sont obligatoires.');
    const donnees: NouveauRevenu = {
      libelle: libelle.trim(),
      type,
      mandat: mandat || null,
      montantHtCents: cents,
      etat,
      date,
      dateEncaissement: etat === 'encaissee' ? encaisse : null,
      referenceFacture: facture.trim() || null,
    };
    setOccupe(true);
    setErreur(null);
    try {
      if (revenu) await modifierRevenuGestion(slug, revenu.id, donnees);
      else await creerRevenuGestion(slug, donnees);
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
          <div className="small muted">Une recette unique, par exemple une commission.</div>
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
            <span>{etat === 'prevue' ? 'Date prévue' : 'Date de facture'}</span>
            <input
              className="input"
              type="date"
              value={date}
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
        <div className="field">
          <span>État</span>
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
        {etat === 'encaissee' && (
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
        <label className="field">
          <span>Référence de facture (facultatif)</span>
          <input
            className="input"
            value={facture}
            onChange={(e) => setFacture(e.target.value)}
            placeholder="Numéro de la facture émise"
          />
        </label>
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
