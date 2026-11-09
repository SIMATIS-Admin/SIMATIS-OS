import { useEffect, useState } from 'react';
import {
  actualiserSignauxEntreprise,
  fetchSignauxEntreprise,
  type GraviteSignal,
  type SignauxWeb,
} from '../api.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const LIBELLE_GRAVITE: Record<GraviteSignal, string> = {
  alerte: 'À éviter ou à vérifier',
  attention: 'À surveiller',
  info: 'Information',
};
export const COULEUR_GRAVITE: Record<GraviteSignal, string> = {
  alerte: 'red',
  attention: 'amber',
  info: '',
};
const date = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR');
const SEPT_JOURS = 7 * 864e5;

// What the BODACC says about a company. Read once when the sheet opens, and refreshed on its own
// the first time and then once a week: the pilot never has to remember to ask.
export function SignauxEntreprise({ slug, entrepriseId }: { slug: string; entrepriseId: string }) {
  const [etat, setEtat] = useState<SignauxWeb | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const actualiser = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      setEtat(await actualiserSignauxEntreprise(slug, entrepriseId));
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };

  useEffect(() => {
    let actif = true;
    fetchSignauxEntreprise(slug, entrepriseId).then(
      (r) => {
        if (!actif) return;
        setEtat(r);
        if (!r.verifieLe || Date.now() - new Date(r.verifieLe).getTime() > SEPT_JOURS)
          void actualiser();
      },
      (e: unknown) => actif && setErreur(message(e)),
    );
    return () => {
      actif = false;
    };
  }, [slug, entrepriseId]);

  const signaux = etat?.signaux ?? [];
  return (
    <section className="bv-signaux" aria-label="Signaux du BODACC">
      <h4 className="bv-sous-titre">Signaux du BODACC</h4>
      {signaux.some((s) => s.gravite === 'alerte') && (
        <p>
          <span className="badge red">
            Procédure ou radiation récente : vérifiez avant de contacter.
          </span>
        </p>
      )}
      {erreur && <p className="small muted">{erreur}</p>}
      {etat && signaux.length === 0 && (
        <p className="muted">
          {etat.verifieLe ? 'Aucune annonce notable depuis 2 ans.' : 'Pas encore vérifié.'}
        </p>
      )}
      <ul className="bv-signaux-liste">
        {signaux.map((s) => (
          <li key={s.id}>
            <span className={`badge ${COULEUR_GRAVITE[s.gravite]}`}>{s.famille}</span> {s.nature}{' '}
            <span className="small muted">
              — {date(s.date)}
              {s.url && (
                <>
                  {' · '}
                  <a href={s.url} target="_blank" rel="noreferrer">
                    annonce
                  </a>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="small muted">
        {etat?.verifieLe ? `Vérifié le ${date(etat.verifieLe.slice(0, 10))}. ` : ''}
        <button className="btn sm ghost" disabled={occupe} onClick={() => void actualiser()}>
          {occupe ? 'Vérification…' : 'Actualiser'}
        </button>
      </p>
    </section>
  );
}
