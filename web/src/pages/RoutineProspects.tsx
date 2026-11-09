import { RoutineBrouillons } from './RoutineBrouillons.js';
import { useEffect, useState } from 'react';
import { lireRoutineProspects, sauverRoutineProspects, type RoutineProspectsVue } from '../api.js';
import { Fenetre } from './Fenetre.js';

export function RoutineProspects({ slug, fermer }: { slug: string; fermer: () => void }) {
  const [routine, setRoutine] = useState<RoutineProspectsVue | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    lireRoutineProspects(slug).then(setRoutine, (e: unknown) => setErreur(String(e)));
  }, [slug]);

  const enregistrer = async (reglages: RoutineProspectsVue) => {
    setErreur('');
    setOccupe(true);
    try {
      await sauverRoutineProspects(slug, reglages);
      fermer();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Fenetre
      titre="Recherche quotidienne"
      onFermer={() => {
        if (!occupe) fermer();
      }}
    >
      {routine && (
        <form
          className="bv-enrichir"
          onSubmit={(e) => {
            e.preventDefault();
            void enregistrer(routine);
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={routine.active}
              onChange={(e) => setRoutine({ ...routine, active: e.target.checked })}
            />{' '}
            Activer la recherche quotidienne
          </label>
          <label className="bv-champ">
            Heure de lancement (Paris)
            <input
              className="input"
              type="time"
              required
              value={routine.heure}
              onChange={(e) => setRoutine({ ...routine, heure: e.target.value })}
            />
          </label>
          <label className="bv-champ">
            Nombre de contacts visé
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              required
              value={routine.nombre}
              onChange={(e) => setRoutine({ ...routine, nombre: e.target.valueAsNumber || 0 })}
            />
          </label>
          <label className="bv-champ">
            Consignes de recherche
            <textarea
              className="input"
              rows={8}
              required
              maxLength={5000}
              value={routine.consignes}
              onChange={(e) => setRoutine({ ...routine, consignes: e.target.value })}
            />
          </label>
          <p>
            Les contacts retenus sont ajoutés à la Base vivante. La recherche utilise Codex sur le
            Mac connecté.
          </p>
          {routine.bilan && (
            <p>
              Dernière exécution ({routine.dernierJour}) · {routine.bilan}
            </p>
          )}
          <button className="btn primary" disabled={occupe}>
            Enregistrer les réglages
          </button>
        </form>
      )}
      <RoutineBrouillons slug={slug} />
      {erreur && <p role="alert">{erreur}</p>}
    </Fenetre>
  );
}
