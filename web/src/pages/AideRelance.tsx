import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createTache,
  decider,
  fetchBrouillonsPrepares,
  fetchMasqueesRelance,
  fetchPipeline,
  fetchTaches,
  masquerRelance,
  updateTache,
  type Pipeline,
  type PropositionItem,
  type TacheVue,
} from '../api.js';
import {
  brouillonPour,
  construireFile,
  ficheAppel,
  htmlEnTexte,
  POUR_TOUJOURS,
  redigerMail,
  suitesProposees,
  type ActionRelance,
  type Masquees,
  type SourceAction,
} from '../aideRelance.js';
import { Fenetre } from './Fenetre.js';

const CHOIX = [5, 10, 15, 'tout'] as const;
type Nombre = (typeof CHOIX)[number];
const SOURCES: Record<SourceAction, { libelle: string; classe: string }> = {
  retard: { libelle: 'En retard', classe: 'red' },
  dormante: { libelle: 'Sans activité', classe: 'amber' },
  radar: { libelle: 'Radar', classe: 'green' },
};

// Le stockage du navigateur peut manquer (fenêtre privée) : on retombe sur la valeur par défaut.
function lire<T>(cle: string, defaut: T): T {
  try {
    const v = localStorage.getItem(cle);
    return v ? (JSON.parse(v) as T) : defaut;
  } catch {
    return defaut;
  }
}
function ecrire(cle: string, valeur: unknown) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch {
    // Sans conséquence : le choix ne sera simplement pas retenu.
  }
}

const jourIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dansJours = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d;
};

