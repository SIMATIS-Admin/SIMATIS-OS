import { useCallback, useEffect, useState } from 'react';
import { fetchCompteurInbox } from '../api.js';
import { Icon } from '../icons.js';
import { Brief } from './Brief.js';
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
      <section className={`cockpit-bandeau ${aTraiter === 0 ? 'vide' : ''}`} aria-label="Inbox">
        <Icon name={aTraiter === 0 ? 'check' : 'inbox'} />
        <span>
          {aTraiter === null
            ? 'Inbox'
            : aTraiter === 0
              ? 'Inbox : rien à traiter'
              : `Inbox : ${aTraiter} à traiter`}
        </span>
        <button className="btn sm" onClick={() => setOuvert(true)}>
          Ouvrir
        </button>
      </section>
      <section className="cockpit-brief" aria-label="Brief du jour">
        <Brief slug={slug} />
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
