import { Fragment, useEffect, useId, useState, type DragEvent } from 'react';
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
import { AjoutRadar } from './radar/AjoutRadar.js';
import { SalesnavRadar } from './radar/SalesnavRadar.js';
import { PassageQualification } from './radar/PassageQualification.js';
import './radar/affaires.css';

const canaux = ['Téléphone', 'LinkedIn', 'E-mail', 'À préciser', 'SalesNav'] as const;
const etapes = ['À contacter', 'Contactées', 'À relancer', 'Ont répondu'];
type Canal = (typeof canaux)[number];
type VueRadar = 'radar' | 'pipe' | 'liste' | 'salesnav';
const RADAR_MIME = 'application/x-simatis-radar-affaire';
// Chaque canal occupe un quartier du Radar : 5 quartiers de 72 degrés.
const PAS_CANAL = 360 / canaux.length;
const sur = (angle: number, r: number) => ({
  x: 260 + Math.cos((angle * Math.PI) / 180) * r,
  y: 260 + Math.sin((angle * Math.PI) / 180) * r,
});
const axes = canaux
  .map((_, i) => {
    const p = sur(-90 + i * PAS_CANAL, 207);
    return `M260 260L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  })
  .join('');
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
const canal = (o: PipelineOpp): Canal =>
  canaux.includes((o.canalRadar ?? '') as Canal) ? (o.canalRadar as Canal) : 'À préciser';
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
    ((canaux.indexOf(canal(o)) * PAS_CANAL -
      90 +
      10 +
      ((PAS_CANAL - 20) * (rang + 0.5)) / groupe.length) *
      Math.PI) /
    180;
  const r = 49 + 155 / (1 + touches(o) * 0.46) - (groupe.length > 12 ? (rang % 2) * 12 : 0);
  return { x: 260 + Math.cos(angle) * r, y: 260 + Math.sin(angle) * r };
}

type ConversionRadar = {
  total: number;
  converties: number;
  pourcentage: number | null;
  moyenneJours: number | null;
  echantillon: number;
};

function conversionsRadar(affaires: PipelineOpp[]): ConversionRadar[] {
  return etapes.slice(0, -1).map((_nom, index) => {
    const atteinte = (o: PipelineOpp) =>
      Math.max(
        etape(o),
        ...Object.keys(o.radarEtapesDates ?? {})
          .map(Number)
          .filter(Number.isInteger),
      );
    const total = affaires.filter((o) => atteinte(o) >= index).length;
    const converties = affaires.filter((o) => atteinte(o) > index).length;
    const durees = affaires.flatMap((o) => {
      const debut = o.radarEtapesDates?.[String(index)] ?? (index === 0 ? o.creeLe : undefined);
      const fin = o.radarEtapesDates?.[String(index + 1)];
      if (!debut || !fin) return [];
      const jours = (Date.parse(fin) - Date.parse(debut)) / 86_400_000;
      return Number.isFinite(jours) && jours >= 0 ? [jours] : [];
    });
    return {
      total,
      converties,
      pourcentage: total ? Math.round((converties / total) * 100) : null,
      moyenneJours: durees.length ? durees.reduce((s, n) => s + n, 0) / durees.length : null,
      echantillon: durees.length,
    };
  });
}

const jours = (n: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);

export function RadarAffaires({ slug, ouvrir }: { slug: string; ouvrir?: string }) {
  const [data, setData] = useState<Pipeline | null>(null);
  const [rendezVous, setRendezVous] = useState<RendezVous[]>([]);
  const [erreur, setErreur] = useState('');
  const [vue, setVue] = useState<VueRadar>(ouvrir === 'salesnav' ? 'salesnav' : 'radar');
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const [survol, setSurvol] = useState<string | null>(null);
  const [surColonne, setSurColonne] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [ajout, setAjout] = useState(false);
  const [selectionListe, setSelectionListe] = useState<Set<string>>(new Set());
  const [canalMasse, setCanalMasse] = useState<Canal>('LinkedIn');
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
  const idsRadar = new Set(toutes.map((o) => o.id));
  const correspond = (s: string) => normaliser(s).includes(normaliser(recherche.trim()));
  const cohorte = toutes.filter((o) => !filtre || canal(o) === filtre);
  const affaires = cohorte.filter((o) =>
    correspond([o.titre, o.entreprise, o.contact, o.origineCommerciale].join(' ')),
  );
  const historique = data.opportunites.filter(
    (o) =>
      (idsRadar.has(o.id) || Object.keys(o.radarEtapesDates ?? {}).length > 0) &&
      (!filtre || canal(o) === filtre),
  );
  const conversions = conversionsRadar(historique);
  const toutesAfficheesSelectionnees =
    affaires.length > 0 && affaires.every((o) => selectionListe.has(o.id));
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
  const modifierCanal = (id: string, valeur: Canal) => {
    const precedente = data.opportunites.find((o) => o.id === id)?.canalRadar ?? null;
    setMessage('');
    setData((courant) =>
      courant
        ? {
            ...courant,
            opportunites: courant.opportunites.map((o) =>
              o.id === id ? { ...o, canalRadar: valeur } : o,
            ),
          }
        : courant,
    );
    void patchFiche(slug, 'affaire', id, { radarCanalManuel: valeur }).catch((e: unknown) => {
      setData((courant) =>
        courant
          ? {
              ...courant,
              opportunites: courant.opportunites.map((o) =>
                o.id === id ? { ...o, canalRadar: precedente } : o,
              ),
            }
          : courant,
      );
      setMessage(e instanceof Error ? e.message : String(e));
    });
  };
  const modifierOrigine = (id: string, valeur: string) => {
    const origineCommerciale = valeur.trim() || null;
    setData((courant) =>
      courant
        ? {
            ...courant,
            opportunites: courant.opportunites.map((o) =>
              o.id === id ? { ...o, origineCommerciale } : o,
            ),
          }
        : courant,
    );
    void patchFiche(slug, 'affaire', id, { origineCommerciale }).catch((e: unknown) => {
      setMessage(e instanceof Error ? e.message : String(e));
      actualiser((n) => n + 1);
    });
  };
  const appliquerCanalMasse = async () => {
    const ids = [...selectionListe];
    if (!ids.length) return;
    setMessage('');
    setData((courant) =>
      courant
        ? {
            ...courant,
            opportunites: courant.opportunites.map((o) =>
              selectionListe.has(o.id) ? { ...o, canalRadar: canalMasse } : o,
            ),
          }
        : courant,
    );
    const resultats = await Promise.allSettled(
      ids.map((id) => patchFiche(slug, 'affaire', id, { radarCanalManuel: canalMasse })),
    );
    const erreurs = resultats.filter((r) => r.status === 'rejected').length;
    if (erreurs) {
      setMessage(`${erreurs} affaire${erreurs > 1 ? 's n’ont' : ' n’a'} pas été mise à jour.`);
      actualiser((n) => n + 1);
      return;
    }
    setSelectionListe(new Set());
    setMessage(`${ids.length} affaire${ids.length > 1 ? 's mises' : ' mise'} à jour.`);
  };
  const deposer = (destination: number) => (e: DragEvent) => {
    e.preventDefault();
    setSurColonne(null);
    const id = e.dataTransfer.getData(RADAR_MIME);
    if (id) deplacer(id, destination);
  };
  const carte = (
    o: PipelineOpp,
    {
      deplacable = false,
      canalEditable = false,
    }: { deplacable?: boolean; canalEditable?: boolean },
  ) => (
    <article
      key={o.id}
      className={`ra-affaire ${active?.id === o.id ? 'selectionnee' : ''}`}
      draggable={deplacable}
      onDragStart={(e) => e.dataTransfer.setData(RADAR_MIME, o.id)}
      onMouseEnter={() => setSurvol(o.id)}
      onMouseLeave={() => setSurvol(null)}
    >
      <button
        type="button"
        className="ra-affaire-ouvrir"
        aria-label={`Ouvrir ${o.titre}`}
        onClick={() => (canalEditable ? (location.hash = lien(o)) : setSelection(o.id))}
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
      {canalEditable && (
        <label className="ra-canal-carte">
          <span>Canal</span>
          <select
            aria-label={`Canal de ${o.titre}`}
            value={canal(o)}
            onChange={(event) => modifierCanal(o.id, event.target.value as Canal)}
          >
            {canaux.map((nom) => (
              <option key={nom}>{nom}</option>
            ))}
          </select>
        </label>
      )}
    </article>
  );
  // La sous-section SalesNav est une page à part entière : elle remplace la barre et les vues du Radar.
  if (vue === 'salesnav')
    return (
      <section className="radar-affaires">
        <SalesnavRadar slug={slug} onRetour={() => setVue('radar')} />
      </section>
    );
  return (
    <section className="radar-affaires">
      <div className="ra-toolbar">
        <div className="seg" aria-label="Vue du Radar">
          {(
            [
              ['radar', 'radar', 'Vue radar'],
              ['pipe', 'kanban', 'Vue pipe'],
              ['liste', 'list', 'Vue liste'],
            ] as const
          ).map(([cle, icone, label]) => (
            <button
              key={cle}
              aria-pressed={vue === cle}
              className={vue === cle ? 'on' : ''}
              onClick={() => {
                setVue(cle);
                setSelection(null);
              }}
            >
              <Icon name={icone} />
              {label}
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
        <button className="btn" aria-expanded={ajout} onClick={() => setAjout((v) => !v)}>
          <Icon name="edit" />
          Ajouter au Radar
        </button>
        <a className="btn" href={`#/${slug}/pipeline`}>
          <Icon name="kanban" />
          Pipeline de vente
        </a>
      </div>
      {ajout && (
        <AjoutRadar
          slug={slug}
          origines={[
            ...new Set(data.opportunites.map((o) => o.origineCommerciale ?? '').filter(Boolean)),
          ].sort()}
          onFerme={() => setAjout(false)}
          onAjoute={() => actualiser((n) => n + 1)}
        />
      )}
      <div
        className="ra-filtres"

        aria-label="Filtrer par dernier canal"
      >
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
      {vue === 'pipe' && (
        <section className="ra-pipe" aria-label="Pipeline du Radar">
          <div className="ra-pipe-entete">
            <strong>{compte(cohorte.length, 'affaire')}</strong>
            <span>Les indicateurs portent sur le filtre de canal actif.</span>
          </div>
          <div className="ra-board">
            {etapes.map((nom, index) => {
              const liste = affaires.filter((o) => etape(o) === index);
              const conversion = conversions[index];
              const detail = conversion
                ? `${conversion.converties} affaire${conversion.converties > 1 ? 's' : ''} sur ${conversion.total} ont atteint l’étape suivante. ${
                    conversion.moyenneJours === null
                      ? 'Le délai moyen apparaîtra après les premiers déplacements datés.'
                      : `Délai moyen : ${jours(conversion.moyenneJours)} jours, sur ${conversion.echantillon} parcours.`
                  }`
                : '';
              return (
                <Fragment key={nom}>
                  <section
                    className={`ra-colonne ${surColonne === index ? 'depot' : ''}`}
                    aria-label={nom}
                    onDragOver={(event) => {
                      if (!event.dataTransfer.types.includes(RADAR_MIME)) return;
                      event.preventDefault();
                      setSurColonne(index);
                    }}
                    onDragLeave={() => setSurColonne(null)}
                    onDrop={deposer(index)}
                  >
                    <header>
                      <h2>{nom}</h2>
                      <span>{liste.length}</span>
                    </header>
                    {liste.map((o) => carte(o, { deplacable: true, canalEditable: true }))}
                    {!liste.length && <div className="ra-vide-colonne">Aucune affaire</div>}
                  </section>
                  {conversion && (
                    <div
                      className="ra-conversion"
                      tabIndex={0}
                      aria-label={`${nom} vers ${etapes[index + 1]} : ${
                        conversion.pourcentage === null
                          ? 'pas de donnée'
                          : `${conversion.pourcentage} %`
                      }. ${detail}`}
                    >
                      <strong>
                        {conversion.pourcentage === null ? '–' : `${conversion.pourcentage}%`}
                      </strong>
                      <span aria-hidden="true">→</span>
                      <small>
                        {conversion.moyenneJours === null
                          ? 'délai —'
                          : `${jours(conversion.moyenneJours)} j moy.`}
                      </small>
                      <span className="ra-conversion-detail" role="tooltip">
                        {detail}
                      </span>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </section>
      )}
      {vue === 'liste' && (
        <section className="ra-tableau" aria-label="Liste des affaires du Radar">
          <div className="ra-actions-masse">
            <label>
              <input
                type="checkbox"
                aria-label="Sélectionner toutes les affaires affichées"
                checked={toutesAfficheesSelectionnees}
                onChange={(event) =>
                  setSelectionListe((courante) => {
                    const suivante = new Set(courante);
                    for (const affaire of affaires)
                      if (event.target.checked) suivante.add(affaire.id);
                      else suivante.delete(affaire.id);
                    return suivante;
                  })
                }
              />
              {selectionListe.size
                ? `${selectionListe.size} sélectionnée${selectionListe.size > 1 ? 's' : ''}`
                : `${affaires.length} affichée${affaires.length > 1 ? 's' : ''}`}
            </label>
            <span>Définir le canal</span>
            <select
              className="input"
              aria-label="Canal à appliquer aux affaires sélectionnées"
              value={canalMasse}
              onChange={(event) => setCanalMasse(event.target.value as Canal)}
            >
              {canaux.map((nom) => (
                <option key={nom}>{nom}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn primary sm"
              disabled={!selectionListe.size}
              onClick={() => void appliquerCanalMasse()}
            >
              Appliquer
            </button>
          </div>
          <div className="ra-tableau-defilement">
            <table>
              <thead>
                <tr>
                  <th className="ra-col-check">
                    <span className="sr-only">Sélection</span>
                  </th>
                  <th>Affaire</th>
                  <th>Contact</th>
                  <th>Étape Radar</th>
                  <th>Canal</th>
                  <th>Origine commerciale</th>
                  <th>Tentatives</th>
                </tr>
              </thead>
              <tbody>
                {affaires.map((o) => (
                  <tr key={o.id}>
                    <td className="ra-col-check">
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${o.titre}`}
                        checked={selectionListe.has(o.id)}
                        onChange={(event) =>
                          setSelectionListe((courante) => {
                            const suivante = new Set(courante);
                            if (event.target.checked) suivante.add(o.id);
                            else suivante.delete(o.id);
                            return suivante;
                          })
                        }
                      />
                    </td>
                    <td>
                      <a href={lien(o)}>
                        <strong>{o.entreprise || o.titre}</strong>
                        <span>{o.entreprise ? o.titre : 'Entreprise à préciser'}</span>
                      </a>
                    </td>
                    <td>{o.contact || 'À préciser'}</td>
                    <td>
                      <select
                        className="input"
                        aria-label={`Étape Radar de ${o.titre}`}
                        value={etape(o)}
                        onChange={(event) => deplacer(o.id, Number(event.target.value))}
                      >
                        {etapes.map((etapeNom, index) => (
                          <option key={etapeNom} value={index}>
                            {etapeNom}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="input"
                        aria-label={`Canal de ${o.titre}`}
                        value={canal(o)}
                        onChange={(event) => modifierCanal(o.id, event.target.value as Canal)}
                      >
                        {canaux.map((nom) => (
                          <option key={nom}>{nom}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        key={`${o.id}-${o.origineCommerciale ?? ''}`}
                        className="input"
                        aria-label={`Origine commerciale de ${o.titre}`}
                        defaultValue={o.origineCommerciale ?? ''}
                        placeholder="À renseigner"
                        onBlur={(event) => modifierOrigine(o.id, event.target.value)}
                      />
                    </td>
                    <td className="num">{touches(o)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!affaires.length && <p className="ra-empty">Aucune affaire ne correspond.</p>}
          </div>
        </section>
      )}
      {vue === 'radar' && (
        <div className="ra-workspace">
          <div className="ra-primary">
            <div className="ra-canvas">
              <header>
                <div>
                  <h2>{compte(affaires.length, 'affaire')} au radar</h2>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setVue('salesnav');
                    setSelection(null);
                  }}
                >
                  SalesNav · {toutes.filter((o) => canal(o) === 'SalesNav').length}
                </button>
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
                  <path d={axes} className="ra-axe" />
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
                  {canaux.map((c, i) => {
                    const p = sur(-90 + i * PAS_CANAL + PAS_CANAL / 2, 232);
                    const lien = c === 'SalesNav';
                    return (
                      <text
                        key={c}
                        className={lien ? 'ra-canal ra-canal-lien' : 'ra-canal'}
                        x={p.x}
                        y={p.y + 4}
                        textAnchor="middle"
                        onClick={lien ? () => setVue('salesnav') : undefined}
                      >
                        {c}
                      </text>
                    );
                  })}
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
                    <dt>Tentatives</dt>
                    <dd>{touches(selectionnee)}</dd>
                  </div>
                  <div>
                    <dt>Prochaine action</dt>
                    <dd>{selectionnee.prochaineEtape || 'À planifier'}</dd>
                  </div>
                </dl>
                <div className="ra-edition">
                  <label>
                    <span>Canal</span>
                    <select
                      className="input"
                      aria-label={`Canal de ${selectionnee.titre}`}
                      value={canal(selectionnee)}
                      onChange={(event) =>
                        modifierCanal(selectionnee.id, event.target.value as Canal)
                      }
                    >
                      {canaux.map((nom) => (
                        <option key={nom}>{nom}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Origine commerciale</span>
                    <input
                      key={`${selectionnee.id}-${selectionnee.origineCommerciale ?? ''}`}
                      className="input"
                      aria-label={`Origine commerciale de ${selectionnee.titre}`}
                      defaultValue={selectionnee.origineCommerciale ?? ''}
                      placeholder="À renseigner"
                      onBlur={(event) => modifierOrigine(selectionnee.id, event.target.value)}
                    />
                  </label>
                </div>
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
            <section className="ra-liste">
              <header>
                <h2>Affaires</h2>
                <span>{affaires.length}</span>
              </header>
              <div>
                {affaires.map((o) => carte(o, {}))}
                {!affaires.length && <p className="ra-empty">Aucune affaire ne correspond.</p>}
              </div>
            </section>
          </aside>
        </div>
      )}
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
