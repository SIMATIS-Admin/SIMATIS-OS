import { useCallback, useEffect, useState } from 'react';
import {
  couperPartenaire,
  fetchPartenaires,
  inviterPartenaire,
  reglerPartenaire,
  rejoindrePartenaire,
  type InvitationVue,
  type ObjetCrm,
  type PartenaireVue,
  type PartenairesReponse,
  type Voit,
} from '../../api.js';
import { Icon } from '../../icons.js';
import { Tip } from '../widgets.js';

const OBJETS: Record<ObjetCrm, string> = {
  entreprise: 'Entreprises',
  contact: 'Contacts',
  affaire: 'Affaires',
  tache: 'Tâches',
  rendez_vous: 'Rendez-vous',
  activite: 'Activités',
};

// Same wording as the partner's OS (kit, autonomie.js LIBELLES).
// What the chosen level does with a mission received from partner `p`.
const NOTE_NIVEAU: Record<PartenaireVue['niveau'], (p: string) => string> = {
  L0: () => 'Ses missions arrivent dans l’Inbox, rien ne démarre sans vous.',
  L1: () => 'Votre agent vous demande avant de commencer, dans l’Inbox.',
  L2: (p) => `Rien ne repart chez ${p} sans votre accord.`,
  L3: (p) => `Votre agent fait la mission et répond seul à ${p}.`,
};

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

function Copier({ texte }: { texte: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <button
      className="btn"
      onClick={() =>
        void navigator.clipboard.writeText(texte).then(() => {
          setCopie(true);
          setTimeout(() => setCopie(false), 2000);
        })
      }
    >
      {copie ? 'Copié' : 'Copier'}
    </button>
  );
}

function Lien({ invitation }: { invitation: InvitationVue }) {
  return (
    <div className="lien-copie">
      <input
        className="input"
        readOnly
        aria-label="Lien d'invitation à transmettre"
        value={invitation.lien}
        onFocus={(e) => e.target.select()}
      />
      <Copier texte={invitation.lien} />
    </div>
  );
}

