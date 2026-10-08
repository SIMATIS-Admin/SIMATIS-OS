import { useEffect, useState } from 'react';
import {
  createContact,
  fetchContacts,
  fetchEntreprises,
  type Contact,
  type Entreprise,
} from '../api.js';
import { Fiches, type Open } from './Fiches.js';
import { Modal } from './Overlay.js';
import { SearchBox } from './SearchBox.js';

function NouveauContact({
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
  const [open, setOpen] = useState<Open | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);

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
        <table className="tbl">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Fonction</th>
              <th>Entreprise</th>
              <th>Email</th>
              <th>Rôle</th>
            </tr>
          </thead>
          <tbody>
            {list?.map((c) => (
              <tr
                key={c.id}
                className="click"
                onClick={() => setOpen({ kind: 'contact', id: c.id })}
              >
                <td>
                  <b>{c.nom}</b>
                </td>
                <td>{c.fonction}</td>
                <td>{c.entreprise}</td>
                <td className="small">{c.email}</td>
                <td>{c.role && <span className="badge">{c.role}</span>}</td>
              </tr>
            ))}
            {list?.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  Aucun contact ne correspond.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Fiches slug={slug} open={open} setOpen={setOpen} />
      {creating && (
        <NouveauContact
          slug={slug}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setVersion((v) => v + 1);
            setOpen({ kind: 'contact', id });
          }}
        />
      )}
    </>
  );
}
