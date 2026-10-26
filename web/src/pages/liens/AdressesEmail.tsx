import { useState, type FormEvent } from 'react';
import {
  ajouterEmailContact,
  definirEmailPrincipal,
  retirerEmailContact,
  type EmailContact,
} from '../../api.js';
import { Icon } from '../../icons.js';

// Every address of a contact: the primary one is the one written in the email field and used to
// write to the person; the others recognise the person in mails and meeting invitations.
const messageErreur = (e: unknown) => (e instanceof Error ? e.message : 'Action impossible');

export function AdressesEmail({
  slug,
  contactId,
  emails,
  modifiable,
  hubspot,
  onChange,
}: {
  slug: string;
  contactId: string;
  emails: EmailContact[];
  modifiable: boolean;
  hubspot: boolean;
  onChange: () => void;
}) {
  const [nouvelle, setNouvelle] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const agir = (action: Promise<unknown>) =>
    action.then(
      () => {
        setErreur(null);
        onChange();
      },
      (e: unknown) => setErreur(messageErreur(e)),
    );
  const ajouter = (e: FormEvent) => {
    e.preventDefault();
    if (!nouvelle.trim()) return;
    void agir(ajouterEmailContact(slug, contactId, nouvelle)).then(() => setNouvelle(''));
  };
  if (!modifiable && emails.length < 2) return null;
  return (
    <div className="fi-champ" aria-label="Adresses email">
      <span className="muted small">Adresses email</span>
      <ul className="fi-liste">
        {emails.map((a) => (
          <li key={a.email} className="fi-ligne">
            <span>
              {a.email} {a.principal && <span className="badge">Principale</span>}
            </span>
            {modifiable && (
              <span>
                {!a.principal && !hubspot && (
                  <button
                    className="btn ghost sm"
                    onClick={() => void agir(definirEmailPrincipal(slug, contactId, a.email))}
                  >
                    Rendre principale
                  </button>
                )}
                {!(a.principal && hubspot) && (
                  <button
                    className="btn ghost sm"
                    aria-label={`Retirer ${a.email}`}
                    title="Retirer"
                    onClick={() => void agir(retirerEmailContact(slug, contactId, a.email))}
                  >
                    <Icon name="x" />
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {modifiable && (
        <form onSubmit={ajouter} className="decision">
          <input
            className="input"
            type="email"
            aria-label="Ajouter une adresse"
            placeholder="Ajouter une adresse"
            value={nouvelle}
            onChange={(e) => setNouvelle(e.target.value)}
          />
          <button className="btn sm" type="submit">
            Ajouter
          </button>
        </form>
      )}
      {erreur && <div className="alert amber">{erreur}</div>}
    </div>
  );
}
