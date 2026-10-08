import { useCallback, useEffect, useState } from 'react';
import {
  fetchConnexions,
  saveReglagesCrm,
  syncConnexion,
  type ConnexionInfo,
  type ConnexionsReponse,
  type ReglagesCrm,
} from '../../api.js';
import { Icon } from '../../icons.js';
import { Tip } from '../widgets.js';

const FREQUENCES = [
  ['5min', 'Toutes les 5 minutes'],
  ['15min', 'Toutes les 15 minutes'],
  ['1h', 'Toutes les heures'],
  ['1j', 'Une fois par jour'],
  ['manuel', 'À la demande seulement'],
] as const;

const OBJETS: Record<string, string> = {
  entreprises: 'Entreprises',
  contacts: 'Contacts',
  transactions: 'Transactions (pipeline)',
  taches: 'Tâches',
};

const KINDS = [
  ['crm', 'CRM'],
  ['messagerie', 'Messagerie'],
  ['agenda', 'Agenda'],
] as const;

const depuis = (iso: string | null) => {
  if (!iso) return 'jamais';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  return heures < 24 ? `il y a ${heures} h` : `il y a ${Math.round(heures / 24)} j`;
};

function Etat({ c }: { c: ConnexionInfo | undefined }) {
  if (!c || c.etat === 'non_configuree') return <span className="badge amber">Non configuré</span>;
  if (c.etat === 'erreur') return <span className="badge red">Erreur</span>;
  return <span className="badge green">Connecté</span>;
}

const Verrou = ({ children }: { children: string }) => (
  <p className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
    <Icon name="lock" />
    {children}
  </p>
);

function CrmHubspot({
  slug,
  c,
  options,
  onChange,
}: {
  slug: string;
  c: ConnexionInfo;
  options: ConnexionsReponse['options'];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const r = c.reglages;
  const exclus = r.champsExclus ?? ['annualrevenue'];
  const objets = r.objets ?? options.objets;

  const save = (patch: ReglagesCrm) =>
    saveReglagesCrm(slug, patch).then(onChange, (e: unknown) => setMessage(String(e)));
  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const sync = () => {
    setBusy(true);
    setMessage(null);
    syncConnexion(slug, 'crm')
      .then(
        (rep) =>
          setMessage(`Synchronisé : ${rep.lus} lus, ${rep.crees} créés, ${rep.maj} mis à jour.`),
        (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => {
        setBusy(false);
        onChange();
      });
  };

  return (
    <div className="panel-b">
      {c.secret && !c.secret.present && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div>
            Jeton absent : ajouter <code>{c.secret.nom}</code> dans{' '}
            <code>secrets/instances/{slug}.env</code>, sur l'ordinateur qui fait tourner l'OS.
          </div>
        </div>
      )}
      <div className="grid g2">
        <label className="field">
          <span>Fréquence de synchronisation</span>
          <select
            className="input"
            value={r.frequence ?? '15min'}
            onChange={(e) => void save({ frequence: e.target.value as ReglagesCrm['frequence'] })}
          >
            {FREQUENCES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            Sens{' '}
            <Tip text="Lecture seule d'abord : vérifiez la copie, puis autorisez l'écriture dans HubSpot." />
          </span>
          <select
            className="input"
            value={r.sens ?? 'lecture'}
            onChange={(e) => void save({ sens: e.target.value as ReglagesCrm['sens'] })}
          >
            <option value="lecture">De HubSpot vers l'OS (lecture seule)</option>
            <option value="deux_sens">Dans les deux sens</option>
          </select>
        </label>
      </div>
      <div className="field">
        <span>Objets synchronisés</span>
        <div className="checks-row">
          {options.objets.map((o) => (
            <label key={o} className="check">
              <input
                type="checkbox"
                checked={objets.includes(o)}
                onChange={() => void save({ objets: toggle(objets, o) })}
              />
              <span>{OBJETS[o] ?? o}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <span>
          Champs synchronisés{' '}
          <Tip text="Décochez un champ pour l'exclure : l'OS ne le lit plus et ne l'écrit jamais dans HubSpot." />
        </span>
        <div className="checks-row">
          {options.champs.map((f) => (
            <label key={f.cle} className="check">
              <input
                type="checkbox"
                checked={!exclus.includes(f.cle)}
                onChange={() => void save({ champsExclus: toggle(exclus, f.cle) })}
              />
              <span>{f.libelle}</span>
            </label>
          ))}
        </div>
      </div>
      <Verrou>HubSpot fait foi en cas d'écart. Aucune suppression n'est jamais écrite.</Verrou>
      <div className="decision">
        <button className="btn" disabled={busy} onClick={sync}>
          {busy ? 'Synchronisation…' : 'Synchroniser maintenant'}
        </button>
        <span className="hint">Dernière synchronisation : {depuis(c.derniereSynchro)}.</span>
      </div>
      {c.derniereErreur && (
        <p className="small" style={{ color: 'var(--red)' }}>
          Dernière erreur : {c.derniereErreur}
        </p>
      )}
      {message && <p className="small muted">{message}</p>}
    </div>
  );
}

export function Connexions({ slug }: { slug: string }) {
  const [data, setData] = useState<ConnexionsReponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchConnexions(slug).then(setData, (e: unknown) => setError(String(e)));
  }, [slug]);
  useEffect(load, [load]);

  if (error) return <div className="empty">{error}</div>;
  if (!data) return null;
  return (
    <div className="stack">
      {!data.ecrituresReelles && (
        <div className="alert blue">
          <Icon name="lock" />
          <div>
            Écritures réelles désactivées : toute écriture vers un outil du client est simulée et
            notée au journal.
          </div>
        </div>
      )}
      {KINDS.map(([kind, label]) => {
        const c = data.connexions.find((x) => x.kind === kind);
        return (
          <div key={kind} className="panel">
            <div className="panel-h">
              <div>
                <h2>{c ? (c.fournisseur === 'hubspot' ? 'HubSpot' : c.fournisseur) : label}</h2>
                <div className="small muted">{label}</div>
              </div>
              <Etat c={c} />
            </div>
            {kind === 'crm' && c?.fournisseur === 'hubspot' ? (
              <CrmHubspot slug={slug} c={c} options={data.options} onChange={load} />
            ) : (
              <div className="panel-b">
                <p style={{ margin: 0 }}>
                  {kind === 'crm'
                    ? c
                      ? 'Données fictives de démonstration.'
                      : "Pas de CRM branché : pipeline, entreprises et contacts sont tenus par l'OS. Pour brancher le HubSpot du client, l'agent lance connexion:set avec le jeton dans les secrets de l'instance."
                    : 'Messagerie et agenda arrivent avec le lot 10. Sans cette connexion, rien ne part depuis la boîte d’une autre instance.'}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
