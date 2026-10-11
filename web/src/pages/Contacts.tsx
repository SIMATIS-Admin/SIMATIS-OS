import { useEffect, useState } from 'react';
import {
  createContact,
  fetchContacts,
  fetchEntreprises,
  type Contact,
  type Entreprise,
  patchFiche,
} from '../api.js';
import { Modal } from './Overlay.js';
import { jour, Tableau } from './listes/Tableau.js';
import { SearchBox } from './SearchBox.js';

export function NouveauContact({
  slug,
  onClose,
  onCreated,
}: {
  slug: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [nom, setNom] = useState('');
  const [fonction, setFonction] = useState('');
  const [email, setEmail] = useState('');
  const [entrepriseId, setEntrepriseId] = useState('');
  const [entreprises, setEntreprises] = useState<Entreprise[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEntreprises(slug, '').then(setEntreprises, () => setEntreprises([]));
  }, [slug]);

  const submit = () =>
    createContact(slug, {
      nom,
      fonction: fonction || undefined,
      email: email || undefined,
      entrepriseId: entrepriseId || null,
    }).then(
      (c) => onCreated(c.id),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );

  return (
    <Modal title="Nouveau contact" onClose={onClose}>
      <label className="field">
        <span>Nom</span>
        <input className="input" value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Fonction</span>
        <input className="input" value={fonction} onChange={(e) => setFonction(e.target.value)} />
      </label>
      <label className="field">
        <span>Email</span>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Entreprise</span>
        <select
          className="input"
          value={entrepriseId}
          onChange={(e) => setEntrepriseId(e.target.value)}
        >
          <option value="">Aucune</option>
          {entreprises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nom}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="small" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn primary" disabled={!nom.trim()} onClick={() => void submit()}>
          Créer
        </button>
        <button className="btn ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Modal>
  );
}

export function Contacts({ slug }: { slug: string }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  // In-place and bulk edits: written like the detail page (HubSpot first when it is the source).
  const modifier = (id: string, champ: string, v: string | number | null) =>
    patchFiche(slug, 'contact', id, { [champ]: v }).then(
      (r) => {
        setMessage('simulation' in r ? r.message : null);
        setVersion((n) => n + 1);
      },
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );

  useEffect(() => {
    let alive = true;
    fetchContacts(slug, q).then(
      (rows) => alive && (setList(rows), setError(null)),
      (e: unknown) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [slug, q, version]);

  return (
    <>
      <div className="page-actions">
        <button className="btn primary" onClick={() => setCreating(true)}>
          Nouveau contact
        </button>
      </div>
      <div className="panel">
        <div className="panel-h">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Rechercher un nom, une fonction, une entreprise"
          />
          <span className="small muted">
            {list ? `${list.length} contact${list.length > 1 ? 's' : ''}` : ''}
          </span>
        </div>
        {error && <p className="empty">{error}</p>}
        {message && (
          <div className="alert amber" style={{ margin: 8 }}>
            <div>{message}</div>
          </div>
        )}
        {list && (
          <Tableau
            cle="contacts"
            lignes={list}
            titre={(c) => c.nom}
            onOuvrir={(c) => (location.hash = `#/${slug}/fiche/contact/${c.id}`)}
            onModifier={(c, champ, v) => modifier(c.id, champ, v)}
            colonnes={[
              {
                cle: 'nom',
                label: 'Personne',
                valeur: (c) => c.nom,
                affiche: (c) => <b>{c.nom}</b>,
              },
              { cle: 'entreprise', label: 'Organisation', valeur: (c) => c.entreprise },
              {
                cle: 'fonction',
                label: 'Fonction',
                valeur: (c) => c.fonction,
                edition: { champ: 'fonction' },
              },
              {
                cle: 'email',
                label: 'Email',
                valeur: (c) => c.email,
                edition: { champ: 'email', type: 'email' },
              },
              {
                cle: 'telephone',
                label: 'Téléphone',
                valeur: (c) => c.telephone,
                edition: { champ: 'telephone' },
              },
              { cle: 'opps', label: 'Affaires ouvertes', valeur: (c) => c.oppsOuvertes },
              {
                cle: 'prochaine',
                label: 'Prochaine activité',
                valeur: (c) => c.prochaineActivite,
                affiche: (c) => jour(c.prochaineActivite),
              },
              { cle: 'role', label: 'Rôle', valeur: (c) => c.role, masquee: true },
            ]}
          />
        )}
        {list?.length === 0 && <p className="empty">Aucun contact ne correspond.</p>}
      </div>
      {creating && (
        <NouveauContact
          slug={slug}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setVersion((v) => v + 1);
            location.hash = `#/${slug}/fiche/contact/${id}`;
          }}
        />
      )}
    </>
  );
}
