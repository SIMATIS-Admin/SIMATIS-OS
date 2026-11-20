import { useEffect, useMemo, useState } from 'react';
import {
  createTache,
  decider,
  envoyerMailRelanceProspection,
  fetchMailsFiche,
  fetchProspection,
  updateTache,
  type Evenement,
  type KindFiche,
  type PropositionItem,
  type SignatureProspection,
} from '../api.js';
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
  const objetPrepare = typeof prepare?.contenu.objet === 'string' ? prepare.contenu.objet : '';
  const textePrepare = useMemo(
    () => (typeof prepare?.contenu.corps === 'string' ? htmlEnTexte(prepare.contenu.corps) : ''),
    [prepare],
  );
  // Le texte de la routine, quand il existe, est le point de départ : Marc peut le reprendre.
  const [objet, setObjet] = useState(prepare ? objetPrepare : brouillon.objet);
  const [corps, setCorps] = useState(prepare ? textePrepare : brouillon.corps);
  const [resultat, setResultat] = useState('joint');
  const [suites, setSuites] = useState<ReturnType<typeof suitesProposees> | null>(null);
  const [choix, setChoix] = useState(0);
  const [message, setMessage] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [cree, setCree] = useState(false);
  const [signatures, setSignatures] = useState<SignatureProspection[]>([]);
  const [signatureId, setSignatureId] = useState('');
  const [historique, setHistorique] = useState<Evenement[] | 'chargement' | 'indisponible'>(
    'chargement',
  );

  // Les signatures sont celles des campagnes ; la signature par défaut est déjà choisie.
  useEffect(() => {
    if (!mail) return;
    let actif = true;
    void (async () => {
      try {
        const v = await fetchProspection(espace);
        if (!actif) return;
        setSignatures(v.signatures);
        setSignatureId(v.signatures.find((x) => x.defaut)?.id ?? '');
      } catch {
        // Sans signature disponible, le mail part sans : le choix « Sans signature » reste valable.
      }
    })();
    return () => {
      actif = false;
    };
  }, [espace, mail]);

  // L'historique des échanges est lu dans la messagerie, à part : il peut prendre quelques secondes.
  const cible: { kind: KindFiche; id: string } | null = action.contactId
    ? { kind: 'contact', id: action.contactId }
    : action.opportuniteId
      ? { kind: 'affaire', id: action.opportuniteId }
      : action.entrepriseId
        ? { kind: 'entreprise', id: action.entrepriseId }
        : null;
  const ficheCle = cible ? `${cible.kind}:${cible.id}` : '';
  useEffect(() => {
    if (!cible) {
      setHistorique([]);
      return;
    }
    let actif = true;
    setHistorique('chargement');
    void (async () => {
      try {
        const r = await fetchMailsFiche(espace, cible.kind, cible.id);
        if (actif) setHistorique(r.mails);
      } catch {
        if (actif) setHistorique('indisponible');
      }
    })();
    return () => {
      actif = false;
    };
  }, [espace, ficheCle]);
  const mails = Array.isArray(historique)
    ? historique
        .filter((m) => m.type === 'email' && m.mail)
        .sort((a, b) => b.at.localeCompare(a.at))
    : [];
  const dernierEnvoye = mails.find((m) => m.mail?.sens === 'envoye');
  const derniereReponse = mails.find(
    (m) => m.mail?.sens === 'recu' && (!dernierEnvoye || m.at > dernierEnvoye.at),
  );
  const fil = (dernierEnvoye ?? derniereReponse ?? mails[0])?.mail?.fil;

  const objetFinal = objet;
  const corpsFinal = corps;

  // Un mail d'une action : brouillon ou envoi direct, avec la signature choisie. Le brouillon préparé
  // par la routine est écarté une fois le mail parti ou déposé, pour ne pas rester en double dans l'Inbox.
  const ecrireMail = async (mode: 'brouillon' | 'envoi') => {
    if (!action.email) return;
    setEnCours(true);
    setMessage('');
    try {
      const r = await envoyerMailRelanceProspection(espace, {
        to: action.email,
        objet,
        corps,
        signatureId: signatureId || null,
        mode,
        ...(fil ? { threadId: fil } : {}),
      });
      if (r.simulation) {
        setMessage(
          mode === 'envoi'
            ? 'Envoi simulé : les écritures réelles sont fermées, rien n’est parti. L’action reste à faire.'
            : 'Brouillon simulé : l’écriture réelle dans la messagerie est fermée.',
        );
        setEnCours(false);
        return;
      }
      if (prepare) await decider(espace, prepare.id, 'ecarter').catch(() => undefined);
      if (mode === 'brouillon') {
        setCree(true);
        setMessage('Brouillon créé dans votre messagerie : relisez-le et envoyez-le.');
        setEnCours(false);
        return;
      }
      // Envoyé : l'action est faite, la première suite proposée est planifiée et on passe à la suivante.
      await cloturer(suitesProposees('mail')[0]);
    } catch {
      setMessage(
        mode === 'envoi'
          ? 'L’envoi a échoué : rien n’a été clôturé. Réessayez.'
          : 'La création du brouillon a échoué. Réessayez.',
      );
      setEnCours(false);
    }
  };

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(`${objetFinal}\n\n${corpsFinal}`);
      setMessage('Mail copié : collez-le dans votre messagerie.');
    } catch {
      setMessage('Copie impossible : sélectionnez le texte à la main.');
    }
  };

  // L'action est faite : tâches closes, suite planifiée dans l'OS (jamais dans le CRM).
  const cloturer = async (suite: ReturnType<typeof suitesProposees>[number] | undefined) => {
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
          hubspot: false,
        });
      onFait(suite.jours);
    } catch {
      setMessage("L'enregistrement a échoué. Réessayez.");
      setEnCours(false);
    }
  };
  const valider = () => cloturer(suites?.[choix]);

  // Le brouillon de la routine peut arriver après l'ouverture : il remplace alors le texte de départ.
  useEffect(() => {
    if (!prepare) return;
    setObjet(objetPrepare);
    setCorps(textePrepare);
  }, [prepare?.id]);

  const traitees = sequence ? sequence.n - 1 : 0;

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
            {mail && !action.email && (
              <p className="muted small" role="note">
                {action.contactId
                  ? "Aucune adresse mail pour ce contact : ajoutez-la sur sa fiche pour pouvoir envoyer d'ici."
                  : "Cette action n'est liée à aucun contact : rattachez-la à un contact pour pouvoir envoyer d'ici."}
              </p>
            )}
            {mail ? (
              <div className="aide-pied-ligne aide-envoi">
                <button className="btn" type="button" onClick={() => void copier()}>
                  Copier le mail
                </button>
                {action.email && (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void ecrireMail('brouillon')}
                    disabled={enCours || cree}
                  >
                    Créer le brouillon Gmail
                  </button>
                )}
                {action.email && (
                  <a
                    className="btn"
                    href={`mailto:${action.email}?subject=${encodeURIComponent(objetFinal)}&body=${encodeURIComponent(corpsFinal)}`}
                  >
                    Ouvrir dans ma messagerie
                  </a>
                )}
                {action.email && (
                  <span className="aide-envoyer">
                    <select
                      aria-label="Signature"
                      value={signatureId}
                      onChange={(e) => setSignatureId(e.target.value)}
                    >
                      <option value="">Sans signature</option>
                      {signatures.map((x) => (
                        <option key={x.id} value={x.id}>
                          Signature : {x.nom}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => void ecrireMail('envoi')}
                      disabled={enCours}
                      title={`Envoie ce mail à ${action.email}${signatureId ? ' avec la signature choisie' : ''}, clôt l'action et passe à la suivante.`}
                    >
                      <svg
                        className="aide-avion"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        aria-hidden="true"
                      >
                        <path
                          d="M21.5 3.5 2.8 10.7c-.7.3-.7 1.3 0 1.5l5.3 1.9 2 5.3c.3.7 1.2.7 1.5 0L21.5 3.5Z M8.1 14.1 21.5 3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      </svg>
                      Envoyer le mail
                    </button>
                  </span>
                )}
              </div>
            ) : (
              <div className="aide-pied-ligne">
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => setSuites(suitesProposees(action.canal, resultat))}
                >
                  Appel passé
                </button>
              </div>
            )}
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
              {mail && (
                <button
                  className="btn sm aide-deja"
                  type="button"
                  disabled={enCours}
                  onClick={() => void cloturer(suitesProposees('mail')[0])}
                  title="Vous l'avez déjà envoyé vous-même : l'action est clôturée et on passe à la suivante."
                >
                  Mail envoyé
                </button>
              )}
              {sequence && (
                <button className="btn sm ghost" type="button" onClick={sequence.onPasser}>
                  Passer
                </button>
              )}
              <button
                className="btn sm ghost danger"
                type="button"
                onClick={() => onMasquer(0, true)}
                title="Retire cette action de la liste pour toujours. La tâche et le CRM ne sont pas modifiés."
              >
                Pas pertinent
              </button>
            </div>
          </div>
        )
      }
    >
      {sequence && (
        <div
          className="aide-jauge"
          role="progressbar"
          aria-label="Avancement de la séquence"
          aria-valuemin={0}
          aria-valuemax={sequence.total}
          aria-valuenow={traitees}
        >
          <span className="aide-jauge-barre">
            <span style={{ width: `${(traitees / sequence.total) * 100}%` }} />
          </span>
          <span className="aide-jauge-texte">
            {traitees} traitée(s) sur {sequence.total}
          </span>
        </div>
      )}
      <div className="aide-blocs">
        <section className="aide-note" aria-label="L'action">
          <b>L'action</b>
          <p className="aide-sous-titre">Pourquoi elle est proposée</p>
          <ul>
            {action.raisons.map((r, i) => (
              <li key={i}>{r.texte}</li>
            ))}
          </ul>
          {action.derniereActivite && (
            <p>
              Dernière activité : {new Date(action.derniereActivite).toLocaleDateString('fr-FR')}
            </p>
          )}
        </section>
        <section className="aide-note aide-histo" aria-label="Situation et historique">
          <b>Situation et historique</b>
          {historique === 'chargement' ? (
            <p className="muted small">Lecture de la messagerie…</p>
          ) : historique === 'indisponible' ? (
            <p className="muted small">Historique indisponible pour le moment.</p>
          ) : mails.length === 0 ? (
            <p className="muted small">Aucun mail échangé avec ce contact.</p>
          ) : (
            <>
              <p className="muted small">
                {mails.length} mail(s) échangé(s)
                {derniereReponse ? ' · le contact a répondu depuis votre dernier mail' : ''}
              </p>
              {[derniereReponse, dernierEnvoye]
                .filter((m): m is Evenement => !!m)
                .map((m) => (
                  <details key={m.id} className="aide-mail" open={m === derniereReponse}>
                    <summary>
                      <span className={`badge ${m.mail?.sens === 'recu' ? 'green' : 'blue'}`}>
                        {m.mail?.sens === 'recu' ? 'Réponse reçue' : 'Votre dernier mail'}
                      </span>{' '}
                      {new Date(m.at).toLocaleDateString('fr-FR')} · {m.mail?.objet}
                    </summary>
                    <pre>
                      {(m.mail?.corps ?? m.texte ?? '').slice(0, 1500) || '(contenu indisponible)'}
                    </pre>
                  </details>
                ))}
            </>
          )}
        </section>
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
      ) : mail ? (
        <>
          {action.email && (
            <p className="aide-dest muted small">
              À : <b>{action.email}</b>
            </p>
          )}
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
              {prepare
                ? 'Mail préparé par la routine (modifiable, signature au choix à l’envoi)'
                : 'Mail préparé (modifiable, signature au choix à l’envoi)'}
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
