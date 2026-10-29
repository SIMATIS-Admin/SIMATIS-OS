import { useEffect, useState } from 'react';
import { ApiError, operationCerveau } from '../api.js';

type Etat = 'chargement' | 'pret' | 'enregistrement';

// Éditeur d'une note du second cerveau : le texte est lu et écrit directement dans le dossier du Drive.
export function NoteCerveau({
  slug,
  chemin,
  onFerme,
  onEnregistre,
}: {
  slug: string;
  chemin: string;
  onFerme: () => void;
  onEnregistre: () => void;
}) {
  const [etat, setEtat] = useState<Etat>('chargement');
  const [original, setOriginal] = useState('');
  const [texte, setTexte] = useState('');
  const [empreinte, setEmpreinte] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [conflit, setConflit] = useState(false);
  const [enregistre, setEnregistre] = useState(false);

  const charger = () => {
    setEtat('chargement');
    setErreur(null);
    setConflit(false);
    operationCerveau(slug, { type: 'lire', chemin }).then(
      (r) => {
        setOriginal(r.contenu ?? '');
        setTexte(r.contenu ?? '');
        setEmpreinte(r.empreinte ?? '');
        setEtat('pret');
      },
      (e: unknown) => {
        setErreur(e instanceof Error ? e.message : String(e));
        setEtat('pret');
      },
    );
  };
  useEffect(charger, [slug, chemin]);

  const modifiee = texte !== original;

  const enregistrer = () => {
    setEtat('enregistrement');
    setErreur(null);
    operationCerveau(slug, { type: 'ecrire', chemin, contenu: texte, empreinte }).then(
      (r) => {
        setOriginal(texte);
        setEmpreinte(r.empreinte ?? empreinte);
        setEnregistre(true);
        setEtat('pret');
        onEnregistre();
      },
      (e: unknown) => {
        setConflit(e instanceof ApiError && e.status === 409);
        setErreur(e instanceof Error ? e.message : String(e));
        setEtat('pret');
      },
    );
  };

  const fermer = () => {
    if (!modifiee || window.confirm('Fermer sans enregistrer vos modifications ?')) onFerme();
  };

  return (
    <div className="panel cerveau-editeur">
      <div className="panel-h">
        <b>{chemin}</b>
        <span className="cerveau-note">
          {enregistre && !modifiee ? 'Enregistré dans le Drive.' : modifiee ? 'Modifiée.' : ''}
        </span>
      </div>
      <div className="panel-b">
        {erreur && (
          <div className="empty" role="alert">
            {erreur}{' '}
            {conflit && (
              <button className="btn" onClick={charger}>
                Recharger la note
              </button>
            )}
          </div>
        )}
        <textarea
          aria-label={`Texte de ${chemin}`}
          value={etat === 'chargement' ? 'Chargement…' : texte}
          disabled={etat !== 'pret' || (!!erreur && !original && !modifiee)}
          onChange={(e) => {
            setTexte(e.target.value);
            setEnregistre(false);
          }}
          spellCheck
          rows={22}
        />
        <div className="cerveau-actions">
          <button
            className="btn primary"
            onClick={enregistrer}
            disabled={etat !== 'pret' || !modifiee}
          >
            {etat === 'enregistrement' ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button className="btn" onClick={fermer}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// Dépose une idée dans l'inbox du second cerveau (draft), à trier ensuite avec la skill « mémoriser ».
export function IdeeCerveau({
  slug,
  onAjoutee,
}: {
  slug: string;
  onAjoutee: (chemin: string) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [titre, setTitre] = useState('');
  const [texte, setTexte] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<string | null>(null);

  if (!ouvert)
    return (
      <div>
        <button className="btn" onClick={() => setOuvert(true)}>
          + Ajouter une idée
        </button>
        {fait && <p className="cerveau-note">Idée déposée dans l’inbox : {fait}</p>}
      </div>
    );

  const envoyer = () => {
    setEnvoi(true);
    setErreur(null);
    operationCerveau(slug, { type: 'ajouter', titre, texte }).then(
      (r) => {
        setFait(r.chemin ?? null);
        setTitre('');
        setTexte('');
        setEnvoi(false);
        setOuvert(false);
        if (r.chemin) onAjoutee(r.chemin);
      },
      (e: unknown) => {
        setErreur(e instanceof Error ? e.message : String(e));
        setEnvoi(false);
      },
    );
  };

  return (
    <div className="cerveau-idee">
      <input
        aria-label="Titre de l'idée"
        placeholder="Titre de l'idée"
        value={titre}
        onChange={(e) => setTitre(e.target.value)}
      />
      <textarea
        aria-label="Texte de l'idée"
        placeholder="Décrivez l'idée, le contexte, la source…"
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={5}
      />
      {erreur && <div className="empty">{erreur}</div>}
      <div className="cerveau-actions">
        <button className="btn primary" onClick={envoyer} disabled={envoi || !titre.trim()}>
          {envoi ? 'Dépôt…' : 'Déposer dans l’inbox'}
        </button>
        <button className="btn" onClick={() => setOuvert(false)}>
          Annuler
        </button>
      </div>
    </div>
  );
}
