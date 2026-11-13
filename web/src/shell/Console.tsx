import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchConsole,
  fetchLimitesIA,
  fetchOptions,
  saveOptions,
  type ConsoleOS,
  type FournisseurIA,
  type LigneConsole,
  type LimiteIA,
  type LimitesIA,
  type MoteurIA,
} from '../api.js';
import claudeMark from '../assets/claude-mark.svg';
import openaiMark from '../assets/openai-mark.svg';

// The label says what the colour means, so a line can be read without knowing the code.
const ETIQUETTES: Record<LigneConsole['niveau'], string> = {
  ok: 'FAIT',
  info: 'INFO',
  attention: 'À VOIR',
  erreur: 'ÉCHEC',
};

const emoji = (l: LigneConsole) =>
  l.source === 'routine' || l.acteur.startsWith('agent:')
    ? '🤖'
    : l.acteur === 'pilote'
      ? '🙋'
      : '⚙️';

const heure = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  });

const dateHeure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const delai = (iso: string, maintenant: number) => {
  const minutes = Math.max(0, Math.ceil((new Date(iso).getTime() - maintenant) / 60_000));
  if (minutes === 0) return 'maintenant';
  if (minutes < 60) return `dans ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  if (heures < 24) return `dans ${heures} h${reste ? ` ${String(reste).padStart(2, '0')}` : ''}`;
  const jours = Math.floor(heures / 24);
  return `dans ${jours} j ${heures % 24} h`;
};

function Jauge({ nom, limite, maintenant }: { nom: string; limite: LimiteIA; maintenant: number }) {
  const faible = limite.restant <= 25;
  return (
    <div className="limite-ia-jauge">
      <div className="limite-ia-valeur">
        <span>{nom}</span>
        <b>{Math.round(limite.restant)} % restant</b>
      </div>
      <div
        className={`limite-ia-barre ${faible ? 'faible' : ''}`}
        role="progressbar"
        aria-label={`${nom} : capacité restante`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(limite.restant)}
      >
        <span style={{ width: `${limite.restant}%` }} />
      </div>
      <div className="limite-ia-reset">
        Réinit. <b>{dateHeure(limite.reinitialiseLe)}</b> ·{' '}
        {delai(limite.reinitialiseLe, maintenant)}
      </div>
    </div>
  );
}

function MarqueIA({ fournisseur }: { fournisseur: FournisseurIA }) {
  return (
    <span className="limite-ia-marque" aria-hidden="true">
      <img src={fournisseur.id === 'claude' ? claudeMark : openaiMark} alt="" />
    </span>
  );
}

const MOTEURS: { id: MoteurIA; nom: string; marque: string; classe: 'claude' | 'chatgpt' }[] = [
  { id: 'claude', nom: 'Claude', marque: claudeMark, classe: 'claude' },
  { id: 'codex', nom: 'Codex', marque: openaiMark, classe: 'chatgpt' },
];

// Moteur qui exécute les tâches IA de l'OS : le choisi est allumé, l'autre éteint.
function CommutateurMoteur({
  moteur,
  onChoisir,
}: {
  moteur: MoteurIA;
  onChoisir: (moteur: MoteurIA) => void;
}) {
  return (
    <div className="commutateur-moteur" role="radiogroup" aria-label="Moteur IA">
      {MOTEURS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={moteur === m.id}
          aria-label={m.nom}
          title={`${m.nom} exécute les tâches IA`}
          className={`commutateur-moteur-option ${m.classe} ${moteur === m.id ? 'actif' : ''}`}
          onClick={() => moteur !== m.id && onChoisir(m.id)}
        >
          <span className="limite-ia-marque" aria-hidden="true">
            <img src={m.marque} alt="" />
          </span>
        </button>
      ))}
    </div>
  );
}

function MiniJauge({ nom, limite }: { nom: string; limite: LimiteIA }) {
  return (
    <div className="limite-ia-mini-jauge">
      <div className="limite-ia-mini-valeur">
        <span>{nom}</span>
        <b>{Math.round(limite.restant)} %</b>
      </div>
      <div
        className="limite-ia-mini-barre"
        role="progressbar"
        aria-label={`${nom} : capacité restante`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(limite.restant)}
      >
        <span style={{ width: `${limite.restant}%` }} />
      </div>
    </div>
  );
}

function FournisseurCompact({
  fournisseur,
  chargement = false,
}: {
  fournisseur: FournisseurIA;
  chargement?: boolean;
}) {
  return (
    <section
      className={`limite-ia-compacte ${fournisseur.id}`}
      aria-label={`${fournisseur.nom}, limites compactes`}
    >
      <div className="limite-ia-compacte-titre">
        <MarqueIA fournisseur={fournisseur} />
        <b>{fournisseur.nom}</b>
      </div>
      {fournisseur.etat === 'ok' && fournisseur.fenetre5h && fournisseur.hebdomadaire ? (
        <>
          <MiniJauge nom="5 h" limite={fournisseur.fenetre5h} />
          <MiniJauge nom="Sem." limite={fournisseur.hebdomadaire} />
        </>
      ) : (
        <span className="limite-ia-compacte-vide">
          {chargement
            ? 'Chargement…'
            : fournisseur.etat === 'erreur'
              ? 'Indisponible'
              : 'À connecter'}
        </span>
      )}
    </section>
  );
}

function Fournisseur({
  fournisseur,
  maintenant,
  actualiseLe,
  enCours,
  onActualiser,
  chargement = false,
}: {
  fournisseur: FournisseurIA;
  maintenant: number;
  actualiseLe?: string | null;
  enCours?: boolean;
  onActualiser?: () => void;
  chargement?: boolean;
}) {
  return (
    <section className={`limite-ia-fournisseur ${fournisseur.id}`} aria-label={fournisseur.nom}>
      <div className="limite-ia-fournisseur-titre">
        <MarqueIA fournisseur={fournisseur} />
        <span>
          <b>{fournisseur.nom}</b>
          <small>
            {fournisseur.plan ? `Abonnement ${fournisseur.plan}` : 'Abonnement non identifié'}
            {actualiseLe ? ` · Màj ${heure(actualiseLe)}` : ''}
          </small>
        </span>
        {onActualiser && (
          <button
            className="limites-ia-actualiser"
            type="button"
            aria-label="Actualiser les limites IA"
            disabled={enCours}
            onClick={onActualiser}
          >
            Actualiser
          </button>
        )}
      </div>
      {fournisseur.etat === 'ok' && fournisseur.fenetre5h && fournisseur.hebdomadaire ? (
        <>
          <Jauge nom="Fenêtre 5 h" limite={fournisseur.fenetre5h} maintenant={maintenant} />
          <Jauge nom="Hebdomadaire" limite={fournisseur.hebdomadaire} maintenant={maintenant} />
        </>
      ) : (
        <p className={`limite-ia-vide ${fournisseur.etat}`}>
          {chargement
            ? 'Chargement des limites…'
            : fournisseur.etat === 'erreur'
              ? 'Données illisibles'
              : 'Source à connecter'}
        </p>
      )}
    </section>
  );
}

// Local conveniences only: storage can be missing or blocked, the console works without it.
const lire = (cle: string) => {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
};
const ecrire = (cle: string, valeur: string | null) => {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  } catch {
    // ignored
  }
};

// Read-only terminal at the foot of the page. The journal cannot be erased, so « Vider » only hides
// what is older than the newest line, in this browser; « tout réafficher » brings it back.
export function Console({ slug }: { slug: string }) {
  const cleOuverte = 'console-ouverte';
  const cleCoupe = `console-vide-${slug}`;
  const [ouverte, setOuverte] = useState(() => lire(cleOuverte) === '1');
  const [coupe, setCoupe] = useState<string | null>(() => lire(cleCoupe));
  const [donnees, setDonnees] = useState<ConsoleOS | null>(null);
  const [panne, setPanne] = useState(false);
  const [limites, setLimites] = useState<LimitesIA | null>(null);
  const [limitesEnPanne, setLimitesEnPanne] = useState(false);
  const [limitesEnCours, setLimitesEnCours] = useState(false);
  const [moteur, setMoteur] = useState<MoteurIA>('codex');
  useEffect(() => {
    void fetchOptions().then(
      (o) => setMoteur(o?.moteurIA === 'claude' ? 'claude' : 'codex'),
      () => undefined,
    );
  }, []);
  // Le choix s'affiche tout de suite ; il revient en arrière si l'OS ne l'a pas enregistré.
  const choisirMoteur = (choix: MoteurIA) => {
    const avant = moteur;
    setMoteur(choix);
    void saveOptions({ moteurIA: choix }).catch(() => setMoteur(avant));
  };
  const [maintenant, setMaintenant] = useState(Date.now);
  const connues = useRef<Set<string> | null>(null);
  const [nouvelles, setNouvelles] = useState<Set<string>>(new Set());
  const corps = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivant = true;
    const charger = () =>
      fetchConsole(slug).then(
        (d) => {
          if (!vivant) return;
          setPanne(false);
          const avant = connues.current;
          // The first load is the history: only what arrives afterwards is typed out.
          if (avant)
            setNouvelles(new Set(d.lignes.filter((l) => !avant.has(l.id)).map((l) => l.id)));
          connues.current = new Set(d.lignes.map((l) => l.id));
          setDonnees(d);
        },
        () => vivant && setPanne(true),
      );
    void charger();
    const actualiser = () => void charger();
    window.addEventListener('console:actualiser', actualiser);
    const minuteur = window.setInterval(() => void charger(), ouverte ? 5_000 : 30_000);
    return () => {
      vivant = false;
      window.removeEventListener('console:actualiser', actualiser);
      window.clearInterval(minuteur);
    };
  }, [slug, ouverte]);

  const chargerLimites = useCallback(() => {
    setLimitesEnCours(true);
    return fetchLimitesIA().then(
      (d) => {
        setLimites(d);
        setLimitesEnPanne(false);
        setLimitesEnCours(false);
      },
      () => {
        setLimitesEnPanne(true);
        setLimitesEnCours(false);
      },
    );
  }, []);

  useEffect(() => {
    void chargerLimites();
    const rafraichirSiVisible = () => {
      if (document.visibilityState === 'visible') void chargerLimites();
    };
    const minuteur = window.setInterval(() => void chargerLimites(), 5 * 60_000);
    const horloge = window.setInterval(() => setMaintenant(Date.now()), 60_000);
    window.addEventListener('focus', rafraichirSiVisible);
    document.addEventListener('visibilitychange', rafraichirSiVisible);
    return () => {
      window.clearInterval(minuteur);
      window.clearInterval(horloge);
      window.removeEventListener('focus', rafraichirSiVisible);
      document.removeEventListener('visibilitychange', rafraichirSiVisible);
    };
  }, [chargerLimites]);

  const toutes = donnees?.lignes ?? [];
  const visibles = coupe ? toutes.filter((l) => l.at > coupe) : toutes;
  const masquees = toutes.length - visibles.length;
  const derniere = visibles.at(-1);

  useEffect(() => {
    if (ouverte && corps.current) corps.current.scrollTop = corps.current.scrollHeight;
  }, [ouverte, visibles.length]);

  const basculer = () => {
    ecrire(cleOuverte, ouverte ? '0' : '1');
    setOuverte(!ouverte);
  };
  const vider = () => {
    const dernier = toutes.at(-1)?.at;
    if (!dernier) return;
    ecrire(cleCoupe, dernier);
    setCoupe(dernier);
  };
  const reafficher = () => {
    ecrire(cleCoupe, null);
    setCoupe(null);
  };
  const chargementLimites = !limites && !limitesEnPanne;
  const fournisseurs =
    limites?.fournisseurs ??
    (['claude', 'chatgpt'] as const).map((id): FournisseurIA => ({
      id,
      nom: id === 'claude' ? 'Claude' : 'ChatGPT',
      etat: limitesEnPanne ? 'erreur' : 'indisponible',
      plan: null,
      fenetre5h: null,
      hebdomadaire: null,
    }));

  return (
    <section className={`console ${ouverte ? 'ouverte' : ''}`} aria-label="Console de l'OS">
      {!ouverte && (
        <div className="console-barre">
          <div className="console-log-compacte">
            <button
              className="console-titre"
              aria-expanded={false}
              aria-label="Déplier la console"
              onClick={basculer}
            >
              <span className="console-prompt" aria-hidden="true">
                {donnees?.enCours ? '⠿' : '▸'}
              </span>
              <span className="console-dernier">
                {panne ? (
                  'Console injoignable…'
                ) : derniere ? (
                  <>
                    <span className={`console-badge ${derniere.niveau}`}>
                      {ETIQUETTES[derniere.niveau]}
                    </span>
                    {derniere.texte}
                  </>
                ) : donnees ? (
                  'Tout est calme, rien à signaler.'
                ) : (
                  'Réveil de la console…'
                )}
              </span>
            </button>
            {masquees > 0 && (
              <button className="console-lien" onClick={reafficher}>
                tout réafficher ({masquees})
              </button>
            )}
            <button className="console-lien" onClick={vider} disabled={visibles.length === 0}>
              Vider
            </button>
            <CommutateurMoteur moteur={moteur} onChoisir={choisirMoteur} />
          </div>
          {fournisseurs.map((fournisseur) => (
            <FournisseurCompact
              key={fournisseur.id}
              fournisseur={fournisseur}
              chargement={chargementLimites}
            />
          ))}
        </div>
      )}
      {ouverte && (
        <div className="console-deplie">
          <div className="console-journal-ouvert">
            <button className="console-replier" type="button" onClick={basculer}>
              Replier
            </button>
            <CommutateurMoteur moteur={moteur} onChoisir={choisirMoteur} />
            <div className="console-corps" ref={corps} role="log" aria-live="polite">
              {visibles.length === 0 && (
                <div className="console-ligne vide">
                  <span className="console-curseur" aria-hidden="true" />
                  Rien pour l'instant. Les routines et vos actions s'afficheront ici.
                </div>
              )}
              {visibles.map((l) => (
                <div
                  key={l.id}
                  className={`console-ligne ${l.niveau} ${nouvelles.has(l.id) ? 'nouvelle' : ''}`}
                >
                  <span className="console-heure">{heure(l.at)}</span>
                  <span className="console-badge">{ETIQUETTES[l.niveau]}</span>
                  <span aria-hidden="true">{emoji(l)}</span>
                  <span className="console-texte">{l.texte}</span>
                </div>
              ))}
              {donnees?.enCours && (
                <div className="console-ligne info">
                  <span className="console-heure" />
                  <span className="console-badge">INFO</span>
                  <span className="console-texte">
                    Claude travaille
                    <span className="console-curseur" aria-hidden="true" />
                  </span>
                </div>
              )}
            </div>
          </div>
          {fournisseurs.map((fournisseur) => (
            <Fournisseur
              key={fournisseur.id}
              fournisseur={fournisseur}
              maintenant={maintenant}
              actualiseLe={fournisseur.id === 'chatgpt' ? limites?.actualiseLe : null}
              enCours={limitesEnCours}
              onActualiser={fournisseur.id === 'chatgpt' ? () => void chargerLimites() : undefined}
              chargement={chargementLimites}
            />
          ))}
        </div>
      )}
    </section>
  );
}
