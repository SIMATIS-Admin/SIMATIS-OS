import { useEffect, useState } from 'react';
import { fetchEntreprises, type Entreprise } from '../api.js';
import { SearchBox } from './SearchBox.js';

export function Entreprises({ slug }: { slug: string }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Entreprise[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchEntreprises(slug, q).then(
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
          placeholder="Rechercher une entreprise, un secteur, une ville"
        />
        <span className="small muted">
          {list ? `${list.length} entreprise${list.length > 1 ? 's' : ''}` : ''}
        </span>
      </div>
      {error && <p className="empty">{error}</p>}
      <table className="tbl">
        <thead>
          <tr>
            <th>Entreprise</th>
            <th>Secteur</th>
            <th>Ville</th>
            <th className="r">Salariés</th>
            <th className="r">Contacts</th>
          </tr>
        </thead>
        <tbody>
          {list?.map((e) => (
            <tr key={e.id}>
              <td>
                <b>{e.nom}</b>
                {e.domaine && <div className="small muted">{e.domaine}</div>}
              </td>
              <td>{e.secteur}</td>
              <td>{e.ville}</td>
              <td className="r num">{e.taille ?? ''}</td>
              <td className="r num">{e.nbContacts}</td>
            </tr>
          ))}
          {list?.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                Aucune entreprise ne correspond.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
