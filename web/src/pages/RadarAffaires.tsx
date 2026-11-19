import { useEffect, useId, useState, type DragEvent } from 'react';
import {
  fetchPipeline,
  fetchRendezVous,
  patchFiche,
  type RendezVous,
  type Pipeline,
  type PipelineOpp,
} from '../api.js';
import { Icon } from '../icons.js';
import { libelleLecture, useLectureEchanges } from './radar/useLectureEchanges.js';
import { PassageQualification } from './radar/PassageQualification.js';
import './radar/affaires.css';

const canaux = ['Téléphone', 'LinkedIn', 'E-mail', 'À préciser'];
const etapes = ['À contacter', 'Contactées', 'À relancer', 'Ont répondu'];
const RADAR_MIME = 'application/x-simatis-radar-affaire';
const touches = (o: PipelineOpp) => o.tentatives ?? 0;
const compte = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const etape = (o: PipelineOpp) =>
  Number.isInteger(o.radarEtapeManuelle) &&
  o.radarEtapeManuelle !== null &&
  o.radarEtapeManuelle >= 0 &&
  o.radarEtapeManuelle <= 3
    ? o.radarEtapeManuelle
    : o.radar === 'repondu'
      ? 3
      : touches(o) >= 3
        ? 2
        : touches(o) > 0
          ? 1
          : 0;
const canal = (o: PipelineOpp) =>
  canaux.includes(o.canalRadar ?? '') ? o.canalRadar! : 'À préciser';
const normaliser = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
function position(o: PipelineOpp, affaires: PipelineOpp[]) {
  const groupe = affaires
    .filter((a) => canal(a) === canal(o) && touches(a) === touches(o))
    .sort((a, b) => a.id.localeCompare(b.id));
  const rang = groupe.findIndex((a) => a.id === o.id);
  const angle =
    ((canaux.indexOf(canal(o)) * 90 - 90 + 10 + (70 * (rang + 0.5)) / groupe.length) * Math.PI) /
    180;
  const r = 49 + 155 / (1 + touches(o) * 0.46) - (groupe.length > 12 ? (rang % 2) * 12 : 0);
  return { x: 260 + Math.cos(angle) * r, y: 260 + Math.sin(angle) * r };
}

