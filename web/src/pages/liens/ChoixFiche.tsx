import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchContact, fetchEntreprise } from '../../api.js';
import { NouveauContact } from '../Contacts.js';
import { NouvelleEntreprise } from '../Entreprises.js';
import { LierExistant } from './CarteLiens.js';

// Picks the organisation or the contact a record belongs to: search an existing one or create it in
// a window (in a portal: the picker may sit inside a form), without leaving the page. The name is only known to the parent through onChange.
const nomDe = (slug: string, kind: 'entreprise' | 'contact', id: string) =>
  (kind === 'contact' ? fetchContact(slug, id) : fetchEntreprise(slug, id)).then((f) => f.nom);

export function ChoixFiche({
  slug,
  kind,
  id,
  label,
  entrepriseId,
  onChange,
}: {
  slug: string;
  kind: 'entreprise' | 'contact';
  id: string | null;
  label: string;
  // Organisation chosen for the same record: a new contact starts in it.
  entrepriseId?: string | null;
  onChange: (id: string | null, nom?: string) => void;
}) {
  const [nom, setNom] = useState<{ id: string; nom: string } | null>(null);
  const [mode, setMode] = useState<'repos' | 'chercher' | 'creer'>('repos');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!id || nom?.id === id) return;
    let vivant = true;
    void nomDe(slug, kind, id).then(
      (n) => vivant && setNom({ id, nom: n }),
      () => vivant && setNom({ id, nom: 'Fiche introuvable' }),
    );
    return () => {
      vivant = false;
    };
  }, [slug, kind, id, nom?.id]);

  const choisir = (nouveau: string) => {
    setMode('repos');
    setErreur(null);
    nomDe(slug, kind, nouveau).then(
      (n) => {
        setNom({ id: nouveau, nom: n });
        onChange(nouveau, n);
      },
      () => onChange(nouveau),
    );
  };

  return (
    <div className="field" aria-label={label}>
      <span>{label}</span>
      {id ? (
        <span>
          <a href={`#/${slug}/fiche/${kind}/${id}`}>{nom?.id === id ? nom.nom : '…'}</a>{' '}
          <button
            type="button"
            className="btn ghost sm"
            aria-label={`Retirer ${label}`}
            onClick={() => onChange(null)}
          >
            Retirer
          </button>
        </span>
      ) : (
        <span className="muted small">Aucun{kind === 'contact' ? '' : 'e'} pour l’instant</span>
      )}
      <span>
        <button type="button" className="btn ghost sm" onClick={() => setMode('chercher')}>
          {id ? 'Changer' : 'Choisir'}
        </button>{' '}
        <button type="button" className="btn ghost sm" onClick={() => setMode('creer')}>
          {kind === 'contact' ? 'Créer un contact' : 'Créer une organisation'}
        </button>
      </span>
      {mode === 'chercher' && (
        <LierExistant slug={slug} kind={kind} exclus={id ? [id] : []} onChoix={choisir} />
      )}
      {erreur && <div className="alert amber">{erreur}</div>}
      {mode === 'creer' &&
        kind === 'contact' &&
        createPortal(
          <NouveauContact
            slug={slug}
            entrepriseParDefaut={entrepriseId ?? undefined}
            onClose={() => setMode('repos')}
            onCreated={(nouveau, message) =>
              nouveau ? choisir(nouveau) : setErreur(message ?? null)
            }
          />,
          document.body,
        )}
      {mode === 'creer' &&
        kind === 'entreprise' &&
        createPortal(
          <NouvelleEntreprise
            slug={slug}
            onClose={() => setMode('repos')}
            onCreated={(nouveau, message) =>
              nouveau ? choisir(nouveau) : setErreur(message ?? null)
            }
          />,
          document.body,
        )}
    </div>
  );
}
