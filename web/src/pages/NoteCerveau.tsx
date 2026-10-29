import { useEffect, useState } from 'react';
import { ApiError, operationCerveau, type EspaceCerveau } from '../api.js';

type Etat = 'chargement' | 'pret' | 'enregistrement';

// Éditeur d'une note du second cerveau : le texte est lu et écrit directement dans le dossier du Drive.
export function NoteCerveau({
  slug,
  espace = 'simatis',
  chemin,
  onFerme,
  onEnregistre,
  onRepondre,
}: {
  slug: string;
  espace?: EspaceCerveau;
  chemin: string;
  onFerme: () => void;
  onEnregistre: () => void;
  // Espace partagé : un message déposé ne se modifie plus, on y répond par un nouveau message.
  onRepondre?: (chemin: string) => void;
}) {
  const [etat, setEtat] = useState<Etat>('chargement');
  const [original, setOriginal] = useState('');
  const [texte, setTexte] = useState('');
  const [empreinte, setEmpreinte] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [conflit, setConflit] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [lectureSeule, setLectureSeule] = useState<string | null>(null);

  const charger = () => {
    setEtat('chargement');
    setErreur(null);
    setConflit(false);
    operationCerveau(slug, { espace, type: 'lire', chemin }).then(
      (r) => {
        setLectureSeule(r.lectureSeule ?? null);
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
  useEffect(charger, [slug, espace, chemin]);

  const modifiee = texte !== original;

  const enregistrer = () => {
    setEtat('enregistrement');
    setErreur(null);
    operationCerveau(slug, { espace, type: 'ecrire', chemin, contenu: texte, empreinte }).then(
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
          {enregistre && !modifiee
            ? espace === 'partage'
              ? 'Publié dans l’espace partagé.'
              : 'Enregistré dans le Drive.'
            : modifiee
              ? 'Modifiée.'
              : ''}
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
        {lectureSeule && <p className="cerveau-note">{lectureSeule}</p>}
        <textarea
          aria-label={`Texte de ${chemin}`}
          readOnly={!!lectureSeule}
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
          {!lectureSeule && (
            <button
              className="btn primary"
              onClick={enregistrer}
              disabled={etat !== 'pret' || !modifiee}
            >
              {etat === 'enregistrement' ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          )}
          {onRepondre && chemin.startsWith('echanges/') && (
            <button className="btn primary" onClick={() => onRepondre(chemin)}>
              Répondre à ce message
            </button>
          )}
          <button className="btn" onClick={fermer}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// Dépose une idée dans « Idées en vrac » du second cerveau (draft) ; l'Inbox la repère ensuite.
export function IdeeCerveau({
  slug,
  espace = 'simatis',
  onAjoutee,
}: {
  slug: string;
  espace?: EspaceCerveau;
  onAjoutee: (chemin: string) => void;
}) {
  const partage = espace === 'partage';
  const [ouvert, setOuvert] = useState(false);
  const [titre, setTitre] = useState('');
  const [texte, setTexte] = useState('');
  const [pourOs, setPourOs] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<string | null>(null);

  if (!ouvert)
    return (
      <div>
        <button className="btn" onClick={() => setOuvert(true)}>
          {partage ? '+ Nouveau document' : '+ Ajouter une idée'}
        </button>
        {fait && (
          <p className="cerveau-note">
            {partage ? 'Document publié' : 'Idée déposée dans les idées en vrac'} : {fait}
          </p>
        )}
      </div>
    );

  const envoyer = () => {
    setEnvoi(true);
    setErreur(null);
    operationCerveau(slug, {
      espace,
      type: 'ajouter',
      titre,
      texte,
      ...(!partage && pourOs ? { concerne: 'os' as const } : {}),
    }).then(
      (r) => {
        setFait(r.chemin ?? null);
        setTitre('');
        setTexte('');
        setPourOs(false);
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
        aria-label={partage ? 'Titre du document' : "Titre de l'idée"}
        placeholder={partage ? 'Titre du document' : "Titre de l'idée"}
        value={titre}
        onChange={(e) => setTitre(e.target.value)}
      />
      <textarea
        aria-label={partage ? 'Texte du document' : "Texte de l'idée"}
        placeholder={
          partage
            ? 'Le document est publié dans prospection/.'
            : "Décrivez l'idée, le contexte, la source…"
        }
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={5}
      />
      {!partage && (
        <label className="cerveau-note">
          <input type="checkbox" checked={pourOs} onChange={(e) => setPourOs(e.target.checked)} />{' '}
          Concerne le développement de l’OS
        </label>
      )}
      {erreur && <div className="empty">{erreur}</div>}
      <div className="cerveau-actions">
        <button className="btn primary" onClick={envoyer} disabled={envoi || !titre.trim()}>
          {envoi
            ? 'Dépôt…'
            : partage
              ? 'Publier dans prospection/'
              : 'Déposer dans les idées en vrac'}
        </button>
        <button className="btn" onClick={() => setOuvert(false)}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// Message à l'autre côté de l'espace partagé (Christophe). Un message déposé ne se modifie plus et
// est lu par l'autre : le bouton est l'accord de Marc, précédé d'une confirmation.
export function MessagePartage({
  slug,
  enReponseA,
  onDepose,
  onFerme,
}: {
  slug: string;
  enReponseA?: string | undefined;
  onDepose: (chemin: string | undefined) => void;
  onFerme: () => void;
}) {
  const [genre, setGenre] = useState<'question' | 'reponse' | 'info'>(
    enReponseA ? 'reponse' : 'question',
  );
  const [sujet, setSujet] = useState('');
  const [corps, setCorps] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const envoyer = () => {
    if (
      !window.confirm(
        'Déposer ce message ? Il sera lu par Christophe et ne pourra plus être modifié.',
      )
    )
      return;
    setEnvoi(true);
    setErreur(null);
    operationCerveau(slug, {
      espace: 'partage',
      type: 'message',
      genre,
      sujet,
      corps,
      ...(enReponseA ? { enReponseA } : {}),
    }).then(
      (r) => onDepose(r.chemin),
      (e: unknown) => {
        setErreur(e instanceof Error ? e.message : String(e));
        setEnvoi(false);
      },
    );
  };

  return (
    <div className="panel">
      <div className="panel-b cerveau-idee">
        <b>{enReponseA ? 'Répondre' : 'Nouveau message'}</b>
        {enReponseA && <span className="cerveau-note">En réponse à {enReponseA}</span>}
        <select
          aria-label="Type de message"
          value={genre}
          onChange={(e) => setGenre(e.target.value as typeof genre)}
        >
          <option value="question">Question (attend une réponse)</option>
          <option value="reponse" disabled={!enReponseA}>
            Réponse
          </option>
          <option value="info">Information (n’attend rien)</option>
        </select>
        <input
          aria-label="Sujet du message"
          placeholder="Sujet, une ligne"
          value={sujet}
          onChange={(e) => setSujet(e.target.value)}
        />
        <textarea
          aria-label="Corps du message"
          placeholder="Le message doit se comprendre seul : contexte, faits, ce qui est attendu et pour quand."
          value={corps}
          onChange={(e) => setCorps(e.target.value)}
          rows={6}
        />
        <p className="cerveau-note">
          Ne mettez rien d’un autre client ni de confidentiel : l’espace est partagé avec
          Christophe.
        </p>
        {erreur && <div className="empty">{erreur}</div>}
        <div className="cerveau-actions">
          <button
            className="btn primary"
            onClick={envoyer}
            disabled={envoi || !sujet.trim() || !corps.trim()}
          >
            {envoi ? 'Dépôt…' : 'Déposer le message'}
          </button>
          <button className="btn" onClick={onFerme}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
