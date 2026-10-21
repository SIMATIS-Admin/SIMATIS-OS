import { useState, type FormEvent, type ReactNode } from 'react';
import {
  ApiError,
  createEntreprise,
  creerProjetDiag,
  creerTestVma,
  type Entreprise,
  type NouveauTestVma,
  type ProjetDiag,
  type TestVmaType,
} from '../../api.js';
import { ACTIVITES } from '../Diagnostic.js';
import { messageEnvoi } from './envoi.js';

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Fenêtre superposée simple (pas de <dialog> : le navigateur de test ne la gère pas).
export function Modale({
  titre,
  onFermer,
  children,
}: {
  titre: string;
  onFermer: () => void;
  children: ReactNode;
}) {
  return (
    <div className="dg-voile" onClick={onFermer}>
      <div
        className="dg-modale"
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{titre}</h2>
        {children}
      </div>
    </div>
  );
}

// « Nouveau diagnostic ». Une entreprise qui a déjà un diagnostic en cours reçoit une nouvelle année :
// l'ancien reste dans l'historique (règle validée le 21 octobre 2026).
export function NouveauDiagnostic({
  slug,
  entreprises,
  projets,
  preselect,
  onFermer,
  onCree,
}: {
  slug: string;
  entreprises: Entreprise[];
  projets: ProjetDiag[];
  preselect?: string;
  onFermer: () => void;
  onCree: () => void;
}) {
  const [entrepriseId, setEntrepriseId] = useState(preselect ?? entreprises[0]?.id ?? '');
  const [activite, setActivite] = useState<string>(ACTIVITES[0][0]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const choisie = entreprises.find((e) => e.id === entrepriseId);
  const dejaEnCours = projets.some(
    (p) => p.entrepriseId === entrepriseId && p.statutDiagnostic !== 'Restitué',
  );

  const creer = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!choisie) return setErreur('Choisissez une entreprise.');
    setEnvoi(true);
    setErreur(null);
    try {
      await creerProjetDiag(slug, choisie.nom, activite, choisie.id);
      onCree();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale titre="Nouveau diagnostic" onFermer={onFermer}>
      <form className="stack" onSubmit={(ev) => void creer(ev)}>
        <label className="field" htmlFor="dg-diag-entreprise">
          <span>Entreprise</span>
        </label>
        <select
          id="dg-diag-entreprise"
          value={entrepriseId}
          onChange={(e) => setEntrepriseId(e.target.value)}
        >
          {entreprises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nom}
            </option>
          ))}
        </select>
        {dejaEnCours && (
          <div className="alert amber">
            Cette entreprise a déjà un diagnostic en cours. Le créer ouvre une nouvelle année :
            l’ancien reste dans l’historique.
          </div>
        )}
        <label className="field" htmlFor="dg-diag-activite">
          <span>Activité</span>
        </label>
        <select
          id="dg-diag-activite"
          value={activite}
          onChange={(e) => setActivite(e.target.value)}
        >
          {ACTIVITES.map(([id, nom]) => (
            <option key={id} value={id}>
              {nom}
            </option>
          ))}
        </select>
        {erreur && <div className="alert amber">{erreur}</div>}
        <div className="decision">
          <button className="btn go" type="submit" disabled={envoi || !choisie}>
            Créer le diagnostic
          </button>
          <button className="btn" type="button" onClick={onFermer}>
            Annuler
          </button>
        </div>
      </form>
    </Modale>
  );
}

