import { useCallback, useEffect, useState } from 'react';
import { fetchCompteurInbox } from '../api.js';
import { Icon } from '../icons.js';
import { Enregistrements } from '../visio/Enregistrements.js';
import { AideRelance } from './AideRelance.js';
import { Brief } from './Brief.js';
import { EtatCommercial } from './EtatCommercial.js';
import { Fenetre } from './Fenetre.js';
import { Inbox } from './Inbox.js';

type InboxProps = Parameters<typeof Inbox>[0];
type Props = InboxProps & {
  // Appelé à la fermeture de la fenêtre de l'Inbox : l'écran remet à zéro l'ajout et le pas à pas.
  onFerme?: () => void;
};

// Le poste de pilotage : une synthèse (le brief du jour), avec l'Inbox repliée en un bandeau.
// L'Inbox complète s'ouvre dans une fenêtre quand on veut agir dessus.
export function Cockpit({ onFerme, ...props }: Props) {
  const { slug, onChange, ajoutOuvert, pasAPas } = props;
  const [ouvert, setOuvert] = useState(false);
  const [aTraiter, setATraiter] = useState<number | null>(null);

  const compter = useCallback(() => {
    fetchCompteurInbox(slug).then(setATraiter, () => setATraiter(null));
  }, [slug]);
  useEffect(compter, [compter]);
  // Le « + » et le « Pas à pas » de l'en-tête agissent sur l'Inbox : on l'ouvre pour eux.
  useEffect(() => {
    if (ajoutOuvert || pasAPas) setOuvert(true);
  }, [ajoutOuvert, pasAPas]);

  const fermer = () => {
    setOuvert(false);
    onFerme?.();
    compter();
  };

  return (
    <div className="cockpit">
      <header className="cockpit-intro">
        <h2 className="cockpit-date">
          {new Date().toLocaleDateString('fr-FR', {
            timeZone: 'Europe/Paris',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </h2>
        <p>Votre activité, vos priorités et vos actions du jour.</p>
      </header>
      <div className="cockpit-raccourcis">
        <section className={`cockpit-bandeau ${aTraiter === 0 ? 'vide' : ''}`} aria-label="Inbox">
          <span className="cockpit-bandeau-icone">
            <Icon name={aTraiter === 0 ? 'check' : 'inbox'} />
          </span>
          <span className="cockpit-bandeau-texte">
            <strong>Inbox</strong>
            <span>
              {aTraiter === null
                ? 'Chargement en cours'
                : aTraiter === 0
                  ? 'Inbox : rien à traiter'
                  : `Inbox : ${aTraiter} à traiter`}
            </span>
          </span>
          <button className="btn sm" onClick={() => setOuvert(true)}>
            Ouvrir
          </button>
        </section>
        <Enregistrements slug={slug} />
      </div>
      <section className="cockpit-brief" aria-label="Brief du jour">
        <Brief slug={slug}>
          <EtatCommercial slug={slug} />
          <AideRelance slug={slug} />
        </Brief>
      </section>
      {ouvert && (
        <Fenetre titre="Inbox" large onFermer={fermer}>
          <Inbox
            {...props}
            onChange={() => {
              compter();
              onChange?.();
            }}
          />
        </Fenetre>
      )}
    </div>
  );
}
