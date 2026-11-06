import { useEffect, useState } from 'react';
import {
  commenterSessionEnrichissement,
  fetchContactsSession,
  fetchSessionsEnrichissement,
  supprimerSessionEnrichissement,
  type ContactSessionEnrichissement,
  type SessionEnrichissement,
} from '../api.js';
import { Icon } from '../icons.js';

const ETATS: Record<SessionEnrichissement['etat'], string> = {
  en_cours: 'En cours',
  terminee: 'Terminée',
  incomplete: 'Incomplète',
  erreur: 'En erreur',
};

const date = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const cle = (s: SessionEnrichissement) => `${s.nature}-${s.id}`;

// Le détail d'une session : ce qu'elle a produit, et le commentaire de Marc.
function DetailSession({
  slug,
  session,
  surCommentaire,
}: {
  slug: string;
  session: SessionEnrichissement;
  surCommentaire: (commentaire: string | null) => void;
}) {
  const [contacts, setContacts] = useState<ContactSessionEnrichissement[] | null>(null);
  const [commentaire, setCommentaire] = useState(session.commentaire ?? '');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void fetchContactsSession(slug, session).then(setContacts, () => setContacts([]));
  }, [slug, session.id, session.nature]);

  const enregistrer = () => {
    commenterSessionEnrichissement(slug, session, commentaire).then(
      () => {
        setMessage('Commentaire enregistré.');
        surCommentaire(commentaire.trim() || null);
      },
      () => setMessage('Le commentaire n’a pas pu être enregistré.'),
    );
  };

  return (
    <div className="stack" style={{ padding: '8px 0' }}>
      {contacts === null ? (
        <p className="muted small" style={{ margin: 0 }}>
          Chargement…
        </p>
      ) : contacts.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          Aucun contact enregistré pour cette session.
        </p>
      ) : (
        <table className="tbl small" aria-label="Contacts de la session">
          <thead>
            <tr>
              <th>Entreprise</th>
              <th>Contact</th>
              <th>Fonction</th>
              {contacts.some((c) => c.statut) && <th>Suite donnée</th>}
            </tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={i}>
                <td>{c.entreprise}</td>
                <td>{[c.prenom, c.nom].filter(Boolean).join(' ')}</td>
                <td>{c.fonction}</td>
                {contacts.some((x) => x.statut) && <td>{c.statut}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <label className="small">
        Commentaire
        <textarea
          value={commentaire}
          rows={2}
          maxLength={2000}
          style={{ width: '100%' }}
          onChange={(e) => {
            setCommentaire(e.target.value);
            setMessage('');
          }}
        />
      </label>
      <div>
        <button className="btn sm" onClick={enregistrer}>
          Enregistrer le commentaire
        </button>{' '}
        {message && <span className="small muted">{message}</span>}
      </div>
    </div>
  );
}

// Les derniers passages d'enrichissement, lancés à la main ou par la routine quotidienne.
export function SessionsEnrichissement({ slug, version }: { slug: string; version?: number }) {
  const [sessions, setSessions] = useState<SessionEnrichissement[] | null>(null);
  const [ouverte, setOuverte] = useState(
    () => window.localStorage.getItem('sessions-enrichissement-ouvertes') !== '0',
  );
  const [detail, setDetail] = useState<string | null>(null);
  const [erreur, setErreur] = useState('');

  const enCours = sessions?.some((s) => s.etat === 'en_cours') ?? false;
  useEffect(() => {
    const charger = () => void fetchSessionsEnrichissement(slug).then(setSessions, () => undefined);
    void fetchSessionsEnrichissement(slug).then(setSessions, () => setSessions([]));
    // Une session en cours se termine sans que la page le sache : on relit tant qu'elle tourne.
    const timer = enCours ? setInterval(charger, 5000) : undefined;
    window.addEventListener('recherche-prospects', charger);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener('recherche-prospects', charger);
    };
  }, [slug, version, enCours]);

  const basculer = () => {
    window.localStorage.setItem('sessions-enrichissement-ouvertes', ouverte ? '0' : '1');
    setOuverte(!ouverte);
  };

  const supprimer = (s: SessionEnrichissement) => {
    if (
      !window.confirm(
        'Supprimer cette session de l’historique ? Les fiches déjà ajoutées à la base restent en place.',
      )
    )
      return;
    setErreur('');
    supprimerSessionEnrichissement(slug, s).then(
      () => setSessions((l) => l?.filter((x) => cle(x) !== cle(s)) ?? null),
      (e: unknown) => setErreur(e instanceof Error ? e.message : 'Suppression impossible.'),
    );
  };

  return (
    <section className="panel" aria-label="Sessions d'enrichissement">
      <div className="panel-h" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h2>Sessions d’enrichissement</h2>
        <button className="btn sm" type="button" aria-expanded={ouverte} onClick={basculer}>
          {ouverte ? 'Replier la liste' : 'Déplier la liste'}
        </button>
      </div>
      {ouverte && (
        <div className="panel-b">
          {erreur && (
            <p className="small" role="alert" style={{ color: '#b42318' }}>
              {erreur}
            </p>
          )}
          {!sessions || sessions.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              {sessions ? 'Aucune session pour l’instant.' : 'Chargement…'}
            </p>
          ) : (
            <table className="tbl small">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Session</th>
                  <th>Déclenchement</th>
                  <th>Statut</th>
                  <th className="r">Traités</th>
                  <th className="r">Fiches ajoutées</th>
                  <th>Détail</th>
                  <th style={{ paddingLeft: 24 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <SessionLigne
                    key={cle(s)}
                    slug={slug}
                    session={s}
                    ouverte={detail === cle(s)}
                    basculer={() => setDetail(detail === cle(s) ? null : cle(s))}
                    supprimer={() => supprimer(s)}
                    surCommentaire={(commentaire) =>
                      setSessions(
                        (l) =>
                          l?.map((x) => (cle(x) === cle(s) ? { ...x, commentaire } : x)) ?? null,
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

function SessionLigne({
  slug,
  session: s,
  ouverte,
  basculer,
  supprimer,
  surCommentaire,
}: {
  slug: string;
  session: SessionEnrichissement;
  ouverte: boolean;
  basculer: () => void;
  supprimer: () => void;
  surCommentaire: (commentaire: string | null) => void;
}) {
  return (
    <>
      <tr>
        <td>
          <button
            className="link"
            aria-expanded={ouverte}
            title="Voir les contacts de cette session"
            onClick={basculer}
          >
            {date(s.date)}
          </button>
        </td>
        <td>{s.libelle}</td>
        <td>{s.mode === 'automatique' ? 'Automatique' : 'Manuel'}</td>
        <td>{ETATS[s.etat]}</td>
        <td className="r num">{s.traites}</td>
        <td className="r num">{s.ajoutees ?? '—'}</td>
        <td className="muted">{[s.detail, s.commentaire].filter(Boolean).join(' · ')}</td>
        <td style={{ paddingLeft: 24 }}>
          <button
            className="btn sm"
            style={{ color: '#b42318' }}
            aria-label="Supprimer la session"
            title="Supprimer la session"
            onClick={supprimer}
          >
            <span style={{ display: 'inline-flex', width: 16, height: 16 }}>
              <Icon name="trash" />
            </span>
          </button>
        </td>
      </tr>
      {ouverte && (
        <tr>
          <td colSpan={8}>
            <DetailSession slug={slug} session={s} surCommentaire={surCommentaire} />
          </td>
        </tr>
      )}
    </>
  );
}
