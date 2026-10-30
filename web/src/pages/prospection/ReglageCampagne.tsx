import { useState } from 'react';
import type { OffreCampagne, ReglageCampagne as Reglage, SignatureProspection } from '../../api.js';

const OFFRES: [OffreCampagne, string][] = [
  ['vma', 'Test de VMA, 10 minutes'],
  ['diagnostic', "Diagnostic d'endurance"],
  ['les-deux', 'Les deux'],
  ['kairos', 'Kairos'],
];

export function ReglageCampagne({
  nbTaches,
  signatures,
  enCours,
  erreur,
  onLancer,
}: {
  nbTaches: number;
  signatures: SignatureProspection[];
  enCours: boolean;
  erreur: string | null;
  onLancer: (reglage: Reglage) => void;
}) {
  const [offre, setOffre] = useState<OffreCampagne>('vma');
  const [creneaux, setCreneaux] = useState(true);
  const [signatureId, setSignatureId] = useState<string>(
    signatures.find((s) => s.defaut)?.id ?? 'aucune',
  );
  const [suivi, setSuivi] = useState<'courte' | 'longue' | 'date'>('courte');
  const [date, setDate] = useState('');

  const lancer = () =>
    onLancer({
      offre,
      creneaux,
      signatureId: signatureId === 'aucune' ? null : signatureId,
      suivi: suivi === 'date' ? { type: 'date', date } : { type: suivi },
      touchesMax: 4,
    });

  const radio = <T extends string>(
    nom: string,
    valeur: T,
    courant: T,
    set: (v: T) => void,
    libelle: string,
  ) => (
    <label style={{ marginRight: 14 }}>
      <input type="radio" name={nom} checked={courant === valeur} onChange={() => set(valeur)} />{' '}
      {libelle}
    </label>
  );

  return (
    <div className="panel">
      <div className="panel-h">
        <h2>
          Régler la campagne{' '}
          <span className="badge blue">
            Relance · {nbTaches} {nbTaches > 1 ? 'tâches' : 'tâche'}
          </span>
        </h2>
      </div>
      <div className="panel-b">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '170px 1fr',
            rowGap: 16,
            alignItems: 'center',
          }}
        >
          <b>Offre</b>
          <div>{OFFRES.map(([v, l]) => radio('offre', v, offre, setOffre, l))}</div>
          <b>Style</b>
          <div className="small muted">
            Reprend le ton du premier mail du fil, lu dans votre messagerie.
          </div>
          <b>Créneaux</b>
          <div>
            <label>
              <input
                type="checkbox"
                checked={creneaux}
                onChange={(e) => setCreneaux(e.target.checked)}
              />{' '}
              Proposer 3 créneaux, entre 1 et 2 semaines après l'envoi
            </label>{' '}
            <span className="small muted">vérifiés dans votre agenda</span>
          </div>
          <b>Signature</b>
          <div>
            <select
              className="input"
              aria-label="Signature"
              style={{ width: 'auto' }}
              value={signatureId}
              onChange={(e) => setSignatureId(e.target.value)}
            >
              {signatures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
                </option>
              ))}
              <option value="aucune">Aucune</option>
            </select>
          </div>
          <b>Prochain suivi</b>
          <div>
            {radio('suivi', 'courte', suivi, setSuivi, '2 à 3 semaines')}
            {radio('suivi', 'longue', suivi, setSuivi, '1 à 2 mois')}
            {radio('suivi', 'date', suivi, setSuivi, 'Date précise')}
            {suivi === 'date' && (
              <input
                className="input"
                type="date"
                aria-label="Date du suivi"
                style={{ width: 'auto' }}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
            <div className="small muted">
              Échéances étalées sur les jours ouvrés ; la tâche de suivi garde le canal d'origine.
            </div>
          </div>
        </div>
        {erreur && (
          <p className="small" role="alert" style={{ color: 'var(--red)' }}>
            {erreur}
          </p>
        )}
        <div style={{ marginTop: 18 }}>
          <button className="btn primary" disabled={enCours} onClick={lancer}>
            {nbTaches > 1 ? `Rédiger les ${nbTaches} brouillons` : 'Rédiger le brouillon'}
          </button>
        </div>
      </div>
    </div>
  );
}
