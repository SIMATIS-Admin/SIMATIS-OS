import { useEffect, useState } from 'react';
import { fetchPipeline, type Pipeline } from '../api.js';
import { Icon } from '../icons.js';
import { etapeRadar } from '../radar.js';

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
  const etatRadar = radar.length === 0 ? 'Vide' : aRelancer > 0 ? 'À relancer' : 'À développer';
  const etatPipeline =
    pipeline.length === 0
      ? 'Vide'
      : inactives > 0 || actionsEnRetard > 0
        ? 'À surveiller'
        : 'Sous contrôle';

  return (
    <div className="cockpit-commercial-surface">
      <a className="cockpit-commercial-indicateur radar" href={`#/${slug}/radar`}>
        <span className="cockpit-commercial-identite">
          <span className="cockpit-commercial-icone">
            <Icon name="radar" />
          </span>
          <span>
            <strong>Radar</strong>
            <small className={aRelancer > 0 ? 'attention' : ''}>{etatRadar}</small>
          </span>
        </span>
        <span className="cockpit-commercial-volume">
          <b className="num">{radar.length}</b>
          <small>{radar.length > 1 ? 'affaires actives' : 'affaire active'}</small>
        </span>
        <span className="cockpit-commercial-details">
          <span>
            <b className="num">{aRelancer}</b> à relancer
          </span>
          <span>
            <b className="num">{reponses}</b> {reponses > 1 ? 'ont répondu' : 'a répondu'}
          </span>
        </span>
        <Icon name="down" />
      </a>
      <a className="cockpit-commercial-indicateur pipeline" href={`#/${slug}/pipeline`}>
        <span className="cockpit-commercial-identite">
          <span className="cockpit-commercial-icone">
            <Icon name="kanban" />
          </span>
          <span>
            <strong>Pipeline</strong>
            <small className={inactives > 0 || actionsEnRetard > 0 ? 'attention' : ''}>
              {etatPipeline}
            </small>
          </span>
        </span>
        <span className="cockpit-commercial-volume">
          <b className="num">{pipeline.length}</b>
          <small>{pipeline.length > 1 ? 'affaires ouvertes' : 'affaire ouverte'}</small>
        </span>
        <span className="cockpit-commercial-details">
          <span>
            <b className="num">{inactives}</b> {inactives > 1 ? 'inactives' : 'inactive'}
          </span>
          <span>
            <b className="num">{actionsEnRetard}</b>{' '}
            {actionsEnRetard > 1 ? 'actions en retard' : 'action en retard'}
          </span>
        </span>
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
        <Etat slug={slug} data={data} />
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
