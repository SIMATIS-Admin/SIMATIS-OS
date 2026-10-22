import { useEffect, useRef, useState } from 'react';
import { fetchConsole, type ConsoleOS, type LigneConsole } from '../api.js';

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
    const minuteur = window.setInterval(() => void charger(), ouverte ? 5_000 : 30_000);
    return () => {
      vivant = false;
      window.clearInterval(minuteur);
    };
  }, [slug, ouverte]);

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

  return (
    <section className={`console ${ouverte ? 'ouverte' : ''}`} aria-label="Console de l'OS">
      <div className="console-barre">
        <button
          className="console-titre"
          aria-expanded={ouverte}
          aria-label={ouverte ? 'Replier la console' : 'Déplier la console'}
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
      </div>
      {ouverte && (
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
      )}
    </section>
  );
}