export function RadarAffaires({ slug }: { slug: string }) {
  const [data, setData] = useState<Pipeline | null>(null);
  const [rendezVous, setRendezVous] = useState<RendezVous[]>([]);
  const [erreur, setErreur] = useState('');
  const [pipe, setPipe] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const [survol, setSurvol] = useState<string | null>(null);
  const [surColonne, setSurColonne] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [revision, actualiser] = useState(0);
  const clip = useId().replace(/:/g, '');
  const { lecture, relire } = useLectureEchanges(slug, () => actualiser((n) => n + 1));
  useEffect(() => {
    let actif = true;
    fetchRendezVous(slug).then(
      (r) => {
        if (actif) setRendezVous(r.rdv ?? []);
      },
      () => {
        if (actif) setRendezVous([]);
      },
    );
    fetchPipeline(slug).then(
      (p) => {
        if (actif) {
          setData(p);
          setErreur('');
        }
      },
      (e: unknown) => {
        if (actif) setErreur(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      actif = false;
    };
  }, [slug, revision]);
  if (!data)
    return (
      <div className="empty" role={erreur ? 'alert' : 'status'}>
        {erreur || 'Chargement du Radar…'}
        {erreur && (
          <button className="btn" onClick={() => actualiser((n) => n + 1)}>
            Réessayer
          </button>
        )}
      </div>
    );
  const limiteRadar = Math.min(2, data.etapes.length);
  const etapesRadar = new Set(data.etapes.slice(0, limiteRadar).map((e) => e.id));
  const toutes = data.opportunites.filter((o) => !o.clos && etapesRadar.has(o.etape));
  const correspond = (s: string) => normaliser(s).includes(normaliser(recherche.trim()));
  const affaires = toutes.filter(
    (o) =>
      (!filtre || canal(o) === filtre) &&
      correspond([o.titre, o.entreprise, o.contact, o.origineCommerciale].join(' ')),
  );
  const active = affaires.find((o) => o.id === (survol ?? selection));
  const selectionnee = affaires.find((o) => o.id === selection);
  const lien = (o: PipelineOpp) => `#/${slug}/fiche/affaire/${o.id}?depuis=radar`;
  const base = (data.contactsARattacher ?? []).filter((c) =>
    correspond(c.entreprise + ' ' + c.nom),
  );
  const deplacer = (id: string, destination: number) => {
    const affaire = data.opportunites.find((o) => o.id === id);
    if (!affaire || etape(affaire) === destination) return;
    setMessage('');
    setData((courant) =>
      courant
        ? {
            ...courant,
            opportunites: courant.opportunites.map((o) =>
              o.id === id ? { ...o, radarEtapeManuelle: destination } : o,
            ),
          }
        : courant,
    );
    void patchFiche(slug, 'affaire', id, { radarEtapeManuelle: destination }).then(
      () => actualiser((n) => n + 1),
      (e: unknown) => {
        setMessage(e instanceof Error ? e.message : String(e));
        actualiser((n) => n + 1);
      },
    );
  };
  const deposer = (destination: number) => (e: DragEvent) => {
    e.preventDefault();
    setSurColonne(null);
    const id = e.dataTransfer.getData(RADAR_MIME);
    if (id) deplacer(id, destination);
  };
  const carte = (o: PipelineOpp, deplacable = false) => (
    <button
      type="button"
      key={o.id}
      className={`ra-affaire ${active?.id === o.id ? 'selectionnee' : ''}`}
      draggable={deplacable}
      onDragStart={(e) => e.dataTransfer.setData(RADAR_MIME, o.id)}
      onClick={() => setSelection(o.id)}
      onMouseEnter={() => setSurvol(o.id)}
      onMouseLeave={() => setSurvol(null)}
    >
      <span className={`ra-statut statut-${etape(o)}`} aria-hidden="true" />
      <span className="ra-identite">
        <strong>{o.entreprise || o.titre}</strong>
        <span>{o.entreprise ? o.titre : o.contact}</span>
        <small>{o.contact}</small>
        <small className="ra-origine">Origine · {o.origineCommerciale || 'À renseigner'}</small>
      </span>
      <span className="ra-touches">
        {touches(o)}
        <small>tent.</small>
      </span>
    </button>
  );
  return (
    <section className="radar-affaires">
      <div className="ra-toolbar">
        <div className="seg" aria-label="Vue du Radar">
          {['Vue radar', 'Vue pipe'].map((v, i) => (
            <button
              key={v}
              aria-pressed={pipe === Boolean(i)}
              className={pipe === Boolean(i) ? 'on' : ''}
              onClick={() => setPipe(Boolean(i))}
            >
              <Icon name={i ? 'kanban' : 'radar'} />
              {v}
            </button>
          ))}
        </div>
        <label className="ra-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Rechercher dans le Radar"
            placeholder="Entreprise, affaire, contact…"
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value);
              setSelection(null);
            }}
          />
        </label>
        <a className="btn" href={`#/${slug}/pipeline`}>
          <Icon name="kanban" />
          Pipeline de vente
        </a>
      </div>
      <div className="ra-filtres" aria-label="Filtrer par dernier canal">
        <span>Dernier canal</span>
        {['', ...canaux].map((c) => (
          <button
            key={c}
            aria-pressed={filtre === c}
            onClick={() => {
              setFiltre(c);
              setSelection(null);
            }}
          >
            {c || 'Tous'}
            <span>{c ? toutes.filter((o) => canal(o) === c).length : toutes.length}</span>
          </button>
        ))}
      </div>
      {(erreur || message) && <p role="alert">{erreur || message}</p>}
      <div className={`ra-workspace ${pipe ? 'ra-mode-pipe' : ''}`}>
        <div className="ra-primary">
          {pipe ? (
            <div className="ra-board">
              {etapes.map((e, i) => {
                const liste = affaires.filter((o) => etape(o) === i);
                return (
                  <section
                    className={`ra-colonne ${surColonne === i ? 'depot' : ''}`}
                    key={e}
                    aria-label={e}
                    onDragOver={(event) => {
                      if (!event.dataTransfer.types.includes(RADAR_MIME)) return;
                      event.preventDefault();
                      setSurColonne(i);
                    }}
                    onDragLeave={() => setSurColonne(null)}
                    onDrop={deposer(i)}
                  >
                    <header>
                      <h2>{e}</h2>
                      <span>{liste.length}</span>
                    </header>
                    {liste.map((o) => carte(o, true))}
                    {!liste.length && <div className="ra-vide-colonne">Aucune affaire</div>}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="ra-canvas">
              <header>
                <div>
                  <h2>{compte(affaires.length, 'affaire')} au radar</h2>
                </div>
              </header>
              <div className="ra-plot" onMouseLeave={() => setSurvol(null)}>
                <svg
                  className="ra-geometrie"
                  viewBox="0 0 520 520"
                  role="img"
                  aria-label="Radar par dernier canal et nombre de tentatives"
                >
                  <defs>
                    <clipPath id={clip}>
                      <circle cx="260" cy="260" r="207" />
                    </clipPath>
                    <linearGradient id={clip + '-beam'}>
                      <stop stopColor="var(--teal)" stopOpacity="0" />
                      <stop offset="1" stopColor="var(--teal)" stopOpacity=".23" />
                    </linearGradient>
                  </defs>
                  <circle className="ra-fond" cx="260" cy="260" r="207" />
                  {[72, 115, 158, 207].map((r) => (
                    <circle key={r} cx="260" cy="260" r={r} className="ra-anneau" />
                  ))}
                  <path d="M53 260H467M260 53V467" className="ra-axe" />
                  <g clipPath={`url(#${clip})`}>
                    <g className="ra-balayage">
                      <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from="0 260 260"
                        to="360 260 260"
                        dur="14s"
                        repeatCount="indefinite"
                      />
                      <path
                        d="M260 260L172.5 72.4A207 207 0 0 1 260 53Z"
                        fill={`url(#${clip}-beam)`}
                      />
                      <path d="M260 260V53" stroke="var(--teal)" opacity=".5" />
                    </g>
                  </g>
                  <circle className="ra-centre" cx="260" cy="260" r="35" />
                  <text x="260" y="257" className="ra-centre-texte" textAnchor="middle">
                    RDV
                  </text>
                  <text x="260" y="272" className="ra-centre-detail" textAnchor="middle">
                    accepté
                  </text>
                  {canaux.map((c, i) => (
                    <text
                      key={c}
                      className="ra-canal"
                      x={[376, 376, 144, 144][i]}
                      y={[39, 490, 490, 39][i]}
                      textAnchor="middle"
                    >
                      {c}
                    </text>
                  ))}
                  <text className="ra-repere" x="265" y="64">
                    0
                  </text>
                  <text className="ra-repere" x="265" y="113">
                    1
                  </text>
                  <text className="ra-repere" x="265" y="157">
                    3
                  </text>
                  <text className="ra-repere" x="265" y="200">
                    6+
                  </text>
                </svg>
                {affaires.map((o) => {
                  const p = position(o, affaires);
                  return (
                    <button
                      type="button"
                      key={o.id}
                      aria-label={`Aperçu de ${o.titre}`}
                      aria-describedby={survol === o.id ? clip + '-tooltip' : undefined}
                      aria-pressed={selection === o.id}
                      className={`ra-point statut-${etape(o)} ${active?.id === o.id ? 'selectionnee' : ''}`}
                      style={{ left: `${p.x / 5.2}%`, top: `${p.y / 5.2}%` }}
                      onMouseEnter={() => setSurvol(o.id)}
                      onFocus={() => setSurvol(o.id)}
                      onBlur={() => setSurvol(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setSelection(null);
                          setSurvol(null);
                        }
                      }}
                      onClick={() => {
                        setSelection(o.id);
                        setSurvol(null);
                      }}
                    />
                  );
                })}
                {survol &&
                  active &&
                  (() => {
                    const p = position(active, affaires);
                    return (
                      <div
                        className={`ra-tooltip ${p.y < 200 ? 'ra-tooltip-dessous' : ''}`}
                        role="tooltip"
                        id={clip + '-tooltip'}
                        style={{
                          left: `${Math.max(40, Math.min(60, p.x / 5.2))}%`,
                          top: `${p.y / 5.2}%`,
                        }}
                      >
                        <strong>{active.entreprise || active.titre}</strong>
                        <span>{active.titre}</span>
                        <span>{active.contact || 'Contact à préciser'}</span>
                        <small>
                          {etapes[etape(active)]} · {compte(touches(active), 'tentative')}
                        </small>
                        <small>Origine · {active.origineCommerciale || 'À renseigner'}</small>
                      </div>
                    );
                  })()}
              </div>
              <footer>
                {etapes.map((e, i) => (
                  <span key={e}>
                    <i className={`ra-statut statut-${i}`} />
                    {e}
                  </span>
                ))}
              </footer>
            </div>
          )}
        </div>
        <aside className="ra-aside" aria-label="Résumé et liste des affaires">
          {selectionnee ? (
            <section className="ra-resume" aria-label="Résumé de l’affaire">
              <header>
                <span className="ra-phase">{etapes[etape(selectionnee)]}</span>
                <button
                  className="btn ghost sm"
                  aria-label="Fermer le résumé"
                  onClick={() => {
                    setSelection(null);
                    setSurvol(null);
                  }}
                >
                  <Icon name="x" />
                </button>
              </header>
              <h2>{selectionnee.entreprise || selectionnee.titre}</h2>
              <p>{selectionnee.titre}</p>
              <dl>
                <div>
                  <dt>Contact</dt>
                  <dd>{selectionnee.contact || 'À préciser'}</dd>
                </div>
                <div>
                  <dt>Origine commerciale</dt>
                  <dd>{selectionnee.origineCommerciale || 'À renseigner'}</dd>
                </div>
                <div>
                  <dt>Dernier canal</dt>
                  <dd>{canal(selectionnee)}</dd>
                </div>
                <div>
                  <dt>Tentatives</dt>
                  <dd>{touches(selectionnee)}</dd>
                </div>
                <div>
                  <dt>Prochaine action</dt>
                  <dd>{selectionnee.prochaineEtape || 'À planifier'}</dd>
                </div>
              </dl>
              <label className="ra-deplacer">
                <span>Étape Radar</span>
                <select
                  className="input"
                  aria-label={`Déplacer ${selectionnee.titre}`}
                  value={etape(selectionnee)}
                  onChange={(event) => deplacer(selectionnee.id, Number(event.target.value))}
                >
                  {etapes.map((nom, index) => (
                    <option key={nom} value={index}>
                      {nom}
                    </option>
                  ))}
                </select>
              </label>
              <a className="btn primary" href={lien(selectionnee)}>
                <Icon name="file" />
                Ouvrir la fiche affaire
              </a>
              <PassageQualification
                key={selectionnee.id}
                slug={slug}
                affaireId={selectionnee.id}
                apres={() => {
                  setSelection(null);
                  actualiser((n) => n + 1);
                }}
              />
            </section>
          ) : (
            <div className="ra-aide">
              <Icon name="radar" />
              <h2>Parcourir les affaires</h2>
              <p>
                Survolez un point pour son résumé. Cliquez pour garder l’aperçu et accéder à ses
                actions.
              </p>
            </div>
          )}
          {!pipe && (
            <section className="ra-liste">
              <header>
                <h2>Affaires</h2>
                <span>{affaires.length}</span>
              </header>
              <div>
                {affaires.map((o) => carte(o))}
                {!affaires.length && <p className="ra-empty">Aucune affaire ne correspond.</p>}
              </div>
            </section>
          )}
        </aside>
      </div>
      {base.length > 0 && (
        <details
          className="ra-rattacher"
          data-recherche={Boolean(recherche.trim()) && affaires.length === 0}
          open={Boolean(recherche.trim()) || undefined}
        >
          <summary>
            <Icon name="users" />
            {compte(base.length, 'contact')} ayant répondu à rattacher à une affaire
          </summary>
          <p>
            Ces contacts ont répondu et n’ont pas encore de fiche CRM associée. Vérifiez leur
            rattachement avant le passage en Qualification.
          </p>
          <div>
            {base.map((c) => {
              const rdv = rendezVous.find(
                (r) =>
                  r.statut === 'rdv' &&
                  !r.opportunite &&
                  c.entreprise.trim().length >= 4 &&
                  normaliser(r.titre).includes(normaliser(c.entreprise.trim())),
              );
              return (
                <article className="ra-base-contact" key={c.id}>
                  <a
                    className="ra-base-lien"
                    href={`#/${slug}/bases/ouvrir/rechercher-${encodeURIComponent(c.entreprise)}`}
                  >
                    <strong>{c.entreprise}</strong>
                    <span>{c.nom}</span>
                    <span>Provenance de la fiche · {c.provenance || 'À renseigner'}</span>
                    <small>
                      Ont répondu ·{' '}
                      {c.linkedin ? 'Profil LinkedIn disponible' : 'Origine à renseigner'}
                    </small>
                    <Icon name="file" />
                  </a>
                  {rdv && (
                    <a
                      className="ra-rdv-suggere"
                      href={`#/${slug}/fiche/rdv/${encodeURIComponent(rdv.id)}`}
                    >
                      <Icon name="cal" />
                      RDV à rattacher ·{' '}
                      {new Date(rdv.debut).toLocaleString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Europe/Paris',
                      })}
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        </details>
      )}
      <footer className="ra-footer">
        <span>{libelleLecture(lecture)}</span>
        <div>
          {lecture && lecture.etat !== 'en_cours' && (
            <button className="btn ghost sm" onClick={() => void relire()}>
              <Icon name="refresh" />
              Actualiser
            </button>
          )}
          <a className="btn ghost sm" href={`#/${slug}/prospection/ouvrir/suivi`}>
            Suivi de prospection
            <Icon name="list" />
          </a>
        </div>
      </footer>
    </section>
  );
}
