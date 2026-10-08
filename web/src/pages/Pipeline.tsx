import { useCallback, useEffect, useState, type DragEvent } from 'react';
import {
  changeOpportunite,
  fetchPipeline,
  syncConnexion,
  type Changement,
  type Pipeline as PipelineData,
  type PipelineOpp,
  type Qualification,
} from '../api.js';
import { eur } from '../crm.js';
import { Drawer, Modal } from './Overlay.js';
import { Tip } from './widgets.js';

// From the mockup (v-conversion.js MOTIFS, CONV_TIP; core.js cat and MATRICE).
const MOTIFS = [
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

function Card({
  o,
  draggable,
  label,
  onOpen,
}: {
  o: PipelineOpp;
  draggable: boolean;
  label: (id: string) => string;
  onOpen: () => void;
}) {
  return (
    <div
      className="card"
      draggable={draggable}
      tabIndex={0}
      onClick={onOpen}
      onDragStart={(e) => e.dataTransfer.setData(OPP_MIME, o.id)}
    >
      <div className="soc">{o.entreprise ?? '—'}</div>
      <div className="ttl">{o.titre}</div>
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
      <div className="ft">
        <Score q={o.qualification} />
        <span className="small">
          {o.montant ? eur(o.montant) : <span className="muted">à estimer</span>}
        </span>
      </div>
    </div>
  );
}

function Cloture({
  o,
  resultat,
  onClose,
  onDone,
}: {
  o: PipelineOpp;
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

function Fiche({
  o,
  data,
  onClose,
  onChange,
}: {
  o: PipelineOpp;
  data: PipelineData;
  onClose: () => void;
  onChange: (c: Changement) => void;
}) {
  const t = total(o.qualification);
  const m = MATRICE[`${o.potentiel}-${o.faisabilite}` as keyof typeof MATRICE];
  return (
    <Drawer
      label={o.titre}
      onClose={onClose}
      head={
        <>
          <h2>{o.entreprise ?? o.titre}</h2>
          <div className="small muted">{o.titre}</div>
        </>
      }
    >
      <div className="meta-row" style={{ marginBottom: 14 }}>
        {o.contact && (
          <span>
            Contact : <b>{o.contact}</b>
          </span>
        )}
        {o.montant ? <span className="num">{eur(o.montant)}</span> : null}
        {o.echeance && (
          <span>Échéance : {new Date(`${o.echeance}T12:00:00`).toLocaleDateString('fr-FR')}</span>
        )}
      </div>
      {o.clos ? (
        <p>
          <b>{o.clos === 'gagne' ? 'Gagnée' : 'Perdue'}</b>
          {o.motif ? ` : ${o.motif}` : ''}
        </p>
      ) : (
        <label className="field">
          <span>Étape</span>
          <select
            className="input"
            value={o.etape}
            disabled={!data.ecrit}
            onChange={(e) => onChange({ etape: e.target.value })}
          >
            {data.etapes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {t !== null && (
        <>
          <h3>Qualification</h3>
          <div className="verdict">
            <div className="big">
              {t}
              <small>/15</small>
            </div>
            <div>
              <span className={`score ${categorie(t).k}`}>{categorie(t).nom}</span>
              {m && (
                <div className="small" style={{ marginTop: 4 }}>
                  {m.nom} : {m.d}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {o.prochaineEtape && (
        <p className="small">
          Prochaine étape : <b>{o.prochaineEtape}</b>
        </p>
      )}
      {data.ecrit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {o.clos ? (
            <button className="btn" onClick={() => onChange({ rouvrir: true })}>
              Rouvrir
            </button>
          ) : (
            <>
              <button className="btn go" onClick={() => onChange({ clos: 'gagne' })}>
                Gagnée
              </button>
              <button className="btn" onClick={() => onChange({ clos: 'perdu', motif: 'Autre' })}>
                Perdue
              </button>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function Pipeline({ slug }: { slug: string }) {
  const [data, setData] = useState<PipelineData | null>(null);
  const [mode, setMode] = useState<'board' | 'matrice'>('board');
  const [open, setOpen] = useState<string | null>(null);
  const [cloture, setCloture] = useState<{ id: string; r: 'gagne' | 'perdu' } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

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
  const col = (id: string, nom: string, os: PipelineOpp[], cls = '') => (
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
        <span>{eur(os.reduce((a, o) => a + (o.montant ?? 0), 0))}</span>
      </div>
      {os.map((o) => (
        <Card key={o.id} o={o} draggable={data.ecrit} label={label} onOpen={() => setOpen(o.id)} />
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

  const opened = open ? find(open) : undefined;
  const closing = cloture ? find(cloture.id) : undefined;
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
        <div className="seg">
          <button className={mode === 'board' ? 'on' : ''} onClick={() => setMode('board')}>
            Étapes
          </button>
          <button className={mode === 'matrice' ? 'on' : ''} onClick={() => setMode('matrice')}>
            Matrice
          </button>
        </div>
      </div>
      {message && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div>{message}</div>
        </div>
      )}
      {mode === 'board' ? (
        <div className="board">
          {data.etapes.flatMap((e, k) => [
            col(
              e.id,
              e.label,
              ouvertes.filter((o) => o.etape === e.id),
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
                    <span key={o.id} className="pill" onClick={() => setOpen(o.id)}>
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
      {opened && (
        <Fiche
          o={opened}
          data={data}
          onClose={() => setOpen(null)}
          onChange={(c) => {
            if ('clos' in c) {
              setCloture({ id: opened.id, r: c.clos });
              setOpen(null);
            } else void change(opened.id, c);
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
