import { useEffect, useId, useState, type FormEvent } from 'react';
import { ajouterAuRadar, fetchContacts, type Contact, type EntreeRadarInput } from '../../api.js';

const CANAUX = ['LinkedIn', 'E-mail', 'Téléphone', 'À préciser'] as const;
const ETAPES = ['À contacter', 'Contactées', 'À relancer', 'Ont répondu'] as const;

// Ajouter à la main une personne au Radar : contact, entreprise et affaire créés d'un geste.
export function AjoutRadar({
  slug,
  origines,
  onFerme,
  onAjoute,
}: {
  slug: string;
  origines: string[];
  onFerme: () => void;
  onAjoute: () => void;
}) {
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [entreprise, setEntreprise] = useState('');
  const [email, setEmail] = useState('');
  const [fonction, setFonction] = useState('');
  const [lien, setLien] = useState('');
  const [origine, setOrigine] = useState('');
  const [canal, setCanal] = useState<(typeof CANAUX)[number]>('LinkedIn');
  const [etape, setEtape] = useState<0 | 1 | 2 | 3>(0);
  const [note, setNote] = useState('');
  const [connu, setConnu] = useState<Contact | null>(null);
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const listeOrigines = useId();

  // Les contacts déjà connus sont proposés pendant la saisie : on évite ainsi les doublons.
  const recherche = (email.trim() || `${prenom} ${nom}`.trim()).slice(0, 100);
  useEffect(() => {
    if (connu || recherche.length < 3) {
      setSuggestions([]);
      return;
    }
    let actif = true;
    fetchContacts(slug, recherche).then(
      (r) => {
        if (actif) setSuggestions(r.slice(0, 4));
      },
      () => {
        if (actif) setSuggestions([]);
      },
    );
    return () => {
      actif = false;
    };
  }, [slug, recherche, connu]);

  const envoyer = async (event: FormEvent) => {
    event.preventDefault();
    if (!connu && !nom.trim()) {
      setErreur('Le nom est obligatoire.');
      return;
    }
    const brut: EntreeRadarInput = {
      prenom,
      nom: connu ? connu.nom : nom,
      entreprise,
      email,
      fonction,
      lienLinkedin: lien,
      origine,
      canal,
      etape,
      note,
      contactId: connu?.id,
    };
    // Un champ vide n'est pas envoyé : le serveur refuse une adresse ou un lien vides.
    const entree = Object.fromEntries(
      Object.entries(brut).filter(([, v]) => v !== '' && v !== undefined),
    ) as EntreeRadarInput;
    setEnvoi(true);
    setErreur('');
    try {
      await ajouterAuRadar(slug, entree);
      onAjoute();
      onFerme();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <form className="ra-ajout" aria-label="Ajouter au Radar" onSubmit={(e) => void envoyer(e)}>
      <strong>Ajouter au Radar</strong>
      {connu ? (
        <p className="ra-ajout-suggestions">
          Contact existant : {connu.nom}
          {connu.entreprise ? `, ${connu.entreprise}` : ''}
          <button type="button" className="btn ghost sm" onClick={() => setConnu(null)}>
            Retirer
          </button>
        </p>
      ) : (
        <div className="ra-ajout-grille">
          <label>
            Prénom
            <input className="input" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
          </label>
          <label>
            Nom
            <input className="input" value={nom} onChange={(e) => setNom(e.target.value)} />
          </label>
          <label>
            Entreprise
            <input
              className="input"
              value={entreprise}
              onChange={(e) => setEntreprise(e.target.value)}
            />
          </label>
          <label>
            Adresse mail
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Fonction
            <input
              className="input"
              value={fonction}
              onChange={(e) => setFonction(e.target.value)}
            />
          </label>
          <label>
            Lien LinkedIn
            <input
              className="input"
              type="url"
              value={lien}
              onChange={(e) => setLien(e.target.value)}
            />
          </label>
        </div>
      )}
      {!connu && suggestions.length > 0 && (
        <div className="ra-ajout-suggestions" aria-label="Contacts déjà connus">
          <span>Déjà dans l’OS :</span>
          {suggestions.map((c) => (
            <button type="button" key={c.id} className="btn sm" onClick={() => setConnu(c)}>
              {c.nom}
              {c.entreprise ? ` · ${c.entreprise}` : ''}
            </button>
          ))}
        </div>
      )}
      <div className="ra-ajout-grille">
        <label>
          Origine
          <input
            className="input"
            list={listeOrigines}
            value={origine}
            onChange={(e) => setOrigine(e.target.value)}
          />
          <datalist id={listeOrigines}>
            {origines.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </label>
        <label>
          Canal
          <select
            className="input"
            value={canal}
            onChange={(e) => setCanal(e.target.value as (typeof CANAUX)[number])}
          >
            {CANAUX.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Étape de départ
          <select
            className="input"
            value={etape}
            onChange={(e) => setEtape(Number(e.target.value) as 0 | 1 | 2 | 3)}
          >
            {ETAPES.map((nomEtape, i) => (
              <option key={nomEtape} value={i}>
                {nomEtape}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Note
        <textarea
          className="input"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {erreur && <p role="alert">{erreur}</p>}
      <div className="ra-ajout-actions">
        <button type="submit" className="btn primary" disabled={envoi}>
          Ajouter
        </button>
        <button type="button" className="btn ghost" onClick={onFerme}>
          Annuler
        </button>
      </div>
    </form>
  );
}
