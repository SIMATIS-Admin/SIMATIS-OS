import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchBrouillonsPrepares,
  fetchMasqueesRelance,
  fetchPipeline,
  fetchTaches,
  masquerRelance,
  masquerRelanceLot,
  type Pipeline,
  type PropositionItem,
  type SemaineTaches,
  type TacheVue,
} from '../api.js';
import {
  brouillonPour,
  construireFile,
  dansMandats,
  POUR_TOUJOURS,
  RETARD_ANCIEN,
  ventiler,
  type ActionRelance,
  type Masquees,
  type SourceAction,
} from '../aideRelance.js';
import { dansJours, VoletAction } from './AideRelanceVolet.js';
import { Fenetre } from './Fenetre.js';

const CHOIX = [5, 10, 15, 'tout'] as const;
type Nombre = (typeof CHOIX)[number];
const SOURCES: Record<SourceAction, { libelle: string; classe: string }> = {
  retard: { libelle: 'En retard', classe: 'red' },
  aujourdhui: { libelle: 'Aujourd’hui', classe: 'blue' },
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

const CLE_MANDATS = 'aideRelance.instances-masquees';
const CLE_PLAFOND = 'aideRelance:plafond';
const jourLong = (t: number) =>
  new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

// Le bloc « À faire maintenant » du Cockpit : les actions commerciales à réaliser vite, tirées du
// Radar, des tâches en retard et des affaires sans activité. L'OS prépare, Marc relit et envoie.
// Replié il tient sur une ligne ; « Lancer la séquence » déroule les actions une par une.
export function AideRelance({ slug }: { slug: string }) {
  const [donnees, setDonnees] = useState<{
    pipeline: Pipeline;
    enRetard: TacheVue[];
    duJour: TacheVue[];
    mandats: SemaineTaches['instances'];
  } | null>(null);
  const [erreur, setErreur] = useState(false);
  const [nb, setNb] = useState<Nombre>(() => {
    const v = lire<Nombre>('aideRelance:nb', 10);
    return CHOIX.includes(v) ? v : 10;
  });
  // Après « Ventiler », la liste du jour se limite à ce qui reste pour aujourd'hui : sans cela, les
  // actions étalées seraient aussitôt remplacées par les suivantes de la file.
  const [plafond, setPlafond] = useState<number | null>(() => {
    const v = lire<{ jour: string; n: number } | null>(CLE_PLAFOND, null);
    return v && v.jour === jourIso(new Date()) ? v.n : null;
  });
  const [infoVentilation, setInfoVentilation] = useState('');
  const [deploye, setDeploye] = useState<boolean>(() => lire('aideRelance:deploye', false));
  const [filtre, setFiltre] = useState<'tout' | SourceAction>('tout');
  // Mandats décochés (comme dans l'Agenda) : on retient ceux qu'on cache, un mandat ajouté plus
  // tard apparaît donc tout de suite.
  const [mandatsMasques, setMandatsMasques] = useState<string[]>(() => lire(CLE_MANDATS, []));
  const [masquees, setMasquees] = useState<Masquees>({});
  const [brouillons, setBrouillons] = useState<PropositionItem[]>([]);
  const [faites, setFaites] = useState(0);
  const [nettoyage, setNettoyage] = useState<{ erreur: boolean } | null>(null);
  const [ouverte, setOuverte] = useState<ActionRelance | null>(null);
  const [sequence, setSequence] = useState<{
    actions: ActionRelance[];
    i: number;
    faites: number;
    reportees: number;
    passees: number;
  } | null>(null);

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
        setDonnees({
          pipeline,
          enRetard: semaine.enRetard,
          duJour: semaine.taches,
          mandats: semaine.instances ?? [],
        });
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
    // Rangé dans l'espace affiché ; la clé d'une action d'un autre mandat porte déjà ce mandat.
    masquerRelance(slug, id, jusqua).catch(charger);
  };
  // Écarte d'un coup les tâches périmées de cette liste : elles restent dans l'Agenda et dans le
  // CRM, seule l'aide à la relance cesse de les proposer.
  const ecarterAnciennes = async () => {
    const ids = file.filter((a) => a.ancienne).map((a) => a.id);
    try {
      await masquerRelanceLot(slug, ids, POUR_TOUJOURS);
      setMasquees((deja) => ({
        ...deja,
        ...Object.fromEntries(ids.map((id) => [id, POUR_TOUJOURS])),
      }));
      setNettoyage(null);
    } catch {
      setNettoyage({ erreur: true });
    }
  };
  const choisir = (n: Nombre) => {
    setNb(n);
    setPlafond(null);
    ecrire(CLE_PLAFOND, null);
    ecrire('aideRelance:nb', n);
  };
  const basculer = () => {
    setDeploye(!deploye);
    ecrire('aideRelance:deploye', !deploye);
  };
  const basculerMandat = (mandat: string) => {
    const suivants = mandatsMasques.includes(mandat)
      ? mandatsMasques.filter((m) => m !== mandat)
      : [...mandatsMasques, mandat];
    setMandatsMasques(suivants);
    ecrire(CLE_MANDATS, suivants);
  };

  const file = useMemo(
    () =>
      donnees
        ? construireFile({
            pipeline: donnees.pipeline,
            enRetard: donnees.enRetard,
            duJour: donnees.duJour,
            masquees,
            slugCourant: slug,
          }).filter((a) => dansMandats(a, mandatsMasques))
        : [],
    [donnees, masquees, mandatsMasques, slug],
  );
  // Actions cachées par un report (pas par « Pas pertinent ») : on les compte pour ne rien cacher
  // en silence, et on peut les remettre d'un clic.
  const reportees = useMemo(() => {
    if (!donnees) return [];
    const maintenant = Date.now();
    return construireFile({
      pipeline: donnees.pipeline,
      enRetard: donnees.enRetard,
      duJour: donnees.duJour,
      slugCourant: slug,
    }).filter((a) => {
      const jusqua = masquees[a.id] ?? 0;
      return dansMandats(a, mandatsMasques) && jusqua > maintenant && jusqua < POUR_TOUJOURS;
    });
  }, [donnees, masquees, mandatsMasques, slug]);
  const remettre = async () => {
    const ids = reportees.map((a) => a.id);
    try {
      // Une date passée vaut « plus de report » : le serveur ne renvoie que les reports à venir.
      await masquerRelanceLot(slug, ids, 0);
      setMasquees((deja) => ({ ...deja, ...Object.fromEntries(ids.map((id) => [id, 0])) }));
    } catch {
      charger();
    }
  };
  const filtrees = file.filter(
    (a) => filtre === 'tout' || a.raisons.some((r) => r.source === filtre),
  );
  const visibles =
    plafond !== null
      ? filtrees.slice(0, Math.min(plafond, nb === 'tout' ? Infinity : nb))
      : nb === 'tout'
        ? filtrees
        : filtrees.slice(0, nb);
  const attente = filtrees.length - visibles.length;
  const compte = (s: SourceAction) =>
    file.filter((a) => a.raisons.some((r) => r.source === s)).length;
  const mandats = donnees?.mandats ?? [];
  const anciennes = file.filter((a) => a.ancienne);
  const parMandat = mandats
    .map((m) => ({ nom: m.nom, n: anciennes.filter((a) => a.mandat === m.slug).length }))
    .filter((m) => m.n > 0);

  // Étale les actions choisies sur plusieurs jours ouvrés (5 par jour au plus). On ne touche ni aux
  // tâches ni au CRM : les actions étalées sont reportées, comme avec « Reporter », et reviennent
  // dans la liste à leur jour ; « Les remettre dans la liste » défait tout.
  const ventilerVisibles = async () => {
    const lot = ventiler(visibles.map((a) => a.id));
    if (lot.length === 0) {
      setInfoVentilation('Pas assez d’actions pour les étaler.');
      return;
    }
    const parJour = new Map<number, string[]>();
    for (const { id, jusqua } of lot) parJour.set(jusqua, [...(parJour.get(jusqua) ?? []), id]);
    try {
      for (const [jusqua, ids] of parJour) await masquerRelanceLot(slug, ids, jusqua);
    } catch {
      charger();
      setInfoVentilation('La répartition a échoué. Réessayez.');
      return;
    }
    setMasquees((deja) => ({ ...deja, ...Object.fromEntries(lot.map((x) => [x.id, x.jusqua])) }));
    const gardees = visibles.length - lot.length;
    setPlafond(gardees);
    ecrire(CLE_PLAFOND, { jour: jourIso(new Date()), n: gardees });
    const dernier = Math.max(...lot.map((x) => x.jusqua));
    setInfoVentilation(
      `${gardees} action(s) pour aujourd'hui, ${lot.length} étalée(s) sur ${parJour.size} jour(s) ouvré(s) suivants, jusqu'à ${jourLong(dernier)}.`,
    );
  };

  const lancer = () =>
    setSequence({ actions: visibles, i: 0, faites: 0, reportees: 0, passees: 0 });
  const avancer = (bilan: Partial<{ faites: number; reportees: number; passees: number }>) =>
    setSequence((q) =>
      q
        ? {
            ...q,
            i: q.i + 1,
            faites: q.faites + (bilan.faites ?? 0),
            reportees: q.reportees + (bilan.reportees ?? 0),
            passees: q.passees + (bilan.passees ?? 0),
          }
        : q,
    );
  const courante =
    sequence && sequence.i < sequence.actions.length ? sequence.actions[sequence.i] : null;

  const action = (a: ActionRelance) => ({
    prepare: brouillonPour(a, brouillons),
    onMasquer: (jours: number, pourToujours: boolean) => {
      masquer(a.id, pourToujours ? POUR_TOUJOURS : dansJours(jours).getTime());
      if (sequence) avancer({ reportees: 1 });
      else setOuverte(null);
    },
    onFait: (jours: number) => {
      masquer(a.id, dansJours(Math.max(jours, 7)).getTime());
      setFaites((n) => n + 1);
      if (sequence) avancer({ faites: 1 });
      else {
        setOuverte(null);
        charger();
      }
    },
  });

  return (
    <section
      className={`panel aide-relance ${deploye ? 'deploye' : 'replie'}`}
      aria-label="À faire maintenant"
    >
      <div className="panel-b">
        <div className="aide-tete">
          <div className="aide-titre">
            <button
              type="button"
              className="aide-bascule"
              aria-expanded={deploye}
              aria-controls="aide-liste"
              onClick={basculer}
            >
              <span className="aide-chevron" aria-hidden="true" />
              <span>
                <strong>À faire maintenant</strong>
                <span className="muted small">
                  {donnees ? `${file.length} action(s) possible(s)` : 'Chargement en cours'}
                  {faites > 0 ? ` · ${faites} faite(s) aujourd'hui` : ''}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="aide-vent"
              aria-label="Ventiler les actions"
              title="Étale les actions choisies sur plusieurs jours ouvrés, 5 par jour au plus. Rien n'est supprimé : « Les remettre dans la liste » défait tout."
              disabled={visibles.length < 2}
              onClick={() => void ventilerVisibles()}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7a2.5 2.5 0 1 1-2.5 2.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div className="aide-choix" role="group" aria-label="Paramètres de la séquence">
            {mandats.length > 1 && (
              <div className="aide-instances">
                <span>Instances</span>
                <details className="ag-instances">
                  <summary className="input">
                    {mandatsMasques.length === 0
                      ? 'Toutes les instances'
                      : `${mandats.filter((m) => !mandatsMasques.includes(m.slug)).length} sur ${mandats.length}`}
                  </summary>
                  <div className="ag-instances-liste" role="group" aria-label="Instances affichées">
                    {mandats.map((m) => (
                      <label key={m.slug}>
                        <input
                          type="checkbox"
                          checked={!mandatsMasques.includes(m.slug)}
                          onChange={() => basculerMandat(m.slug)}
                        />
                        {m.nom}
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            )}
            <span className="aide-quantite muted small">Nombre :</span>
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
            <button
              type="button"
              className="btn primary"
              disabled={visibles.length === 0}
              onClick={lancer}
            >
              Lancer la séquence
            </button>
          </div>
        </div>
        {deploye && (
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
          </div>
        )}
      </div>
      {infoVentilation && (
        <p className="aide-info" role="status">
          {infoVentilation}
        </p>
      )}
      {reportees.length > 0 && (
        <div className="aide-reportees">
          <span>
            {reportees.length} action(s) reportée(s), cachée(s) de cette liste jusqu'à leur date.
          </span>
          <button className="btn sm" type="button" onClick={() => void remettre()}>
            Les remettre dans la liste
          </button>
        </div>
      )}
      {deploye && anciennes.length > 0 && (
        <div className="aide-nettoyage">
          <span>
            {anciennes.length} tâche(s) en retard depuis plus de {RETARD_ANCIEN} jours, sans doute
            périmées.
          </span>
          <button className="btn sm" type="button" onClick={() => setNettoyage({ erreur: false })}>
            Les écarter de cette liste…
          </button>
        </div>
      )}
      {deploye && (
        <div className="aide-liste" id="aide-liste">
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
                <button
                  type="button"
                  key={a.id}
                  className="aide-ligne"
                  onClick={() => setOuverte(a)}
                >
                  <span className="aide-rang">{i + 1}</span>
                  <span className={`badge ${a.canal === 'mail' ? 'blue' : 'amber'}`}>
                    {a.canal === 'mail' ? 'Mail' : 'Appel'}
                  </span>
                  <span className="aide-corps">
                    <span className="aide-nom">
                      {a.entreprise}
                      {a.contact && <small>{a.contact}</small>}
                      {a.instance && <small className="aide-mandat">{a.instance.nom}</small>}
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
                  + {attente} autre(s) en attente. Augmentez le nombre ci-dessus quand vous avez
                  plus de temps.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {nettoyage && (
        <Fenetre
          titre="Écarter les tâches périmées ?"
          onFermer={() => setNettoyage(null)}
          pied={
            <>
              <button className="btn" type="button" onClick={() => setNettoyage(null)}>
                Annuler
              </button>
              <button className="btn primary" type="button" onClick={() => void ecarterAnciennes()}>
                Écarter {anciennes.length} tâche(s)
              </button>
            </>
          }
        >
          <p>
            Ces {anciennes.length} tâches sont en retard depuis plus de {RETARD_ANCIEN} jours et
            n'ont aucune autre raison de figurer ici. Elles{' '}
            <b>restent dans l'Agenda et dans le CRM</b>: seule cette liste cesse de les proposer.
            Rien n'est supprimé ni marqué comme fait.
          </p>
          {parMandat.length > 1 && (
            <ul>
              {parMandat.map((m) => (
                <li key={m.nom}>
                  {m.nom} : {m.n}
                </li>
              ))}
            </ul>
          )}
          {nettoyage.erreur && (
            <p role="alert" className="muted small">
              L'opération a échoué. Réessayez.
            </p>
          )}
        </Fenetre>
      )}
      {ouverte && !sequence && (
        <VoletAction
          slug={slug}
          action={ouverte}
          onFermer={() => setOuverte(null)}
          {...action(ouverte)}
        />
      )}
      {sequence && courante && (
        <VoletAction
          key={courante.id}
          slug={slug}
          action={courante}
          sequence={{
            n: sequence.i + 1,
            total: sequence.actions.length,
            onPasser: () => avancer({ passees: 1 }),
          }}
          onFermer={() => {
            setSequence(null);
            charger();
          }}
          {...action(courante)}
        />
      )}
      {sequence && !courante && (
        <Fenetre
          titre="Séquence terminée"
          onFermer={() => {
            setSequence(null);
            charger();
          }}
          pied={
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                setSequence(null);
                charger();
              }}
            >
              Fermer
            </button>
          }
        >
          <p>
            {sequence.actions.length} action(s) passées en revue : <b>{sequence.faites}</b>{' '}
            faite(s), <b>{sequence.reportees}</b> reportée(s) ou écartée(s),{' '}
            <b>{sequence.passees}</b> laissée(s) pour plus tard.
          </p>
        </Fenetre>
      )}
    </section>
  );
}