// « Nouveau test VMA ». Un nom inconnu crée d'abord la fiche entreprise.
// La règle du semestre (409 « semestre ») demande une confirmation explicite avant toute création.
export function NouveauTestVma({
  slug,
  entreprises,
  preselect,
  onFermer,
  onCree,
}: {
  slug: string;
  entreprises: Entreprise[];
  preselect?: string;
  onFermer: () => void;
  onCree: () => void;
}) {
  const [entrepriseId, setEntrepriseId] = useState(preselect ?? '');
  const [nouvelle, setNouvelle] = useState('');
  const [type, setType] = useState<TestVmaType>('premier');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [semestre, setSemestre] = useState<{ message: string; demande: NouveauTestVma } | null>(
    null,
  );
  const [lien, setLien] = useState<string | null>(null);
  const [mail, setMail] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const envoyer = async (demande: NouveauTestVma) => {
    try {
      const cree = await creerTestVma(slug, demande);
      setSemestre(null);
      setLien(cree.lien);
      setMail(messageEnvoi(cree.envoi, cree.contactEmail));
      onCree();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.corps.code === 'semestre') {
        setSemestre({ message: e.message, demande });
        return;
      }
      setErreur(messageErreur(e));
    }
  };

  const creer = async (ev: FormEvent) => {
    ev.preventDefault();
    const nom = nouvelle.trim();
    const existante = entreprises.find((e) => e.id === entrepriseId);
    if (!nom && !existante) return setErreur('Choisissez une entreprise ou saisissez un nom.');
    if (!contact.trim()) return setErreur('Indiquez le dirigeant qui passe le test.');
    if (!email.includes('@')) return setErreur('Indiquez une adresse e-mail valide.');
    setEnvoi(true);
    setErreur(null);
    try {
      let id = existante?.id ?? null;
      let entrepriseNom = existante?.nom ?? nom;
      if (nom && !existante) {
        const creee = await createEntreprise(slug, { nom });
        id = creee.id;
        entrepriseNom = nom;
      }
      await envoyer({
        entrepriseId: id,
        entrepriseNom,
        type,
        contactNom: contact.trim(),
        contactEmail: email.trim(),
      });
    } finally {
      setEnvoi(false);
    }
  };

  if (lien) {
    return (
      <Modale titre="Invitation créée" onFermer={onFermer}>
        <p className="small muted">
          {mail ?? 'Envoyez ce lien au dirigeant.'} Il expire dans 14 jours.
        </p>
        <div className="alert">{lien}</div>
        <div className="decision">
          <button
            className="btn go"
            type="button"
            onClick={() => void navigator.clipboard?.writeText(lien)}
          >
            Copier le lien
          </button>
          <button className="btn" type="button" onClick={onFermer}>
            Fermer
          </button>
        </div>
      </Modale>
    );
  }

  return (
    <Modale titre="Nouveau test VMA" onFermer={onFermer}>
      <form className="stack" onSubmit={(ev) => void creer(ev)}>
        <label className="field" htmlFor="dg-vma-entreprise">
          <span>Entreprise</span>
        </label>
        <select
          id="dg-vma-entreprise"
          value={entrepriseId}
          onChange={(e) => setEntrepriseId(e.target.value)}
        >
          <option value="">— Choisir —</option>
          {entreprises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nom}
            </option>
          ))}
        </select>
        <label className="field" htmlFor="dg-vma-nouvelle">
          <span>Nom de l’entreprise (nouvelle)</span>
        </label>
        <input
          id="dg-vma-nouvelle"
          value={nouvelle}
          placeholder="Crée la fiche si elle n’existe pas"
          onChange={(e) => setNouvelle(e.target.value)}
        />
        <label className="field" htmlFor="dg-vma-type">
          <span>Type de test</span>
        </label>
        <select
          id="dg-vma-type"
          value={type}
          onChange={(e) => setType(e.target.value as TestVmaType)}
        >
          <option value="premier">Premier test</option>
          <option value="essai">Essai (non compté dans l’historique)</option>
        </select>
        <label className="field" htmlFor="dg-vma-contact">
          <span>Dirigeant qui passe le test</span>
        </label>
        <input id="dg-vma-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
        <label className="field" htmlFor="dg-vma-email">
          <span>E-mail du dirigeant</span>
        </label>
        <input
          id="dg-vma-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {semestre && (
          <div className="alert amber">
            {semestre.message}
            <div className="decision">
              <button
                className="btn go"
                type="button"
                onClick={() => void envoyer({ ...semestre.demande, confirmerSemestre: true })}
              >
                Créer quand même
              </button>
            </div>
          </div>
        )}
        {erreur && <div className="alert amber">{erreur}</div>}
        <div className="decision">
          <button className="btn go" type="submit" disabled={envoi}>
            Créer l’invitation
          </button>
          <button className="btn" type="button" onClick={onFermer}>
            Annuler
          </button>
        </div>
      </form>
    </Modale>
  );
}
