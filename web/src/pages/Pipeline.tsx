import { useCallback, useEffect, useState, type DragEvent } from 'react';
import {
  changeOpportunite,
  createOpportunite,
  fetchContacts,
  fetchEntreprises,
  fetchPipeline,
  saveReglagesPipeline,
  syncConnexion,
  type Changement,
  type Pipeline as PipelineData,
  type PipelineOpp,
  type Qualification,
} from '../api.js';
import { eur } from '../crm.js';
import { Icon } from '../icons.js';
import { Modal } from './Overlay.js';
import { Tip } from './widgets.js';

// From the mockup (v-conversion.js MOTIFS, CONV_TIP; core.js cat and MATRICE).
export const MOTIFS = [
  'Budget reporté',
  "Choix d'un concurrent",
  'Projet abandonné',
  'Recrutement en interne',
  'Pas de réponse',
  'Autre',
];
const CONV_TIP =
  "Taux de conversion : part des opportunités arrivées à l'étape de gauche qui ont atteint l'étape de droite. Les affaires ouvertes, gagnées et perdues sont toutes comptées ; une affaire perdue compte jusqu'à l'étape où elle s'est arrêtée.";
const MATRICE = {
  'eleve-forte': { k: 'prio', nom: 'Prioriser', d: 'Temps humain, personnalisation, rendez-vous.' },
  'eleve-faible': {
    k: 'secu',
    nom: 'Sécuriser',
    d: 'Qualification complémentaire, réseau, influence sur les décideurs.',
  },
  'limite-forte': { k: 'expl', nom: 'Exploiter', d: 'Séquence standardisée ou semi-automatisée.' },
  'limite-faible': { k: 'ecart', nom: 'Écarter', d: 'Automatisation minimale ou abandon assumé.' },
} as const;
const OPP_MIME = 'application/x-simatis-opp';

const total = (q: Qualification | null) =>
  q ? q.besoin + q.decideur + q.budget + q.timing + q.engagement : null;
function categorie(t: number) {
  if (t >= 12) return { k: 'chaude', nom: 'Chaude' };
  if (t >= 8) return { k: 'tiede', nom: 'Tiède' };
  if (t >= 4) return { k: 'faible', nom: 'Faible' };
  return { k: 'froid', nom: 'Non prioritaire' };
}
function Score({ q }: { q: Qualification | null }) {
  const t = total(q);
  if (t === null) return null;
  const c = categorie(t);
  return (
    <span className={`score ${c.k}`} title={c.nom}>
      {t}
      <small>/15</small>
    </span>
  );
}

const depuis = (iso: string | null) => {
  if (!iso) return 'jamais synchronisé';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return min < 1 ? "synchronisé à l'instant" : `synchronisé il y a ${min} min`;
};
const enRetard = (o: PipelineOpp) =>
  !o.clos &&
  !!o.echeance &&
  o.echeance < new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

const jourCourt = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

// Pipedrive-like state: next activity planned, overdue, or none at all.
function EtatActivite({ o }: { o: PipelineOpp }) {
  const [classe, texte] = !o.prochaine
    ? ['none', 'Aucune activité prévue']
    : o.prochaine.enRetard
      ? ['late', 'Activité en retard']
      : ['ok', `Prochaine activité le ${jourCourt(o.prochaine.echeance)}`];
  return (
    <span className={`act ${classe}`} aria-label={texte} title={texte}>
      <Icon name={classe === 'none' ? 'info' : 'clock'} />
    </span>
  );
}

function Card({
  o,
  draggable,
  label,
  seuil,
  onOpen,
}: {
  o: PipelineOpp;
  draggable: boolean;
  label: (id: string) => string;
  seuil: number;
  onOpen: () => void;
}) {
  const inactive = !o.clos && (o.joursInactif ?? 0) > seuil;
  return (
    <div
      className={`card ${inactive ? 'inactive' : ''}`}
      draggable={draggable}
      tabIndex={0}
      onClick={onOpen}
      onDragStart={(e) => e.dataTransfer.setData(OPP_MIME, o.id)}
    >
      <div className="soc">
        {o.entreprise ?? '—'}
        {!o.clos && <EtatActivite o={o} />}
      </div>
      <div className="ttl">{o.titre}</div>
      {o.contact && <div className="pers small muted">{o.contact}</div>}
      {o.clos === 'perdu' ? (
        <div className="motif">
          Perdue{label(o.etape) !== o.etape ? ` en ${label(o.etape).toLowerCase()}` : ''}
          {o.motif ? ` : ${o.motif.toLowerCase()}` : ''}
        </div>
      ) : o.clos ? null : (
        o.prochaineEtape && (
          <div className={`next ${enRetard(o) ? 'late' : ''}`}>{o.prochaineEtape}</div>
        )
      )}
      {inactive && <div className="inactif">{o.joursInactif} j sans activité</div>}
      <div className="ft">
        <Score q={o.qualification} />
        <span className="small">
          {o.montant ? eur(o.montant) : <span className="muted">à estimer</span>}
        </span>
      </div>
    </div>
  );
}

