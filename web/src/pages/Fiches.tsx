import { useEffect, useState } from 'react';
import { fetchContact, fetchEntreprise, type FicheContact, type FicheEntreprise } from '../api.js';
import { etapeNom, eur } from '../crm.js';
import { Drawer } from './Overlay.js';

type Open = { kind: 'entreprise' | 'contact'; id: string };

function useFiche<T>(load: () => Promise<T>, key: string) {
  const [fiche, setFiche] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFiche(null);
    load().then(
      (f) => alive && setFiche(f),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
    // `key` identifies what to load; `load` is recreated on every render.
  }, [key]);
  return { fiche, error };
}

const Opps = ({ opps }: { opps: FicheEntreprise['opportunites'] }) =>
  opps.length ? (
    <ul className="hist">
      {opps.map((o) => (
        <li key={o.id}>
          <span className="d">{etapeNom(o)}</span>
          <span>
            {o.titre} {o.montant ? <span className="num">{eur(o.montant)}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted small">Aucune opportunité.</p>
  );

function EntrepriseDrawer({
  slug,
  id,
  onOpen,
  onClose,
}: {
  slug: string;
  id: string;
  onOpen: (o: Open) => void;
  onClose: () => void;
}) {
  const { fiche, error } = useFiche<FicheEntreprise>(() => fetchEntreprise(slug, id), id);
  return (
    <Drawer
      label={fiche?.nom ?? 'Entreprise'}
      onClose={onClose}
      head={
        <>
          <h2>{fiche?.nom ?? '…'}</h2>
          <div className="small muted">
            {[fiche?.secteur, fiche?.ville].filter(Boolean).join(', ')}
          </div>
        </>
      }
    >
      {error && <p className="empty">{error}</p>}
      {fiche && (
        <>
          <div className="meta-row" style={{ marginBottom: 14 }}>
            {fiche.taille ? (
              <span>
                <b className="num">{fiche.taille}</b> salariés
              </span>
            ) : null}
            {fiche.domaine && <span>{fiche.domaine}</span>}
          </div>
          <h3>Contacts</h3>
          {fiche.contacts.length ? (
            <ul className="hist">
              {fiche.contacts.map((c) => (
                <li key={c.id}>
                  <span className="d">{c.role ?? ''}</span>
                  <span>
                    <button className="link" onClick={() => onOpen({ kind: 'contact', id: c.id })}>
                      {c.nom}
                    </button>
                    {c.fonction ? `, ${c.fonction}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Aucun contact.</p>
          )}
          <h3 style={{ marginTop: 18 }}>Opportunités</h3>
          <Opps opps={fiche.opportunites} />
        </>
      )}
    </Drawer>
  );
}

function ContactDrawer({
  slug,
  id,
  onOpen,
  onClose,
}: {
  slug: string;
  id: string;
  onOpen: (o: Open) => void;
  onClose: () => void;
}) {
  const { fiche, error } = useFiche<FicheContact>(() => fetchContact(slug, id), id);
  return (
    <Drawer
      label={fiche?.nom ?? 'Contact'}
      onClose={onClose}
      head={
        <>
          <h2>{fiche?.nom ?? '…'}</h2>
          <div className="small muted">{fiche?.fonction}</div>
        </>
      }
    >
      {error && <p className="empty">{error}</p>}
      {fiche && (
        <>
          <div className="meta-row" style={{ marginBottom: 14 }}>
            {fiche.entreprise && (
              <button
                className="link"
                onClick={() =>
                  fiche.entreprise && onOpen({ kind: 'entreprise', id: fiche.entreprise.id })
                }
              >
                {fiche.entreprise.nom}
              </button>
            )}
            {fiche.email && <span>{fiche.email}</span>}
            {fiche.telephone && <span>{fiche.telephone}</span>}
            {fiche.role && <span className="badge">{fiche.role}</span>}
          </div>
          <h3>Opportunités</h3>
          <Opps opps={fiche.opportunites} />
          <h3 style={{ marginTop: 18 }}>Tâches ouvertes</h3>
          {fiche.taches.length ? (
            <ul className="hist">
              {fiche.taches.map((x) => (
                <li key={x.id}>
                  <span className="d">
                    {x.echeance
                      ? new Date(x.echeance).toLocaleDateString('fr-FR', {
                          timeZone: 'Europe/Paris',
                          day: 'numeric',
                          month: 'short',
                        })
                      : ''}
                  </span>
                  <span>{x.titre}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Aucune tâche ouverte.</p>
          )}
        </>
      )}
    </Drawer>
  );
}

// Company and contact sheets open on top of the lists and link to each other.
export function Fiches({
  slug,
  open,
  setOpen,
}: {
  slug: string;
  open: Open | null;
  setOpen: (o: Open | null) => void;
}) {
  if (!open) return null;
  const close = () => setOpen(null);
  return open.kind === 'entreprise' ? (
    <EntrepriseDrawer slug={slug} id={open.id} onOpen={setOpen} onClose={close} />
  ) : (
    <ContactDrawer slug={slug} id={open.id} onOpen={setOpen} onClose={close} />
  );
}

export type { Open };
