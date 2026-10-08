import { useEffect, useState } from 'react';
import { fetchContacts, type Contact } from '../api.js';
import { SearchBox } from './SearchBox.js';

export function Contacts({ slug }: { slug: string }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchContacts(slug, q).then(
      (rows) => alive && (setList(rows), setError(null)),
      (e: unknown) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [slug, q]);

  return (
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
            <tr key={c.id}>
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
  );
}
