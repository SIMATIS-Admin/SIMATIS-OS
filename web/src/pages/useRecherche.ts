import { useEffect, useState } from 'react';
import { lireRechercheProspects, type RechercheEnCours } from '../api.js';

export const signalRecherche = () => window.dispatchEvent(new Event('recherche-prospects'));

export function useRecherche(slug: string) {
  const [tache, setTache] = useState<RechercheEnCours | null>(null);
  const [charge, setCharge] = useState(false);
  const [erreurSuivi, setErreurSuivi] = useState('');
  useEffect(() => {
    let actif = true;
    let occupe = false;
    setTache(null);
    setCharge(false);
    const charger = async () => {
      if (occupe) return;
      occupe = true;
      try {
        const resultat = await lireRechercheProspects(slug);
        if (actif) {
          setTache(resultat);
          setErreurSuivi('');
          setCharge(true);
        }
      } catch {
        if (actif)
          setErreurSuivi(
            'Le suivi de la recherche est indisponible. Nouvelle tentative automatique…',
          );
      } finally {
        occupe = false;
      }
    };
    const actualiser = () => {
      void charger();
    };
    actualiser();
    const timer = setInterval(actualiser, 3000);
    window.addEventListener('recherche-prospects', actualiser);
    return () => {
      actif = false;
      clearInterval(timer);
      window.removeEventListener('recherche-prospects', actualiser);
    };
  }, [slug]);
  return { tache, setTache, charge, erreurSuivi };
}
