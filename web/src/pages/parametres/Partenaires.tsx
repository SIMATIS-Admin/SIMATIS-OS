import { useCallback, useEffect, useState } from 'react';
import {
  couperPartenaire,
  fetchPartenaires,
  reglerPartenaire,
  rejoindrePartenaire,
  type ObjetPartage,
  type PartenaireVue,
  type PartenairesReponse,
} from '../../api.js';
import { Icon } from '../../icons.js';
import { Tip } from '../widgets.js';

const OBJETS: Record<ObjetPartage, string> = {
  prospect: 'Prospects',
  rendez_vous: 'Rendez-vous',
  affaire: 'Affaires',
  compte_rendu: 'Comptes rendus',
};

const NIVEAUX = [
  ['L0', 'L0 · Suggérer seulement'],
  ['L1', 'L1 · Préparer'],
  ['L2', 'L2 · Faire, puis valider'],
  ['L3', 'L3 · Faire seul'],
] as const;

const ETATS: Record<string, [string, string]> = {
  simulation: ['Simulation', 'amber'],
  submitted: ['Envoyée', 'blue'],
  working: ['En cours', 'blue'],
  'input-required': ['Précision demandée', 'amber'],
  completed: ['Faite', 'green'],
  failed: ['Échec', 'red'],
  canceled: ['Annulée', 'red'],
  rejected: ['Refusée', 'red'],
};

const nomCourt = (nom: string) => nom.split(' · ')[0]?.trim() || nom;
const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Rejoindre({
  slug,
  ouvert,
  onDone,
}: {
  slug: string;
  ouvert: boolean;
  onDone: () => void;
}) {
  const [lien, setLien] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    setBusy(true);
    setError(null);
    rejoindrePartenaire(slug, lien.trim())
      .then(
        () => {
          setLien('');
          onDone();
        },
        (e: unknown) => setError(message(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Se connecter à un partenaire</h2>
      </div>
      <div className="panel-b stack" style={{ gap: 8 }}>
        <label className="field">
          <span>
            Lien d'invitation{' '}
            <Tip text="Le partenaire (Alpes OS par exemple) crée une invitation dans son OS et vous envoie le lien. Collez-le ici : la connexion apparaît des deux côtés." />
          </span>
          <input
            className="input"
            autoComplete="off"
            placeholder="https://relais…/invitations/…"
            value={lien}
            onChange={(e) => setLien(e.target.value)}
          />
        </label>
        <div>
          <button
            className="btn primary"
            disabled={busy || !ouvert || !lien.trim()}
            onClick={submit}
          >
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </div>
        {error && (
          <p className="small" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Partenaire({
  slug,
  p,
  objets,
  ouvert,
  onChange,
}: {
  slug: string;
  p: PartenaireVue;
  objets: ObjetPartage[];
  ouvert: boolean;
  onChange: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action().then(onChange, (e: unknown) => setError(message(e)));
  };
  const toggle = (o: ObjetPartage) =>
    p.partage.includes(o) ? p.partage.filter((x) => x !== o) : [...p.partage, o];
  const coupee = p.statut === 'coupee';
  return (
    <div className="panel">
      <div className="panel-h">
        <div>
          <h2>{p.nom}</h2>
          <div className="small muted">
            {coupee && p.coupeeAt
              ? `Connexion coupée le ${date(p.coupeeAt)}`
              : `Connecté depuis le ${date(p.connecteDepuis)}`}
          </div>
        </div>
        <span className={`badge ${coupee ? 'red' : 'green'}`}>
          {coupee ? 'Coupée' : 'Connecté'}
        </span>
      </div>
      {!coupee && (
        <div className="panel-b stack">
          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>
              {nomCourt(p.nom)} voit{' '}
              <Tip text="Ce que l'agent peut lui envoyer du suivi commercial, quand vous le demandez. Rien n'est coché : rien ne part." />
            </div>
            <div className="checks-row">
              {objets.map((o) => (
                <label key={o} className="check">
                  <input
                    type="checkbox"
                    checked={p.partage.includes(o)}
                    onChange={() => run(() => reglerPartenaire(slug, p.id, { partage: toggle(o) }))}
                  />
                  <span>{OBJETS[o]}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="field">
            <span>
              Missions reçues de {nomCourt(p.nom)}{' '}
              <Tip text="Ce que l'OS fera d'une mission que ce partenaire vous confie. Réglage enregistré dès maintenant, utilisé quand la réception des missions arrivera." />
            </span>
            <select
              className="input"
              value={p.niveau}
              onChange={(e) =>
                run(() =>
                  reglerPartenaire(slug, p.id, {
                    niveau: e.target.value as PartenaireVue['niveau'],
                  }),
                )
              }
            >
              {NIVEAUX.map(([n, label]) => (
                <option key={n} value={n}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button
              className="btn"
              disabled={!ouvert}
              onClick={() => (armed ? run(() => couperPartenaire(slug, p.id)) : setArmed(true))}
            >
              {armed ? 'Confirmer : couper la connexion' : 'Couper la connexion'}
            </button>
          </div>
          {error && (
            <p className="small" style={{ color: 'var(--red)' }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function Partenaires({ slug }: { slug: string }) {
  const [data, setData] = useState<PartenairesReponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchPartenaires(slug).then(setData, (e: unknown) => setError(message(e)));
  }, [slug]);
  useEffect(load, [load]);

  if (!data) return error ? <div className="empty">{error}</div> : null;
  if (!data.actif) {
    return (
      <div className="empty">
        Relais d'agents non configuré sur ce serveur : les partenaires ne sont pas disponibles.
      </div>
    );
  }
  if (!data.porteuse) {
    return <div className="empty">Les OS partenaires se connectent depuis « Mon activité ».</div>;
  }
  return (
    <div className="stack">
      {!data.ecrituresReelles && (
        <div className="alert blue">
          <Icon name="lock" />
          <div>
            Écritures réelles désactivées : rien ne part au relais. Se connecter est impossible et
            les missions restent en simulation, notées au journal.
          </div>
        </div>
      )}
      <Rejoindre slug={slug} ouvert={data.ecrituresReelles} onDone={load} />
      {data.partenaires.map((p) => (
        <Partenaire
          key={p.id}
          slug={slug}
          p={p}
          objets={data.objets}
          ouvert={data.ecrituresReelles}
          onChange={load}
        />
      ))}
      {data.missions.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <h2>Missions confiées</h2>
          </div>
          <div className="panel-b">
            <table className="tbl small">
              <tbody>
                {data.missions.map((m) => {
                  const [libelle, couleur] = ETATS[m.etat] ?? [m.etat, 'navy'];
                  return (
                    <tr key={m.id}>
                      <td>
                        {m.titre}
                        {m.dernierMessage && <div className="muted">{m.dernierMessage}</div>}
                      </td>
                      <td className="muted">{nomCourt(m.partenaire)}</td>
                      <td>
                        <span className={`badge ${couleur}`}>{libelle}</span>
                      </td>
                      <td className="muted">{date(m.majLe)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
