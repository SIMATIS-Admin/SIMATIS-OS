import { useEffect, useState } from 'react';
import {
  enregistrerAlerteSignaux,
  lancerAlerteSignaux,
  lireAlerteSignaux,
  type AlerteSignauxWeb,
} from '../api.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The daily watch of the BODACC: every morning the OS reads the notices of the companies of the
// base and drops in the Inbox what is worth a call. Off until the pilot turns it on.
export function AlerteSignaux({ slug }: { slug: string }) {
  const [reglage, setReglage] = useState<AlerteSignauxWeb | null>(null);
  const [heure, setHeure] = useState('08:00');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    lireAlerteSignaux(slug).then(
      (r) => {
        if (!actif) return;
        setReglage(r);
        setHeure(r.heure);
      },
      (e: unknown) => actif && setErreur(message(e)),
    );
    return () => {
      actif = false;
    };
  }, [slug]);

  const agir = async (action: () => Promise<void>) => {
    setOccupe(true);
    setErreur(null);
    setInfo(null);
    try {
      await action();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };
  const enregistrer = (active: boolean) =>
    agir(async () => {
      const r = await enregistrerAlerteSignaux(slug, { active, heure });
      setReglage(r);
      setInfo(active ? `Veille activée : chaque jour à partir de ${r.heure}.` : 'Veille éteinte.');
    });
  const verifier = () =>
    agir(async () => {
      const r = await lancerAlerteSignaux(slug);
      setInfo(r.bilan);
    });

  if (!reglage) {
    return erreur ? (
      <p className="error" role="alert">
        {erreur}
      </p>
    ) : (
      <p className="muted">Chargement…</p>
    );
  }
  return (
    <div className="bv-alerte">
      <p className="small muted">
        Chaque jour, l’OS lit le BODACC pour les entreprises de la base (200 au plus par passage,
        les moins récemment vérifiées d’abord) et dépose dans l’Inbox les procédures, radiations et
        cessions de fonds. Une annonce n’est signalée qu’une fois.
      </p>
      {erreur && (
        <p className="error" role="alert">
          {erreur}
        </p>
      )}
      <p>
        <strong>{reglage.active ? 'Veille active' : 'Veille éteinte'}</strong>
      </p>
      <label className="small">
        Heure (heure de Paris)
        <input
          className="input"
          type="time"
          value={heure}
          onChange={(e) => setHeure(e.target.value)}
        />
      </label>{' '}
      {reglage.active ? (
        <>
          <button className="btn" disabled={occupe} onClick={() => void enregistrer(true)}>
            Changer l’heure
          </button>{' '}
          <button className="btn ghost" disabled={occupe} onClick={() => void enregistrer(false)}>
            Éteindre la veille
          </button>
        </>
      ) : (
        <button className="btn primary" disabled={occupe} onClick={() => void enregistrer(true)}>
          Activer la veille quotidienne
        </button>
      )}
      {reglage.bilan && (
        <p className="small muted">
          Dernier passage{reglage.dernierJour ? ` (${reglage.dernierJour})` : ''} : {reglage.bilan}
        </p>
      )}
      <p>
        <button className="btn" disabled={occupe} onClick={() => void verifier()}>
          {occupe ? 'Vérification…' : 'Vérifier maintenant'}
        </button>{' '}
        <span className="small muted">100 entreprises au plus, tout de suite.</span>
      </p>
      {info && (
        <p className="small" role="status">
          {info}
        </p>
      )}
    </div>
  );
}
