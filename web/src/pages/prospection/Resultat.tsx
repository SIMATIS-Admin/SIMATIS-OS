import type { ResultatCampagne } from '../../api.js';

export function Resultat({
  resultat,
  mode = 'relance',
  onRetour,
  onRevenir,
}: {
  mode?: 'relance' | 'froid';
  resultat: ResultatCampagne;
  onRetour: () => void;
  onRevenir: () => void;
}) {
  if (resultat.simulation) {
    return (
      <div className="panel">
        <div className="panel-b">
          <div className="alert amber">
            <div>
              <b>Simulation :</b> rien n'a été créé dans votre messagerie ni dans votre CRM, car les
              écritures réelles sont fermées. La campagne reste en relecture : vous pourrez la
              recommencer quand les écritures réelles seront ouvertes.
            </div>
          </div>
          <p>
            <button className="btn primary" onClick={onRevenir}>
              Revenir à la relecture
            </button>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>{resultat.envoye ? 'Mails envoyés' : 'Brouillons créés'}</h2>
      </div>
      <div className="panel-b">
        <table className="tbl small">
          <tbody>
            <tr>
              <td>
                {resultat.envoye
                  ? 'Mails envoyés depuis votre messagerie'
                  : 'Brouillons créés dans votre messagerie'}
              </td>
              <td className="r num">{resultat.brouillons}</td>
            </tr>
            <tr>
              <td>Tâches de suivi créées</td>
              <td className="r num">{resultat.suivisCrees}</td>
            </tr>
            {resultat.suivisNonCrees > 0 && (
              <tr>
                <td>Suivis créés dans l'OS seulement (le CRM ne les a pas acceptés)</td>
                <td className="r num">{resultat.suivisNonCrees}</td>
              </tr>
            )}
            <tr>
              <td>Dossiers clos (sans suivi)</td>
              <td className="r num">{resultat.clos}</td>
            </tr>
            {mode === 'relance' && (
              <tr>
                <td>Tâches de relance marquées faites</td>
                <td className="r num">{resultat.faites}</td>
              </tr>
            )}
            {resultat.echecs > 0 && (
              <tr>
                <td>Brouillons refusés par la messagerie</td>
                <td className="r num">{resultat.echecs}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="small muted">
          {resultat.envoye
            ? 'Le compteur du jour a monté : vos mails sont partis.'
            : 'Ouvrez vos brouillons dans la messagerie, relisez, signez au besoin et envoyez. Le compteur du jour monte quand vos mails sont partis.'}
        </p>
        <button className="btn primary" onClick={onRetour}>
          Retour à la prospection
        </button>
      </div>
    </div>
  );
}
