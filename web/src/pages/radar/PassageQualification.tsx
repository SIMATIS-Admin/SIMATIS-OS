import { useState } from 'react';
import { fetchRendezVous, lierRdv, type RendezVous } from '../../api.js';

export function PassageQualification({
  slug,
  affaireId,
  apres,
}: {
  slug: string;
  affaireId: string;
  apres: () => void;
}) {
  const [choix, setChoix] = useState<RendezVous[] | null>(null);
  const [actif, setActif] = useState(false);
  const [erreur, setErreur] = useState('');
  const [id, setId] = useState('');
  async function agir() {
    setActif(true);
    setErreur('');
    try {
      if (choix === null) {
        const reponse = await fetchRendezVous(slug);
        if (reponse.etat === 'erreur')
          throw new Error(reponse.erreur ?? 'Lecture des rendez-vous impossible');
        setChoix(reponse.rdv.filter((r) => r.statut === 'rdv' && !r.opportunite));
      } else if (id) {
        await lierRdv(slug, id, { kind: 'affaire', id: affaireId });
        apres();
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setActif(false);
    }
  }
  return (
    <div className="passage-qualification">
      {choix &&
        (choix.length ? (
          <label>
            Rendez-vous accepté
            <select className="input" value={id} onChange={(e) => setId(e.target.value)}>
              <option value="">Choisir le rendez-vous</option>
              {choix.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.titre} ·{' '}
                  {new Date(r.debut).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <a href={`#/${slug}/rendez-vous`}>Enregistrer le rendez-vous</a>
        ))}
      {(choix === null || choix.length > 0) && (
        <button
          className="lien"
          disabled={actif || (choix !== null && !id)}
          onClick={() => void agir()}
        >
          {choix === null ? 'RDV accepté…' : 'Passer en Qualification'}
        </button>
      )}
      {choix && (
        <button
          className="lien"
          disabled={actif}
          onClick={() => {
            setChoix(null);
            setId('');
            setErreur('');
          }}
        >
          Annuler
        </button>
      )}
      {erreur && <span role="alert">{erreur}</span>}
    </div>
  );
}