export function Cloture({
  o,
  resultat,
  onClose,
  onDone,
}: {
  o: { entreprise: string | null; titre: string };
  resultat: 'gagne' | 'perdu';
  onClose: () => void;
  onDone: (c: Changement) => void;
}) {
  const [motif, setMotif] = useState(MOTIFS[0] ?? 'Autre');
  return (
    <Modal
      title={`Affaire ${resultat === 'gagne' ? 'gagnée' : 'perdue'} : ${o.entreprise ?? o.titre}`}
      onClose={onClose}
    >
      {resultat === 'perdu' && (
        <label className="field">
          <span>Motif</span>
          <select className="input" value={motif} onChange={(e) => setMotif(e.target.value)}>
            {MOTIFS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          className="btn primary"
          onClick={() =>
            onDone(resultat === 'gagne' ? { clos: 'gagne' } : { clos: 'perdu', motif })
          }
        >
          Clôturer
        </button>
        <button className="btn ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Modal>
  );
}

const somme = (os: PipelineOpp[]) => os.reduce((a, o) => a + (o.montant ?? 0), 0);

type SaisieAffaire = {
  titre: string;
  montant: number | null;
  echeance: string | null;
  entrepriseId: string | null;
  contactId: string | null;
};

// Pipedrive « + » of a stage: title, value, close date, organisation and person.
export function NouvelleAffaire({
  slug,
  etape,
  onClose,
  onSave,
}: {
  slug: string;
  etape: string;
  onClose: () => void;
  onSave: (s: SaisieAffaire) => Promise<void>;
}) {
  const [titre, setTitre] = useState('');
  const [montant, setMontant] = useState('');
  const [echeance, setEcheance] = useState('');
  const [org, setOrg] = useState<{ id: string; nom: string } | null>(null);
  const [pers, setPers] = useState<{ id: string; nom: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Nouvelle affaire" onClose={onClose}>
      <p className="small muted">Étape : {etape}</p>
      <label className="field">
        <span>Titre</span>
        <input className="input" value={titre} onChange={(e) => setTitre(e.target.value)} />
      </label>
      <div className="grid g2">
        <label className="field">
          <span>Valeur (€)</span>
          <input
            className="input"
            type="number"
            min={0}
            value={montant}
            onChange={(e) => setMontant(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Date de clôture</span>
          <input
            className="input"
            type="date"
            value={echeance}
            onChange={(e) => setEcheance(e.target.value)}
          />
        </label>
      </div>
      <Recherche slug={slug} kind="entreprise" choix={org} onChoix={setOrg} />
      <Recherche slug={slug} kind="contact" choix={pers} onChoix={setPers} />
      {error && (
        <p className="small" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          className="btn primary"
          disabled={!titre.trim()}
          onClick={() =>
            void onSave({
              titre: titre.trim(),
              montant: montant ? Math.round(Number(montant)) : null,
              echeance: echeance || null,
              entrepriseId: org?.id ?? null,
              contactId: pers?.id ?? null,
            }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
          }
        >
          Créer
        </button>
        <button className="btn ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Modal>
  );
}

function Recherche({
  slug,
  kind,
  choix,
  onChoix,
}: {
  slug: string;
  kind: 'entreprise' | 'contact';
  choix: { id: string; nom: string } | null;
  onChoix: (c: { id: string; nom: string } | null) => void;
}) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ id: string; nom: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const charger = kind === 'contact' ? fetchContacts : fetchEntreprises;
    void charger(slug, q).then(
      (r) => setRes(r.slice(0, 6)),
      () => setRes([]),
    );
  }, [slug, kind, q]);
  const label = kind === 'contact' ? 'Personne' : 'Organisation';
  return (
    <div className="field">
      <span>{label}</span>
      {choix ? (
        <span>
          {choix.nom}{' '}
          <button className="lien" onClick={() => onChoix(null)}>
            changer
          </button>
        </span>
      ) : (
        <>
          <input
            className="input"
            aria-label={label}
            placeholder="Rechercher…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {res.map((r) => (
            <button key={r.id} className="lien fi-resultat" onClick={() => onChoix(r)}>
              {r.nom}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export function Pipeline({ slug }: { slug: string }) {
  const [data, setData] = useState<PipelineData | null>(null);
  const [mode, setMode] = useState<'board' | 'matrice'>('board');
  const [cloture, setCloture] = useState<{ id: string; r: 'gagne' | 'perdu' } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [nouvelle, setNouvelle] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchPipeline(slug).then(setData, (e: unknown) => setMessage(String(e)));
  }, [slug]);
  useEffect(load, [load]);

  if (!data) return message ? <div className="empty">{message}</div> : null;

  const label = (id: string) => data.etapes.find((e) => e.id === id)?.label ?? id;
  const change = (id: string, c: Changement) =>
    changeOpportunite(slug, id, c).then(
      (r) => {
        setMessage(
          r.simulation
            ? 'Simulation : HubSpot n’a pas été modifié (écritures réelles désactivées). La prochaine synchronisation rétablira l’étape de HubSpot.'
            : null,
        );
        load();
      },
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );
  const find = (id: string) => data.opportunites.find((o) => o.id === id);
  const ouvertes = data.opportunites.filter((o) => !o.clos);

  const drop = (cible: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(OPP_MIME);
    const o = find(id);
    if (!o) return;
    // Winning or losing always goes through the closing window, to keep the reason.
    if (cible === 'gagne' || cible === 'perdu') {
      if (o.clos !== cible) setCloture({ id, r: cible });
      return;
    }
    if (o.etape === cible && !o.clos) return;
    void change(id, { etape: cible });
  };
  const col = (
    id: string,
    nom: string,
    os: PipelineOpp[],
    cls = '',
    prob: number | null = null,
  ) => (
    <div
      key={id}
      className={`col ${cls} ${over === id ? 'drop' : ''}`}
      onDragOver={(e) => {
        if (!data.ecrit || !e.dataTransfer.types.includes(OPP_MIME)) return;
        e.preventDefault();
        setOver(id);
      }}
      onDragLeave={() => setOver(null)}
      onDrop={drop(id)}
    >
      <div className="col-h">
        <b>
          {nom} <span className="muted">{os.length}</span>
        </b>
        <span>
          {eur(somme(os))}
          {prob != null && (
            <small className="muted"> · pondéré {eur(Math.round((somme(os) * prob) / 100))}</small>
          )}
        </span>
        {!cls && data.ecrit && (
          <button
            className="btn ghost sm col-plus"
            aria-label={`Ajouter une affaire dans ${nom}`}
            title="Nouvelle affaire"
            onClick={() => setNouvelle(id)}
          >
            +
          </button>
        )}
      </div>
      {os.map((o) => (
        <Card
          key={o.id}
          o={o}
          draggable={data.ecrit}
          label={label}
          seuil={data.inactiviteJours}
          onOpen={() => ouvrir(o.id)}
        />
      ))}
      {os.length === 0 && (
        <div className="small muted" style={{ padding: 8 }}>
          {data.ecrit ? 'Glissez une carte ici' : 'Aucune'}
        </div>
      )}
    </div>
  );
  const noms = [...data.etapes.map((e) => e.label), 'Commande'];
  const arrow = (k: number) => {
    const pct = data.conversions[k] ?? null;
    return (
      <div
        key={`conv-${k}`}
        className="conv"
        aria-label={`${noms[k]} vers ${noms[k + 1]} : ${pct === null ? 'pas de donnée' : `${pct} %`}`}
      >
        <span className={`pct ${pct !== null && pct < 30 ? 'low' : ''}`}>
          {pct === null ? '–' : `${pct}%`}
        </span>
        <span className="arr">→</span>
        {k === 0 && <Tip text={CONV_TIP} />}
      </div>
    );
  };

  const closing = cloture ? find(cloture.id) : undefined;
  // Pipedrive header: total and weighted value of the open deals (stage probability).
  const probas = new Map(data.etapes.map((e) => [e.id, e.probabilite ?? null]));
  const pondere = [...probas.values()].some((p) => p !== null)
    ? Math.round(
        ouvertes.reduce((a, o) => a + ((o.montant ?? 0) * (probas.get(o.etape) ?? 0)) / 100, 0),
      )
    : null;
  // Pipedrive: a card opens the deal page.
  const ouvrir = (id: string) => (location.hash = `#/${slug}/fiche/affaire/${id}`);
  return (
    <>
      <div className="page-actions">
        {data.source === 'hubspot' && (
          <>
            <span className="badge blue">Miroir HubSpot, {depuis(data.derniereSynchro)}</span>
            <Tip
              text={`Ce pipeline est le reflet du pipeline HubSpot de l'instance, qui fait foi. ${data.ecrit ? 'Ce que vous changez ici est écrit dans HubSpot' : "Synchronisation en lecture seule : rien n'est écrit dans HubSpot"} ; ce qui change dans HubSpot remonte ici à chaque synchronisation.`}
            />
            <button
              className="btn"
              onClick={() =>
                void syncConnexion(slug, 'crm').then(load, (e: unknown) =>
                  setMessage(e instanceof Error ? e.message : String(e)),
                )
              }
            >
              Synchroniser
            </button>
          </>
        )}
        <label className="small seuil">
          Inactive après (jours)
          <input
            className="input"
            type="number"
            min={1}
            max={90}
            aria-label="Inactive après (jours)"
            defaultValue={data.inactiviteJours}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (n >= 1 && n <= 90 && n !== data.inactiviteJours)
                void saveReglagesPipeline(slug, n).then(load, (err: unknown) =>
                  setMessage(err instanceof Error ? err.message : String(err)),
                );
            }}
          />
          <Tip text="Une opportunité ouverte sans activité faite depuis ce nombre de jours est bordée de rouge. Icône verte : prochaine activité planifiée ; rouge : activité en retard ; alerte : aucune activité prévue." />
        </label>
        <div className="seg">
          <button className={mode === 'board' ? 'on' : ''} onClick={() => setMode('board')}>
            Étapes
          </button>
          <button className={mode === 'matrice' ? 'on' : ''} onClick={() => setMode('matrice')}>
            Matrice
          </button>
        </div>
      </div>
      {data.source === 'hubspot' && !data.ecrit && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <span>
            Synchronisation HubSpot en lecture seule : les cartes ne se déplacent pas. Passez le
            sens sur « Dans les deux sens » dans <a href={`#/${slug}/parametres`}>Paramètres</a>.
          </span>
        </div>
      )}
      {message && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div>{message}</div>
        </div>
      )}
      {mode === 'board' ? (
        <>
          <div className="pipe-totaux">
            <span>
              Total <b className="num">{eur(somme(ouvertes))}</b>
            </span>
            {pondere !== null && (
              <span>
                Pondéré <b className="num">{eur(pondere)}</b>
              </span>
            )}
            <span className="muted">
              {ouvertes.length} affaire{ouvertes.length > 1 ? 's' : ''} ouverte
              {ouvertes.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="board">
            {data.etapes.flatMap((e, k) => [
              col(
                e.id,
                e.label,
                ouvertes.filter((o) => o.etape === e.id),
                '',
                e.probabilite ?? null,
              ),
              arrow(k),
            ])}
            {col(
              'gagne',
              'Gagnées',
              data.opportunites.filter((o) => o.clos === 'gagne'),
              'won closed',
            )}
            {col(
              'perdu',
              'Perdues',
              data.opportunites.filter((o) => o.clos === 'perdu'),
              'lost closed',
            )}
          </div>
        </>
      ) : (
        <div className="matrix">
          {(['eleve', 'limite'] as const).flatMap((pot) => [
            <div key={`ax-${pot}`} className="ax y">
              Potentiel {pot === 'eleve' ? 'élevé' : 'limité'}
            </div>,
            ...(['forte', 'faible'] as const).map((fai) => {
              const key = `${pot}-${fai}` as const;
              const cell = MATRICE[key];
              const os = ouvertes.filter((o) => `${o.potentiel}-${o.faisabilite}` === key);
              return (
                <div key={key} className={`cell ${cell.k}`}>
                  <h3>
                    {cell.nom}
                    <span className="num small muted">{os.length}</span>
                  </h3>
                  <p>{cell.d}</p>
                  {os.map((o) => (
                    <span key={o.id} className="pill" onClick={() => ouvrir(o.id)}>
                      <Score q={o.qualification} />
                      {o.entreprise ?? o.titre}
                    </span>
                  ))}
                </div>
              );
            }),
          ])}
          <div />
          <div className="ax">Faisabilité forte</div>
          <div className="ax">Faisabilité faible</div>
        </div>
      )}
      {nouvelle && (
        <NouvelleAffaire
          slug={slug}
          etape={data.etapes.find((e) => e.id === nouvelle)?.label ?? nouvelle}
          onClose={() => setNouvelle(null)}
          onSave={async (saisie) => {
            const r = await createOpportunite(slug, { ...saisie, etape: nouvelle });
            setNouvelle(null);
            setMessage('simulation' in r ? r.message : null);
            load();
          }}
        />
      )}
      {cloture && closing && (
        <Cloture
          o={closing}
          resultat={cloture.r}
          onClose={() => setCloture(null)}
          onDone={(c) => {
            setCloture(null);
            void change(closing.id, c);
          }}
        />
      )}
    </>
  );
}