function Inviter({
  slug,
  data,
  onDone,
}: {
  slug: string;
  data: PartenairesReponse;
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    setBusy(true);
    setError(null);
    inviterPartenaire(slug, email.trim())
      .then(
        () => {
          setEmail('');
          onDone();
        },
        (e: unknown) => setError(message(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Inviter un partenaire</h2>
      </div>
      <div className="panel-b stack" style={{ gap: 8 }}>
        <label className="field">
          <span>
            E-mail du partenaire (facultatif){' '}
            <Tip text="Seulement pour reconnaître l'invitation : aucun mail n'est envoyé. Transmettez vous-même le lien ; le partenaire le colle dans son OS." />
          </span>
          <input
            className="input"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <div>
          <button
            className="btn primary"
            disabled={busy || !data.ecrituresReelles || !data.peutInviter}
            onClick={submit}
          >
            {busy ? 'Création…' : 'Inviter un partenaire'}
          </button>
        </div>
        {!data.peutInviter && (
          <p className="small muted">
            Il manque la clé d'inscription du relais (RELAIS_CLE_INSCRIPTION) sur le serveur. Sans
            elle, collez le lien reçu d'un partenaire.
          </p>
        )}
        {error && (
          <p className="small" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Invitation({ invitation }: { invitation: InvitationVue }) {
  return (
    <div className="panel">
      <div className="panel-h">
        <div>
          <h2>{invitation.email ?? 'Invitation sans e-mail'}</h2>
          <div className="small muted">
            Créée le {date(invitation.creeeLe)} · valable jusqu'au {date(invitation.expireLe)}
          </div>
        </div>
        <span className="badge amber">En attente</span>
      </div>
      <div className="panel-b">
        <Lien invitation={invitation} />
      </div>
    </div>
  );
}

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
  data,
  onChange,
}: {
  slug: string;
  p: PartenaireVue;
  data: PartenairesReponse;
  onChange: () => void;
}) {
  const { objets, champsExcluables: champs, ecrituresReelles: ouvert } = data;
  const court = nomCourt(p.nom);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action().then(onChange, (e: unknown) => setError(message(e)));
  };
  const basculer = <T,>(liste: T[], x: T) =>
    liste.includes(x) ? liste.filter((y) => y !== x) : [...liste, x];
  const regler = (voit: Partial<Voit>) =>
    run(() => reglerPartenaire(slug, p.id, { voit: { ...p.voit, ...voit } }));
  const coupee = p.statut === 'coupee';
  return (
    <div className="panel">
      <div className="panel-h">
        <div>
          <h2>{p.nom}</h2>
          <div className="small muted">
            {coupee && p.coupeeAt
              ? `Connexion coupée le ${date(p.coupeeAt)}`
              : `Connecté depuis le ${date(p.connecteDepuis)}${
                  p.synchroAt
                    ? ` · suivi commercial à jour le ${new Date(p.synchroAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`
                    : ''
                }`}
          </div>
        </div>
        <span className={`badge ${coupee ? 'red' : 'green'}`}>
          {coupee ? 'Coupée' : 'Connecté'}
        </span>
      </div>
      {!coupee && (
        <div className="panel-b stack">
          <h3>Paramètres</h3>
          <div className="stack" style={{ gap: 8 }}>
            <h4 id={`niveau-${p.id}`}>Quand {court} confie une mission à votre agent</h4>
            <div
              className="seg adaptable"
              role="group"
              aria-labelledby={`niveau-${p.id}`}
              style={{ alignSelf: 'flex-start' }}
            >
              {data.niveaux.map((n) => (
                <button
                  key={n.id}
                  className={p.niveau === n.id ? 'on' : ''}
                  aria-pressed={p.niveau === n.id}
                  onClick={() =>
                    p.niveau !== n.id && run(() => reglerPartenaire(slug, p.id, { niveau: n.id }))
                  }
                >
                  {n.libelle}
                </button>
              ))}
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {NOTE_NIVEAU[p.niveau](court)}
            </p>
            <div className="garde-fous">
              <span className="small muted">Toujours avec votre accord</span>
              {data.gardeFous.map((g) => (
                <span key={g} className="chip fixe">
                  <Icon name="lock" />
                  {g}
                </span>
              ))}
            </div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <h4>
              {court} voit{' '}
              <Tip text="Vos missions, vos messages et le suivi commercial de cette instance, tenu à jour dans les deux sens. Un objet décoché ou un champ exclu ne part jamais ; un rendez-vous non commercial non plus." />
            </h4>
            <div className="checks-row">
              {objets.map((o) => (
                <label key={o} className="check">
                  <input
                    type="checkbox"
                    checked={p.voit.objets.includes(o)}
                    onChange={() => regler({ objets: basculer(p.voit.objets, o) })}
                  />
                  <span>{OBJETS[o]}</span>
                </label>
              ))}
            </div>
            <div className="small muted">
              Champs exclus{' '}
              <Tip text="Comme pour la synchronisation HubSpot : un champ coché ici ne part pas." />
            </div>
            <div className="checks-row">
              {champs.map((c) => (
                <label key={c.cle} className="check">
                  <input
                    type="checkbox"
                    checked={p.voit.champsExclus.includes(c.cle)}
                    onChange={() => regler({ champsExclus: basculer(p.voit.champsExclus, c.cle) })}
                  />
                  <span>{c.libelle}</span>
                </label>
              ))}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={p.voit.qualification}
                onChange={() => regler({ qualification: !p.voit.qualification })}
              />
              <span>
                Partager la qualification des affaires{' '}
                <Tip text="Qualification, potentiel et faisabilité : vous en êtes responsable. Non cochée, elle reste ici." />
              </span>
            </label>
          </div>
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
    return (
      <div className="empty">
        Un OS partenaire se connecte depuis l'instance de son client (un mandat) : seul le suivi
        commercial de ce client est partagé.
      </div>
    );
  }
  return (
    <div className="stack">
      {!data.ecrituresReelles && (
        <div className="alert blue">
          <Icon name="lock" />
          <div>
            Écritures réelles désactivées : rien ne part au relais. Inviter ou se connecter est
            impossible et les missions restent en simulation, notées au journal.
          </div>
        </div>
      )}
      <Inviter slug={slug} data={data} onDone={load} />
      {data.invitations.map((i) => (
        <Invitation key={i.id} invitation={i} />
      ))}
      <Rejoindre slug={slug} ouvert={data.ecrituresReelles} onDone={load} />
      {data.partenaires.map((p) => (
        <Partenaire key={p.id} slug={slug} p={p} data={data} onChange={load} />
      ))}
      {data.missions.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <h2>Missions</h2>
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
                      <td className="muted">
                        {m.sens === 'recue' ? 'De' : 'À'} {nomCourt(m.partenaire)}
                      </td>
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
