import { useEffect, useState } from 'react';
import { fetchReponseCampagne, redigerReponseCampagne, type ReponseCampagne } from '../../api.js';

// Entrée « mail à répondre » qui est la réponse d'un contact à un mail de campagne : Claude prépare
// la réponse d'après ce que dit le contact (intérêt, refus, report…), Marc la relit dans la Prospection
// et la crée en brouillon dans sa messagerie. Rien ne s'affiche pour les autres entrées.
export function ReponseCampagneCarte({ slug, sujetId }: { slug: string; sujetId: string }) {
  const [reponse, setReponse] = useState<ReponseCampagne | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let actif = true;
    fetchReponseCampagne(slug, sujetId).then(
      (r) => actif && setReponse(r?.reponse ?? null),
      () => undefined,
    );
    return () => {
      actif = false;
    };
  }, [slug, sujetId]);

  if (!reponse) return null;
  const rediger = () => {
    setEnCours(true);
    redigerReponseCampagne(slug, sujetId).then(
      (r) => {
        location.hash = `#/${slug}/prospection/ouvrir/${r.campagneId}`;
      },
      (e: unknown) => {
        setErreur(e instanceof Error ? e.message : String(e));
        setEnCours(false);
      },
    );
  };
  return (
    <div className="alert blue" style={{ marginBottom: 12 }}>
      <div>
        <b>Réponse à une campagne</b> : {reponse.contactNom}
        {reponse.societe ? `, ${reponse.societe}` : ''} · {reponse.theme}, touche {reponse.touche}.{' '}
        <button className="btn sm primary" disabled={enCours} onClick={rediger}>
          Rédiger la réponse
        </button>
        {erreur && (
          <div className="small" role="alert" style={{ color: 'var(--red)' }}>
            {erreur}
          </div>
        )}
      </div>
    </div>
  );
}