// Le bloc « À faire maintenant » du Cockpit : les actions commerciales à réaliser vite, tirées du
// Radar, des tâches en retard et des affaires sans activité. L'OS prépare, Marc relit et envoie.
export function AideRelance({ slug }: { slug: string }) {
  const [donnees, setDonnees] = useState<{ pipeline: Pipeline; enRetard: TacheVue[] } | null>(null);
  const [erreur, setErreur] = useState(false);
  const [nb, setNb] = useState<Nombre>(() => {
    const v = lire<Nombre>('aideRelance:nb', 10);
    return CHOIX.includes(v) ? v : 10;
  });
  const [filtre, setFiltre] = useState<'tout' | SourceAction>('tout');
  const [masquees, setMasquees] = useState<Masquees>({});
  const [brouillons, setBrouillons] = useState<PropositionItem[]>([]);
  const [faites, setFaites] = useState(0);
  const [ouverte, setOuverte] = useState<ActionRelance | null>(null);

  const charger = useCallback(() => {
    const jour = jourIso(new Date());
    // Les reports et les brouillons préparés enrichissent la file : leur absence ne la bloque pas.
    Promise.all([
      fetchPipeline(slug),
      fetchTaches(slug, jour, jour),
      fetchMasqueesRelance(slug).catch(() => ({})),
      fetchBrouillonsPrepares(slug).catch(() => []),
    ]).then(
      ([pipeline, semaine, reports, prepares]) => {
        setDonnees({ pipeline, enRetard: semaine.enRetard });
        // Les reports faits pendant la lecture priment : le serveur peut ne pas les avoir encore.
        setMasquees((deja) => ({ ...reports, ...deja }));
        setBrouillons(prepares);
        setErreur(false);
      },
      () => setErreur(true),
    );
  }, [slug]);
  useEffect(charger, [charger]);

  const masquer = (id: string, jusqua: number) => {
    const suivantes = { ...masquees, [id]: jusqua };
    setMasquees(suivantes);
    // Retenu côté serveur ; en cas d'échec on relit l'état réel plutôt que de mentir à l'écran.
    masquerRelance(slug, id, jusqua).catch(charger);
  };
  const choisir = (n: Nombre) => {
    setNb(n);
    ecrire('aideRelance:nb', n);
  };

  const file = useMemo(
    () =>
      donnees
        ? construireFile({ pipeline: donnees.pipeline, enRetard: donnees.enRetard, masquees })
        : [],
    [donnees, masquees],
  );
  const filtrees = file.filter(
    (a) => filtre === 'tout' || a.raisons.some((r) => r.source === filtre),
  );
  const visibles = nb === 'tout' ? filtrees : filtrees.slice(0, nb);
  const attente = filtrees.length - visibles.length;
  const compte = (s: SourceAction) =>
    file.filter((a) => a.raisons.some((r) => r.source === s)).length;

  return (
    <section className="panel aide-relance" aria-label="À faire maintenant">
      <div className="panel-b">
        <div className="aide-tete">
          <div>
            <h2>À faire maintenant</h2>
            <span className="muted small">
              {donnees ? `${file.length} action(s) possible(s) au total` : 'Chargement en cours'}
            </span>
          </div>
          <div className="aide-choix" role="group" aria-label="Nombre d'actions">
            <span className="muted small">Je peux en faire :</span>
            {CHOIX.map((n) => (
              <button
                key={n}
                type="button"
                className={`chip ${nb === n ? 'on' : ''}`}
                aria-pressed={nb === n}
                onClick={() => choisir(n)}
              >
                {n === 'tout' ? 'Tout' : n}
              </button>
            ))}
          </div>
        </div>
        <div className="aide-sous">
          <div className="aide-filtres" role="group" aria-label="Source">
            <button
              type="button"
              className={`chip ${filtre === 'tout' ? 'on' : ''}`}
              aria-pressed={filtre === 'tout'}
              onClick={() => setFiltre('tout')}
            >
              Toutes les sources ({file.length})
            </button>
            {(Object.keys(SOURCES) as SourceAction[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip ${filtre === s ? 'on' : ''}`}
                aria-pressed={filtre === s}
                onClick={() => setFiltre(s)}
              >
                {SOURCES[s].libelle} ({compte(s)})
              </button>
            ))}
          </div>
          <span className="muted small">{faites} faite(s) aujourd'hui</span>
        </div>
      </div>
      <div className="aide-liste">
        {erreur ? (
          <p className="aide-vide">Impossible de charger les actions pour le moment.</p>
        ) : !donnees ? null : visibles.length === 0 ? (
          <p className="aide-vide">
            <b>Rien d'autre à proposer pour l'instant.</b>
            <br />
            {file.length === 0 ? 'La liste est vide.' : 'Aucune action pour cette source.'}
          </p>
        ) : (
          <>
            {visibles.map((a, i) => (
              <button type="button" key={a.id} className="aide-ligne" onClick={() => setOuverte(a)}>
                <span className="aide-rang">{i + 1}</span>
                <span className={`badge ${a.canal === 'mail' ? 'blue' : 'amber'}`}>
                  {a.canal === 'mail' ? 'Mail' : 'Appel'}
                </span>
                <span className="aide-corps">
                  <span className="aide-nom">
                    {a.entreprise}
                    {a.contact && <small>{a.contact}</small>}
                  </span>
                  <span className="aide-raisons">
                    {a.raisons.map((r, k) => (
                      <span key={k} className={`badge ${SOURCES[r.source].classe}`}>
                        {SOURCES[r.source].libelle}
                        {r.jours ? ` · ${r.jours} j` : ''}
                      </span>
                    ))}
                    <span>{a.raisons.map((r) => r.texte).join(' · ')}</span>
                  </span>
                </span>
                <span className="aide-meta">
                  {a.etape && <b>{a.etape}</b>}
                  {a.montant ? (
                    <span className="num">
                      {new Intl.NumberFormat('fr-FR', {
                        style: 'currency',
                        currency: 'EUR',
                        maximumFractionDigits: 0,
                      }).format(a.montant)}
                    </span>
                  ) : null}
                </span>
                <span className="btn sm primary">Ouvrir</span>
              </button>
            ))}
            {attente > 0 && (
              <p className="aide-reste">
                + {attente} autre(s) en attente. Augmentez le nombre ci-dessus quand vous avez plus
                de temps.
              </p>
            )}
          </>
        )}
      </div>
      {ouverte && (
        <VoletAction
          slug={slug}
          action={ouverte}
          prepare={brouillonPour(ouverte, brouillons)}
          onFermer={() => setOuverte(null)}
          onMasquer={(jours, pourToujours) => {
            masquer(ouverte.id, pourToujours ? POUR_TOUJOURS : dansJours(jours).getTime());
            setOuverte(null);
          }}
          onFait={(jours) => {
            masquer(ouverte.id, dansJours(Math.max(jours, 7)).getTime());
            setFaites((n) => n + 1);
            setOuverte(null);
            charger();
          }}
        />
      )}
    </section>
  );
}

function VoletAction({
  slug,
  action,
  prepare,
  onFermer,
  onMasquer,
  onFait,
}: {
  slug: string;
  action: ActionRelance;
  // Brouillon déjà rédigé par la routine (créneaux libres compris), en attente de validation.
  prepare: PropositionItem | null;
  onFermer: () => void;
  onMasquer: (jours: number, pourToujours: boolean) => void;
  onFait: (jours: number) => void;
}) {
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
      const r = await decider(slug, prepare.id, 'valider');
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
      for (const id of action.tacheIds) await updateTache(slug, id, { fait: true });
      if (suite.canal)
        await createTache(slug, {
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
      sousTitre={[action.contact, action.etape].filter(Boolean).join(' · ')}
      tiroir
      onFermer={onFermer}
      pied={
        suites ? (
          <button
            className="btn primary"
            type="button"
            onClick={() => void valider()}
            disabled={enCours}
          >
            Valider et continuer
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
              <button
                className="btn sm ghost danger"
                type="button"
                style={{ marginLeft: 'auto' }}
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
