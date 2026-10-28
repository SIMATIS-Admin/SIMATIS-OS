import { useEffect, useRef, useState } from 'react';
import { majAtelier } from '../../api.js';
import { Cadrage } from './Cadrage.js';
import { Ciblage } from './Ciblage.js';
import { Zone } from './champs.js';
import { EtapeDiagnostic } from './EtapeDiagnostic.js';
import { FeuilleDeRoute } from './FeuilleDeRoute.js';
import { ETAPES, type EtatAtelier } from './etat.js';
import { Modele } from './Modele.js';
import { Objectifs } from './Objectifs.js';

const DELAI_ENREGISTREMENT = 800;
const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Statut = 'ok' | 'attente' | 'erreur';

// Un atelier ouvert : parcours en six étapes, enregistrement automatique dans la base après un
// court délai (et à la sortie de l'écran). `atelier === null` : module d'essai, rien n'est écrit.
export function AtelierVue({
  slug,
  atelier,
  etatInitial,
  essai,
  onRetour,
}: {
  slug: string;
  atelier: { id: string; titre: string; entrepriseNom: string; entrepriseId: string } | null;
  etatInitial: EtatAtelier;
  essai: boolean;
  onRetour: () => void;
  onTitre?: (titre: string | null) => void;
}) {
  const [etat, setEtat] = useState(etatInitial);
  // Écran partagé : actif à chaque ouverture, jamais enregistré avec l'atelier.
  const [partage, setPartage] = useState(true);
  const [statut, setStatut] = useState<Statut>('ok');
  const [erreur, setErreur] = useState<string | null>(null);
  const courant = useRef(etatInitial);
  const modifie = useRef(false);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enVol = useRef(false);
  const rejouer = useRef(false);
  const enregistre = !essai && atelier !== null;

  // Un seul envoi à la fois : sinon deux requêtes parallèles pourraient arriver dans le désordre et
  // laisser en base un état plus ancien que celui de l'écran. La modification arrivée entre-temps
  // part dès que l'envoi en cours est terminé. À la fermeture de l'onglet, on envoie sans attendre.
  const envoyer = (fermeture = false) => {
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = null;
    if (!enregistre || !modifie.current) return;
    if (enVol.current && !fermeture) {
      rejouer.current = true;
      return;
    }
    modifie.current = false;
    enVol.current = true;
    const patch = { etat: courant.current };
    (fermeture
      ? majAtelier(slug, atelier.id, patch, { keepalive: true })
      : majAtelier(slug, atelier.id, patch)
    ).then(
      () => {
        enVol.current = false;
        if (modifie.current && rejouer.current) {
          rejouer.current = false;
          envoyer();
        } else setStatut(modifie.current ? 'attente' : 'ok');
      },
      (e: unknown) => {
        enVol.current = false;
        modifie.current = true;
        rejouer.current = false;
        setStatut('erreur');
        setErreur(messageErreur(e));
      },
    );
  };

  const maj = (suite: (e: EtatAtelier) => EtatAtelier) => {
    const prochain = suite(courant.current);
    courant.current = prochain;
    setEtat(prochain);
    if (!enregistre) return;
    modifie.current = true;
    setStatut('attente');
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(envoyer, DELAI_ENREGISTREMENT);
  };

  // À la sortie de l'écran, la dernière modification part tout de suite.
  useEffect(() => {
    const fermeture = () => envoyer(true);
    window.addEventListener('pagehide', fermeture);
    return () => {
      window.removeEventListener('pagehide', fermeture);
      envoyer();
    };
  }, []);

  const changer = (patch: Partial<EtatAtelier>) => maj((e) => ({ ...e, ...patch }));
  const contenu = () => {
    const props = { etat, partage, onChange: changer };
    switch (etat.step) {
      case 0:
        return <Cadrage {...props} />;
      case 1:
        return <EtapeDiagnostic {...props} />;
      case 2:
        return <Modele {...props} />;
      case 3:
        return (
          <Objectifs
            etat={etat}
            partage={partage}
            onChange={(obj) => maj((e) => ({ ...e, obj: { ...e.obj, ...obj } }))}
          />
        );
      case 4:
        return <Ciblage {...props} />;
      default:
        return (
          <FeuilleDeRoute {...props} entreprise={atelier?.entrepriseNom ?? 'Atelier d’essai'} />
        );
    }
  };

  const aller = (n: number) => maj((e) => ({ ...e, step: Math.min(5, Math.max(0, n)) }));

  return (
    <div className="stack at">
      {essai && (
        <div className="alert amber">
          Module d’essai : l’atelier est vide et rien n’est enregistré dans l’OS. Il disparaît quand
          tu quittes l’écran.
        </div>
      )}
      {erreur && (
        <div className="alert amber" role="alert">
          <span>{erreur}</span>
          <button className="btn" onClick={() => setErreur(null)}>
            Fermer
          </button>
        </div>
      )}
      <div className="panel at-tete">
        <div className="panel-h">
          <button className="btn" type="button" onClick={onRetour}>
            ← Ateliers
          </button>
          <div className="at-titre">
            <b>{atelier ? atelier.titre : 'Atelier d’essai'}</b>
            <span className="small muted">
              {atelier ? (
                <a href={`#/${slug}/fiche/entreprise/${atelier.entrepriseId}`}>
                  Fiche de l’entreprise
                </a>
              ) : (
                'Aucune entreprise'
              )}
              {atelier && ` · ${atelier.entrepriseNom}`}
              {enregistre &&
                ` · ${statut === 'attente' ? 'enregistrement…' : statut === 'erreur' ? 'non enregistré' : 'enregistré'}`}
            </span>
          </div>
          <button
            className={`btn${partage ? ' go' : ''}`}
            type="button"
            aria-pressed={partage}
            onClick={() => setPartage((p) => !p)}
          >
            {partage ? 'Écran partagé : infos privées masquées' : 'Infos privées visibles'}
          </button>
        </div>
      </div>

      <div className="at-parcours">
        {ETAPES.map((nom, i) => (
          <button
            key={nom}
            type="button"
            className={i < etat.step ? 'fait' : ''}
            aria-current={i === etat.step ? 'step' : undefined}
            onClick={() => aller(i)}
          >
            <b>Étape {i + 1}</b> {nom}
          </button>
        ))}
      </div>

      <div className="at-contenu">
        {contenu()}
        {!partage && (
          <div className="at-carte at-prive">
            <h3>Notes réservées</h3>
            <p className="muted small">Notes de cette étape, invisibles en écran partagé.</p>
            <Zone
              valeur={etat.notes[etat.step] ?? ''}
              lignes={3}
              etiquette="Notes réservées"
              onChange={(v) =>
                maj((e) => ({ ...e, notes: e.notes.map((n, i) => (i === e.step ? v : n)) }))
              }
            />
          </div>
        )}
      </div>

      <div className="at-nav">
        <button
          className="btn"
          type="button"
          disabled={etat.step === 0}
          onClick={() => aller(etat.step - 1)}
        >
          ← Étape précédente
        </button>
        <button
          className="btn go"
          type="button"
          disabled={etat.step === 5}
          onClick={() => aller(etat.step + 1)}
        >
          Étape suivante →
        </button>
      </div>
    </div>
  );
}
