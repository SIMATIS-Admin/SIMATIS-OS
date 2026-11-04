import { useEffect, useState } from 'react';
import { lireRoutineBrouillons, sauverRoutineBrouillons } from '../api.js';

export function RoutineBrouillons({ slug }: { slug: string }) {
  const [r, setR] = useState<Awaited<ReturnType<typeof lireRoutineBrouillons>> | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    lireRoutineBrouillons(slug).then(setR, () =>
      setMessage('Réglages des brouillons indisponibles.'),
    );
  }, [slug]);
  const sauver = async () => {
    if (!r) return;
    setOccupe(true);
    setMessage('');
    try {
      setR(await sauverRoutineBrouillons(slug, r));
      setMessage('Réglages des brouillons enregistrés.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };
  return (
    <section className="bv-enrichir" aria-label="Préparation quotidienne des brouillons">
      <h3>Brouillons VMA quotidiens</h3>
      {r && (
        <>
          <label>
            <input
              type="checkbox"
              checked={r.active}
              onChange={(e) => setR({ ...r, active: e.target.checked })}
            />{' '}
            Préparer les premiers mails VMA pour les contacts éligibles
          </label>
          <label className="bv-champ">
            Heure (Paris)
            <input
              className="input"
              type="time"
              value={r.heure}
              onChange={(e) => setR({ ...r, heure: e.target.value })}
            />
          </label>
          <p>
            Un lien individuel par contact. Rédaction via vos skills, puis relecture dans
            Prospection.
          </p>
          {r.bilan && (
            <p>
              Dernier passage ({r.dernierJour}) · {r.bilan}
            </p>
          )}
          <button className="btn" disabled={occupe || !r.heure} onClick={() => void sauver()}>
            Enregistrer la préparation des brouillons
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
