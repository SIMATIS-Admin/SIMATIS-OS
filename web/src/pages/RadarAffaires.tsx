import { useEffect, useState } from 'react';
import { fetchPipeline, type PipelineOpp } from '../api.js';
import { libelleLecture, useLectureEchanges } from './radar/useLectureEchanges.js';
import './radar/affaires.css';
import { PassageQualification } from './radar/PassageQualification.js';

const canaux = ['Téléphone', 'LinkedIn', 'E-mail', 'Autre canal'];
const etapes = ['À contacter', 'Contactées', 'À relancer', 'Échange obtenu'];
const tentatives = (o: PipelineOpp) => o.tentatives ?? 0;
const compte = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const etape = (o: PipelineOpp) =>
  o.radar === 'repondu' ? 3 : tentatives(o) >= 3 ? 2 : tentatives(o) > 0 ? 1 : 0;

export function RadarAffaires({ slug }: { slug: string }) {
  const [affaires, setAffaires] = useState<PipelineOpp[] | null>(null);
  const [erreur, setErreur] = useState('');
  const [pipe, setPipe] = useState(false);
  const [revision, actualiser] = useState(0);
  const { lecture, relire } = useLectureEchanges(slug, () => actualiser((n) => n + 1));
  useEffect(() => {
    let actif = true;
    fetchPipeline(slug).then(
      (p) => {
        if (actif) {
          setAffaires(p.opportunites.filter((o) => !o.clos && o.radar));
          setErreur('');
        }
      },
      (e: Error) => {
        if (actif) setErreur(e.message);
      },
    );
    return () => {
      actif = false;
    };
  }, [slug, revision]);
  if (erreur)
    return (
      <p role="alert">
        {erreur}{' '}
        <button className="btn" onClick={() => actualiser((n) => n + 1)}>
          Réessayer
        </button>
      </p>
    );
  if (!affaires) return <p role="status">Chargement du Radar…</p>;
  const lien = (o: PipelineOpp) => `#/${slug}/fiche/affaire/${o.id}`;
  const carte = (o: PipelineOpp) => (
    <div className="radar-carte" key={o.id}>
      <a className="radar-carte-lien" href={lien(o)}>
        <b>{o.titre}</b>
        <span>{[o.entreprise, o.contact].filter(Boolean).join(' · ')}</span>
        <small>
          {o.canalRadar ?? 'Autre canal'} · {compte(tentatives(o), 'tentative')}
        </small>
      </a>
      <PassageQualification slug={slug} affaireId={o.id} apres={() => actualiser((n) => n + 1)} />
    </div>
  );
  return (
    <section className="radar-affaires">
      <div className="radar-actions">
        <div className="seg">
          {['Vue radar', 'Vue pipe'].map((v, i) => (
            <button
              key={v}
              aria-pressed={pipe === Boolean(i)}
              className={pipe === Boolean(i) ? 'on' : ''}
              onClick={() => setPipe(Boolean(i))}
            >
              {v}
            </button>
          ))}
        </div>
        <a className="link" href={`#/${slug}/pipeline`}>
          Pipeline de vente
        </a>
        <a className="link" href={`#/${slug}/prospection/ouvrir/suivi`}>
          Suivi de prospection
        </a>
      </div>
      <p>
        {compte(affaires.length, 'affaire')} avant rendez-vous. Un RDV accepté fait passer l’affaire
        en Qualification.
      </p>
      {pipe ? (
        <div className="radar-colonnes">
          {etapes.map((e, i) => {
            const liste = affaires.filter((o) => etape(o) === i);
            return (
              <section className="radar-colonne" key={e}>
                <header>
                  <h2>{e}</h2>
                  <b>{liste.length}</b>
                </header>
                {liste.map(carte)}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="radar-affaires-grille">
          <div className="panel">
            <svg
              viewBox="-240 -224 480 448"
              aria-label="Affaires par canal et nombre de tentatives"
            >
              {[50, 95, 140, 180].map((r) => (
                <circle key={r} r={r} className="anneau" />
              ))}
              <path d="M-180 0H180 M0 -180V180" className="anneau" />
              <g className="balayage" aria-hidden="true">
                <path d="M0 0 L-76 -163 A180 180 0 0 1 0 -180Z" fill="var(--teal)" opacity=".16" />
                <path d="M0 0V-180" stroke="var(--teal)" />
              </g>
              {canaux.map((c, i) => (
                <text
                  key={c}
                  x={[130, 130, -130, -130][i]}
                  y={[-148, 155, 155, -148][i]}
                  textAnchor="middle"
                >
                  {c}
                </text>
              ))}
              <text textAnchor="middle" y="4">
                RDV
              </text>
              {affaires.map((o) => {
                const secteur = canaux.indexOf(o.canalRadar ?? 'Autre canal');
                const hash = Array.from(o.id).reduce(
                  (h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0,
                  0,
                );
                const angle = (((Math.max(0, secteur) - 1) * 90 + 8 + (hash % 74)) * Math.PI) / 180;
                const r = 26 + 150 / (1 + tentatives(o) * 0.46);
                return (
                  <a key={o.id} href={lien(o)} aria-label={o.titre}>
                    <title>
                      {o.titre} · {compte(tentatives(o), 'tentative')}
                    </title>
                    <circle
                      cx={Math.cos(angle) * r}
                      cy={Math.sin(angle) * r}
                      r="6"
                      className="point"
                    />
                  </a>
                );
              })}
            </svg>
            <p className="small">Du bord vers le centre, le nombre de tentatives augmente.</p>
          </div>
          <section className="radar-colonne">
            <h2>Affaires au radar</h2>
            {affaires.length ? affaires.map(carte) : <p>Aucune affaire au Radar.</p>}
          </section>
        </div>
      )}
      <p className="small">
        {libelleLecture(lecture)}{' '}
        {lecture && lecture.etat !== 'en_cours' && (
          <button className="lien" onClick={() => void relire()}>
            Relire la messagerie
          </button>
        )}
      </p>
    </section>
  );
}
