import { useEffect, useState } from 'react';
import { fetchPipeline, type Pipeline } from '../api.js';
import { Icon } from '../icons.js';
import { etapeRadar } from '../radar.js';
import { BarreSalesnav } from './BarreSalesnav.js';

function Etat({ slug, data }: { slug: string; data: Pipeline }) {
  const etapesRadar = new Set(data.etapes.slice(0, 2).map((etape) => etape.id));
  const radar = data.opportunites.filter(
    (affaire) => !affaire.clos && etapesRadar.has(affaire.etape),
  );
  const pipeline = data.opportunites.filter(
    (affaire) => !affaire.clos && !etapesRadar.has(affaire.etape),
  );
  const aRelancer = radar.filter((affaire) => etapeRadar(affaire) === 2).length;
  const reponses = radar.filter((affaire) => etapeRadar(affaire) === 3).length;
  const inactives = pipeline.filter(
    (affaire) => (affaire.joursInactif ?? 0) > data.inactiviteJours,
  ).length;
  const actionsEnRetard = pipeline.filter((affaire) => affaire.prochaine?.enRetard).length;
  return (
    <div className="cockpit-commercial-surface">
      <a className="cockpit-commercial-indicateur radar" href={`#/${slug}/radar`}>
        <strong>Radar</strong>
        <dl className="cockpit-commercial-details">
          <div>
            <dt>{radar.length > 1 ? 'affaires actives' : 'affaire active'}</dt>
            <dd className="num">{radar.length}</dd>
          </div>
          <div>
            <dt>à relancer</dt>
            <dd className={`num ${aRelancer > 0 ? 'attention' : ''}`}>{aRelancer}</dd>
          </div>
          <div>
            <dt>{reponses > 1 ? 'ont répondu' : 'a répondu'}</dt>
            <dd className="num">{reponses}</dd>
          </div>
        </dl>
        <Icon name="down" />
      </a>
      <a className="cockpit-commercial-indicateur pipeline" href={`#/${slug}/pipeline`}>
        <strong>Pipeline</strong>
        <dl className="cockpit-commercial-details">
          <div>
            <dt>{pipeline.length > 1 ? 'affaires ouvertes' : 'affaire ouverte'}</dt>
            <dd className="num">{pipeline.length}</dd>
          </div>
          <div>
            <dt>{inactives > 1 ? 'inactives' : 'inactive'}</dt>
            <dd className={`num ${inactives > 0 ? 'attention' : ''}`}>{inactives}</dd>
          </div>
          <div>
            <dt>{actionsEnRetard > 1 ? 'actions en retard' : 'action en retard'}</dt>
            <dd className={`num ${actionsEnRetard > 0 ? 'attention' : ''}`}>{actionsEnRetard}</dd>
          </div>
        </dl>
        <Icon name="down" />
      </a>
    </div>
  );
}

export function EtatCommercial({ slug }: { slug: string }) {
  const [data, setData] = useState<Pipeline | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let actif = true;
    fetchPipeline(slug).then(
      (pipeline) => {
        if (actif) {
          setData(pipeline);
          setErreur(false);
        }
      },
      () => actif && setErreur(true),
    );
    return () => {
      actif = false;
    };
  }, [slug]);

  return (
    <section className="cockpit-commercial" aria-label="État du Radar et du Pipeline">
      <div className="cockpit-commercial-entete">
        <h2>État commercial</h2>
        <span>{erreur ? 'Données momentanément indisponibles' : 'Vue d’ensemble'}</span>
      </div>
      {data ? (
        <>
          <Etat slug={slug} data={data} />
          <BarreSalesnav slug={slug} />
        </>
      ) : (
        <div
          className={`cockpit-commercial-surface attente ${erreur ? 'erreur' : ''}`}
          role="status"
        >
          <span>{erreur ? 'Ouvrez le Radar ou le Pipeline pour réessayer.' : 'Chargement…'}</span>
        </div>
      )}
    </section>
  );
}
