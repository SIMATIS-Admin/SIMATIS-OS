import { useEffect, useState } from 'react';
import { fetchIndicateursSalesnav, type IndicateursSalesnav } from '../api.js';

const ELEMENTS = [
  { type: 'demande_envoyee', libelle: 'demandes envoyées' },
  { type: 'demande_recue', libelle: 'demandes reçues' },
  { type: 'message_envoye', libelle: 'messages envoyés' },
  { type: 'reponse_recue', libelle: 'réponses reçues' },
] as const;

// La barre de l'état commercial : l'activité du jour sur Sales Navigator. Elle n'apparaît que si les
// chiffres sont disponibles ; un clic ouvre la sous-section SalesNav du Radar.
export function BarreSalesnav({ slug }: { slug: string }) {
  const [indic, setIndic] = useState<IndicateursSalesnav | null>(null);

  useEffect(() => {
    let actif = true;
    fetchIndicateursSalesnav(slug).then(
      (i) => actif && setIndic(i),
      () => actif && setIndic(null),
    );
    return () => {
      actif = false;
    };
  }, [slug]);

  if (!indic) return null;
  return (
    <a
      className="cockpit-salesnav"
      href={`#/${slug}/radar/ouvrir/salesnav`}
      aria-label="Activité SalesNav du jour"
    >
      <strong>SalesNav</strong>
      <dl className="cockpit-salesnav-details">
        {ELEMENTS.map((e) => (
          <div key={e.type}>
            <dt>{e.libelle}</dt>
            <dd className="num">{indic.jour[e.type]}</dd>
            <small>{indic.semaine[e.type]} sur 7 jours</small>
          </div>
        ))}
      </dl>
      <span className="cockpit-salesnav-quota">
        {indic.pause ? 'en pause' : `${indic.jour.demande_envoyee} / ${indic.quotaJour} par jour`}
      </span>
    </a>
  );
}
