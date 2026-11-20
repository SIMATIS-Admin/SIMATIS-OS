import { useMemo, useState } from 'react';
import { createTache, decider, updateTache, type PropositionItem } from '../api.js';
import {
  ficheAppel,
  htmlEnTexte,
  redigerMail,
  suitesProposees,
  type ActionRelance,
} from '../aideRelance.js';
import { Fenetre } from './Fenetre.js';

export const dansJours = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d;
};

// L'action ouverte : le mail préparé ou la fiche d'appel, avec ce qu'on peut en faire. Seul, c'est
// un tiroir ; dans la séquence, c'est une fenêtre qui avance d'une action à la suivante.
export type EtapeSequence = { n: number; total: number; onPasser: () => void };

export function VoletAction({
  slug,
  action,
  prepare,
  sequence,
  onFermer,
  onMasquer,
  onFait,
}: {
  slug: string;
  action: ActionRelance;
  // Brouillon déjà rédigé par la routine (créneaux libres compris), en attente de validation.
  prepare: PropositionItem | null;
  sequence?: EtapeSequence;
  onFermer: () => void;
  onMasquer: (jours: number, pourToujours: boolean) => void;
  onFait: (jours: number) => void;
}) {
  // Une action d'un autre mandat s'écrit dans ce mandat, jamais dans l'espace affiché.
  const espace = action.instance?.slug ?? slug;
  const mail = action.canal === 'mail';
  const brouillon = useMemo(() => redigerMail(action), [action]);
  const fiche = useMemo(() => ficheAppel(action), [action]);
  const [objet, setObjet] = useState(brouillon.objet);
  const [corps, setCorps] = useState(brouillon.corps);
  const [resultat, setResultat] = useState('joint');
  const [suites, setSuites] = useState<ReturnType<typeof suitesProposees> | null>(null);
  const [choix, setChoix] = useState(0);
  const [message, setMessage] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [cree, setCree] = useState(false);
  const objetPrepare = typeof prepare?.contenu.objet === 'string' ? prepare.contenu.objet : '';
  const textePrepare = useMemo(
    () => (typeof prepare?.contenu.corps === 'string' ? htmlEnTexte(prepare.contenu.corps) : ''),
    [prepare],
  );

  // Texte offert à la copie et à la messagerie : celui de la routine quand il existe.
  const objetFinal = prepare ? objetPrepare : objet;
  const corpsFinal = prepare ? textePrepare : corps;

  // Valider le brouillon préparé le dépose dans la boîte mail (ou le simule tant que l'écriture
  // réelle est fermée) : il n'est jamais envoyé, Marc le relit et l'envoie lui-même.
  const creerBrouillon = async () => {
    if (!prepare) return;
    setEnCours(true);
    try {
      const r = await decider(espace, prepare.id, 'valider');
      const simule = (r.resultat as { simulation?: boolean } | null)?.simulation;
      if (r.statut === 'echec') setMessage("La création du brouillon a échoué : voir l'Inbox.");
      else {
        setCree(true);
        setMessage(
          simule
            ? 'Brouillon simulé : l’écriture réelle dans la messagerie est fermée.'
            : 'Brouillon créé dans votre messagerie : relisez-le et envoyez-le.',
        );
      }
    } catch {
      setMessage('La création du brouillon a échoué. Réessayez.');
    }
    setEnCours(false);
  };

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(`${objetFinal}\n\n${corpsFinal}`);
      setMessage('Mail copié : collez-le dans votre messagerie.');
    } catch {
      setMessage('Copie impossible : sélectionnez le texte à la main.');
    }
  };

  const valider = async () => {
    const suite = suites?.[choix];
    if (!suite) return;
    setEnCours(true);
    try {
      for (const id of action.tacheIds) await updateTache(espace, id, { fait: true });
      if (suite.canal)
        await createTache(espace, {
          titre: `${suite.canal === 'appel' ? 'Rappeler' : 'Relancer par mail'} ${action.entreprise}`,
          type: suite.canal,
          echeance: dansJours(suite.jours).toISOString(),
          contactId: action.contactId,
          entrepriseId: action.entrepriseId,
          opportuniteId: action.opportuniteId,
          // Écriture dans l'OS seulement : le CRM n'est jamais modifié depuis cet écran.
          hubspot: false,
        });
      onFait(suite.jours);
    } catch {
      setMessage("L'enregistrement a échoué. Réessayez.");
      setEnCours(false);
    }
  };

  return (
    <Fenetre
      titre={action.entreprise}
      sousTitre={[
        sequence ? `Action ${sequence.n} sur ${sequence.total}` : null,
        action.instance?.nom,
        action.contact,
        action.etape,
      ]
        .filter(Boolean)
        .join(' · ')}
      tiroir={!sequence}
      large={!!sequence}
      onFermer={onFermer}
      pied={
        suites ? (
          <button
            className="btn primary"
            type="button"
            onClick={() => void valider()}
            disabled={enCours}
          >
            {sequence ? 'Valider et passer à la suivante' : 'Valider et continuer'}
          </button>
        ) : (
          <div className="aide-pied">
            <div className="aide-pied-ligne">
              {mail && prepare && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => void creerBrouillon()}
                  disabled={enCours || cree}
                >
                  Créer le brouillon Gmail
                </button>
              )}
              {mail && (
                <>
                  <button className="btn" type="button" onClick={() => void copier()}>
                    {prepare ? 'Copier le texte préparé' : 'Copier le mail'}
                  </button>
                  {action.email && (
                    <a
                      className="btn"
                      href={`mailto:${action.email}?subject=${encodeURIComponent(objetFinal)}&body=${encodeURIComponent(corpsFinal)}`}
                    >
                      Ouvrir dans ma messagerie
                    </a>
                  )}
                </>
              )}
              <button
                className="btn primary"
                type="button"
                onClick={() =>
                  setSuites(suitesProposees(action.canal, mail ? undefined : resultat))
                }
              >
                {mail ? 'Mail envoyé' : 'Appel passé'}
              </button>
            </div>
            <div className="aide-pied-ligne">
              <span className="muted small">Reporter :</span>
              <button className="btn sm ghost" type="button" onClick={() => onMasquer(1, false)}>
                Demain
              </button>
              <button className="btn sm ghost" type="button" onClick={() => onMasquer(3, false)}>
                +3 jours
              </button>
              <button className="btn sm ghost" type="button" onClick={() => onMasquer(7, false)}>
                +7 jours
              </button>
              {sequence && (
                <button
                  className="btn sm ghost"
                  type="button"
                  onClick={sequence.onPasser}
                  style={{ marginLeft: 'auto' }}
                >
                  Passer
                </button>
              )}
              <button
                className="btn sm ghost danger"
                type="button"
                style={sequence ? undefined : { marginLeft: 'auto' }}
                onClick={() => onMasquer(0, true)}
              >
                Pas pertinent
              </button>
            </div>
          </div>
        )
      }
    >
      <div className="aide-note">
        <b>Pourquoi cette action</b>
        <ul>
          {action.raisons.map((r, i) => (
            <li key={i}>{r.texte}</li>
          ))}
        </ul>
        {action.derniereActivite && (
          <p>Dernière activité : {new Date(action.derniereActivite).toLocaleDateString('fr-FR')}</p>
        )}
      </div>
      {suites ? (
        <div className="aide-suite" role="radiogroup" aria-label="Suite proposée">
          <p>
            <b>Fait.</b> Que faut-il planifier ensuite ?
          </p>
          {suites.map((s, i) => (
            <label key={s.libelle}>
              <input type="radio" name="suite" checked={choix === i} onChange={() => setChoix(i)} />
              <span>{s.libelle}</span>
            </label>
          ))}
        </div>
      ) : mail && prepare ? (
        <>
          <p className="aide-prepare">
            Brouillon rédigé par la routine, avec vos créneaux libres. Il n'est envoyé que si vous
            l'envoyez vous-même depuis votre messagerie.
          </p>
          <div className="aide-champ">
            <label htmlFor="aide-objet-prepare">Objet</label>
            <input id="aide-objet-prepare" type="text" value={objetPrepare} readOnly />
          </div>
          <div className="aide-champ">
            <label htmlFor="aide-corps-prepare">Mail préparé (à modifier dans l'Inbox)</label>
            <textarea id="aide-corps-prepare" value={textePrepare} readOnly />
          </div>
        </>
      ) : mail ? (
        <>
          <div className="aide-champ">
            <label htmlFor="aide-objet">Objet</label>
            <input
              id="aide-objet"
              type="text"
              value={objet}
              onChange={(e) => setObjet(e.target.value)}
            />
          </div>
          <div className="aide-champ">
            <label htmlFor="aide-corps">
              Mail préparé (modifiable, signature ajoutée par la messagerie)
            </label>
            <textarea id="aide-corps" value={corps} onChange={(e) => setCorps(e.target.value)} />
          </div>
        </>
      ) : (
        <>
          <dl className="aide-fiche">
            <dt>Objectif de l'appel</dt>
            <dd>{fiche.objectif}</dd>
            <dt>Pour ouvrir</dt>
            <dd>« {fiche.ouverture} »</dd>
            <dt>Deux questions</dt>
            <dd>
              <ul>
                {fiche.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </dd>
            {action.telephone && (
              <>
                <dt>Téléphone</dt>
                <dd>
                  <a href={`tel:${action.telephone}`}>{action.telephone}</a>
                </dd>
              </>
            )}
          </dl>
          <div className="aide-champ">
            <label htmlFor="aide-resultat">Résultat de l'appel</label>
            <select
              id="aide-resultat"
              value={resultat}
              onChange={(e) => setResultat(e.target.value)}
            >
              <option value="joint">Joint, échange fait</option>
              <option value="absent">Pas de réponse</option>
              <option value="message">Message laissé</option>
            </select>
          </div>
        </>
      )}
      {message && (
        <p className="muted small" role="status">
          {message}
        </p>
      )}
    </Fenetre>
  );
}
