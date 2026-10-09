import { useCallback, useEffect, useState } from 'react';
import {
  brancherHubspot,
  demarrerGoogle,
  fetchConnexions,
  saveReglages,
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
  <p className="small muted verrou">
    <Icon name="lock" />
    {children}
  </p>
);

function BrancherHubspot({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    setBusy(true);
    setError(null);
    brancherHubspot(slug, token)
      .then(onDone, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="field">
        <span>
          Jeton HubSpot du client{' '}
          <Tip text="Dans le HubSpot du client : Paramètres > Intégrations > Applications privées > Créer, avec la lecture et l'écriture des contacts, entreprises, transactions et tâches. Copiez le jeton (pat-…) et collez-le ici." />
        </span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder="pat-eu1-…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <div>
        <button className="btn primary" disabled={busy || !token.trim()} onClick={submit}>
          {busy ? 'Vérification…' : 'Vérifier et brancher HubSpot'}
        </button>
      </div>
      {error && (
        <p className="small" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      <Verrou>Le jeton reste sur l'ordinateur de l'OS : il n'est plus jamais affiché.</Verrou>
    </div>
  );
}

function ConnecterGoogle({ slug, clientDisponible }: { slug: string; clientDisponible: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    setBusy(true);
    setError(null);
    demarrerGoogle(slug).then(
      ({ url }) => location.assign(url),
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      },
    );
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div>
        <button className="btn primary" disabled={busy || !clientDisponible} onClick={go}>
          Connecter le compte Google
        </button>
      </div>
      {!clientDisponible && (
        <p className="small muted" style={{ margin: 0 }}>
          Bouton inactif : l'administrateur de l'OS doit d'abord activer la connexion Google (une
          seule fois pour tous les mandats).
        </p>
      )}
      {error && (
        <p className="small" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      <Verrou>
        Choisissez le compte Google utilisé pour ce mandat : Gmail (brouillons seulement) et Agenda
        sont branchés ensemble.
      </Verrou>
    </div>
  );
}

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
        <div className="alert amber" style={{ marginBottom: 12, display: 'block' }}>
          <p style={{ marginTop: 0 }}>Jeton HubSpot absent : collez-le pour reprendre la copie.</p>
          <BrancherHubspot slug={slug} onDone={onChange} />
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

function useSave(slug: string, kind: 'messagerie' | 'agenda', onChange: () => void) {
  const [error, setError] = useState<string | null>(null);
  const save = (patch: Record<string, unknown>) =>
    saveReglages(slug, kind, patch).then(onChange, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  return { save, error };
}

function Messagerie({
  slug,
  c,
  onChange,
}: {
  slug: string;
  c: ConnexionInfo;
  onChange: () => void;
}) {
  const { save, error } = useSave(slug, 'messagerie', onChange);
  const r = c.reglages as { historiqueMois?: number; contenu?: string };
  return (
    <div className="panel-b">
      <div className="grid g2">
        <label className="field">
          <span>Historique lu</span>
          <select
            className="input"
            value={r.historiqueMois ?? 12}
            onChange={(e) => void save({ historiqueMois: Number(e.target.value) })}
          >
            <option value={3}>3 mois</option>
            <option value={12}>12 mois</option>
            <option value={24}>24 mois</option>
          </select>
        </label>
        <label className="field">
          <span>Contenu lu</span>
          <select
            className="input"
            value={r.contenu ?? 'extraits'}
            onChange={(e) => void save({ contenu: e.target.value })}
          >
            <option value="extraits">Extraits seulement</option>
            <option value="complet">Corps complet</option>
          </select>
        </label>
      </div>
      <Verrou>Brouillons créés sans signature : Gmail ajoute la vôtre.</Verrou>
      <Verrou>Aucun envoi direct : vous envoyez depuis Gmail.</Verrou>
      {c.derniereErreur && (
        <p className="small" style={{ color: 'var(--red)' }}>
          Dernière erreur : {c.derniereErreur}
        </p>
      )}
      {error && <p className="small muted">{error}</p>}
    </div>
  );
}

function Agenda({ slug, c, onChange }: { slug: string; c: ConnexionInfo; onChange: () => void }) {
  const { save, error } = useSave(slug, 'agenda', onChange);
  const r = c.reglages as { calendriers?: string[]; tamponMin?: number };
  const [calendriers, setCalendriers] = useState((r.calendriers ?? ['primary']).join(', '));
  return (
    <div className="panel-b">
      <div className="grid g2">
        <label className="field">
          <span>
            Calendriers lus{' '}
            <Tip text="« primary » désigne l'agenda principal du compte. Séparez plusieurs agendas par des virgules." />
          </span>
          <input
            className="input"
            value={calendriers}
            onChange={(e) => setCalendriers(e.target.value)}
            onBlur={() =>
              void save({
                calendriers: calendriers
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label className="field">
          <span>Marge autour des rendez-vous</span>
          <select
            className="input"
            value={r.tamponMin ?? 15}
            onChange={(e) => void save({ tamponMin: Number(e.target.value) })}
          >
            <option value={0}>Aucune</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
          </select>
        </label>
      </div>
      <Verrou>L'OS ne lit que les plages occupées, pour proposer des créneaux libres.</Verrou>
      {error && <p className="small muted">{error}</p>}
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
      {location.hash.includes('google=ok') && (
        <div className="alert green">
          <div>Compte Google connecté : Gmail et Agenda sont branchés.</div>
        </div>
      )}
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
            {kind !== 'crm' && c && (c.etat === 'erreur' || (c.secret && !c.secret.present)) && (
              <div className="panel-b">
                <ConnecterGoogle slug={slug} clientDisponible={data.googleClientDisponible} />
              </div>
            )}
            {kind === 'crm' && c?.fournisseur === 'hubspot' ? (
              <CrmHubspot slug={slug} c={c} options={data.options} onChange={load} />
            ) : kind === 'messagerie' && c?.fournisseur === 'gmail' ? (
              <Messagerie slug={slug} c={c} onChange={load} />
            ) : kind === 'agenda' && c?.fournisseur === 'google-agenda' ? (
              <Agenda slug={slug} c={c} onChange={load} />
            ) : (
              <div className="panel-b stack">
                <p style={{ margin: 0 }}>
                  {c
                    ? 'Données fictives de démonstration.'
                    : kind === 'crm'
                      ? "Le client utilise HubSpot ? Demandez à son administrateur HubSpot un jeton d'application privée (Paramètres > Intégrations > Applications privées) et collez-le ici. L'OS copie entreprises, contacts, transactions et tâches, sans rien modifier dans HubSpot tant que vous ne l'autorisez pas."
                      : kind === 'messagerie'
                        ? "Connectez le compte Google utilisé pour ce mandat : l'OS prépare vos emails en brouillon dans Gmail (vous les envoyez vous-même) et retrouve l'historique des échanges avec chaque contact."
                        : "L'agenda se branche en même temps que la messagerie, avec le même compte Google : l'OS lit vos rendez-vous pour le brief du jour et propose des créneaux libres."}
                </p>
                {kind === 'crm' ? (
                  <BrancherHubspot slug={slug} onDone={load} />
                ) : kind === 'messagerie' ? (
                  <ConnecterGoogle slug={slug} clientDisponible={data.googleClientDisponible} />
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
