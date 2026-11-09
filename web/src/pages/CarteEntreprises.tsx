import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  calculerTourneeBase,
  fetchCarteEntreprises,
  type PointCarteWeb,
  type TourneeWeb,
} from '../api.js';

const CarteLeaflet = lazy(() => import('./CarteLeaflet.js'));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const km = (m: number) => `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
const duree = (s: number) => {
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};
// Google Maps takes the stops as coordinates in the address, no key needed. It stops following
// the route after about ten stops, so only the first ones are sent.
const MAX_GOOGLE = 10;
export const lienItineraire = (t: TourneeWeb): string =>
  `https://www.google.com/maps/dir/${t.etapes
    .slice(0, MAX_GOOGLE)
    .map((e) => `${e.latitude},${e.longitude}`)
    .join('/')}`;

// The companies of the base on a map. Click to choose the ones to visit, then ask for the best
// order: the first one chosen (or the starting address) is where the day begins.
export function CarteEntreprises({
  slug,
  filtres,
  initiales = [],
}: {
  slug: string;
  filtres: { q?: string; liste?: string };
  initiales?: string[];
}) {
  const [points, setPoints] = useState<PointCarteWeb[]>([]);
  const [sansCoordonnees, setSansCoordonnees] = useState(0);
  const [choisies, setChoisies] = useState<string[]>(initiales);
  const [depart, setDepart] = useState('');
  const [tournee, setTournee] = useState<TourneeWeb | null>(null);
  const [charge, setCharge] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const { q, liste } = filtres;

  useEffect(() => {
    let actif = true;
    fetchCarteEntreprises(slug, { q, liste }).then(
      (r) => {
        if (!actif) return;
        setPoints(r.points);
        setSansCoordonnees(r.sansCoordonnees);
        setCharge(true);
      },
      (e: unknown) => actif && setErreur(message(e)),
    );
    return () => {
      actif = false;
    };
  }, [slug, q, liste]);

  const basculer = useCallback((id: string) => {
    setTournee(null);
    setChoisies((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }, []);

  const nom = (id: string) => points.find((p) => p.id === id)?.nom ?? '';
  const calculer = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      const t = await calculerTourneeBase(slug, choisies, depart.trim());
      setTournee(t);
      setChoisies(t.etapes.flatMap((e) => (e.id ? [e.id] : [])));
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="bv-carte-page">
      {erreur && (
        <p className="error" role="alert">
          {erreur}
        </p>
      )}
      <p className="small muted">
        {charge
          ? `${points.length} entreprise${points.length > 1 ? 's' : ''} sur la carte${
              sansCoordonnees > 0 ? `, ${sansCoordonnees} sans adresse localisable` : ''
            }. Cliquez sur des entreprises pour les choisir.`
          : 'Chargement de la carte…'}
      </p>
      <Suspense fallback={<p className="muted">Chargement de la carte…</p>}>
        <CarteLeaflet
          points={points}
          ordre={choisies}
          trace={tournee?.trace ?? null}
          onBasculer={basculer}
        />
      </Suspense>
      <div className="bv-tournee">
        <h3 className="bv-sous-titre">Tournée</h3>
        {choisies.length === 0 ? (
          <p className="muted">Aucune entreprise choisie.</p>
        ) : (
          <ol>
            {choisies.map((id) => (
              <li key={id}>
                {nom(id)}{' '}
                <button
                  className="bv-fermer"
                  aria-label={`Retirer ${nom(id)} de la tournée`}
                  onClick={() => basculer(id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
        <label className="small">
          Adresse de départ (facultatif)
          <input
            className="input"
            value={depart}
            placeholder="Si vide, la première entreprise est le départ"
            onChange={(e) => {
              setDepart(e.target.value);
              setTournee(null);
            }}
          />
        </label>{' '}
        <button
          className="btn primary"
          disabled={occupe || choisies.length + (depart.trim() ? 1 : 0) < 2}
          onClick={() => void calculer()}
        >
          Calculer la tournée
        </button>
        {tournee && (
          <div className="bv-tournee-resultat" aria-label="Résultat de la tournée">
            <p>
              <strong>
                {km(tournee.distanceM)} · {duree(tournee.dureeS)}
              </strong>{' '}
              <span className="small muted">
                {tournee.source === 'routes'
                  ? 'itinéraire routier (OpenStreetMap)'
                  : 'estimation à vol d’oiseau : le service d’itinéraires ne répond pas'}
              </span>
            </p>
            {tournee.ignorees.length > 0 && (
              <p className="small muted">
                Sans adresse localisable, non visitées : {tournee.ignorees.join(', ')}.
              </p>
            )}
            <ol>
              {tournee.etapes.map((e, i) => (
                <li key={`${e.id ?? 'depart'}-${i}`}>
                  {e.nom}
                  {e.ville ? ` · ${e.ville}` : ''}
                  {i > 0 && (
                    <span className="small muted">
                      {' '}
                      — {km(e.distanceM)}, {duree(e.dureeS)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <p>
              <a className="btn" href={lienItineraire(tournee)} target="_blank" rel="noreferrer">
                Ouvrir l’itinéraire dans Google Maps
              </a>
              {tournee.etapes.length > MAX_GOOGLE && (
                <span className="small muted"> (les {MAX_GOOGLE} premières étapes)</span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
