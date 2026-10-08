import { useEffect, useState } from 'react';
import { createEntreprise, fetchEntreprises, type Entreprise } from '../api.js';
import { eur } from '../crm.js';
import { Fiches, type Open } from './Fiches.js';
import { Modal } from './Overlay.js';
import { SearchBox } from './SearchBox.js';

function NouvelleEntreprise({
  slug,
  onClose,
  onCreated,
}: {
  slug: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [nom, setNom] = useState('');
  const [secteur, setSecteur] = useState('');
  const [ville, setVille] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () =>
    createEntreprise(slug, {
      nom,
      secteur: secteur || undefined,
      ville: ville || undefined,
    }).then(
      (e) => onCreated(e.id),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  return (
    <Modal title="Nouvelle entreprise" onClose={onClose}>
      <label className="field">
        <span>Nom</span>
        <input className="input" value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Secteur</span>
        <input className="input" value={secteur} onChange={(e) => setSecteur(e.target.value)} />
      </label>
      <label className="field">
        <span>Ville</span>
        <input className="input" value={ville} onChange={(e) => setVille(e.target.value)} />
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

export function Entreprises({ slug }: { slug: string }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Entreprise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchEntreprises(slug, q).then(
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
          Nouvelle entreprise
        </button>
      </div>
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
              <th>Opportunités</th>
            </tr>
          </thead>
          <tbody>
            {list?.map((e) => (
              <tr
                key={e.id}
                className="click"
                onClick={() => setOpen({ kind: 'entreprise', id: e.id })}
              >
                <td>
                  <b>{e.nom}</b>
                  {e.domaine && <div className="small muted">{e.domaine}</div>}
                </td>
                <td>{e.secteur}</td>
                <td>{e.ville}</td>
                <td className="r num">{e.taille ?? ''}</td>
                <td className="r num">{e.nbContacts}</td>
                <td className="small">
                  {e.oppsOuvertes ? (
                    `${e.oppsOuvertes} ouverte${e.oppsOuvertes > 1 ? 's' : ''}, ${eur(e.montantOuvert)}`
                  ) : (
                    <span className="muted">Aucune ouverte</span>
                  )}
                </td>
              </tr>
            ))}
            {list?.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Aucune entreprise ne correspond.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Fiches slug={slug} open={open} setOpen={setOpen} />
      {creating && (
        <NouvelleEntreprise
          slug={slug}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setVersion((v) => v + 1);
            setOpen({ kind: 'entreprise', id });
          }}
        />
      )}
    </>
  );
}
