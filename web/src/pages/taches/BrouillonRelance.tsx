import { useState } from 'react';
import {
  creerCampagneRelance,
  type CampagneProspection,
  type ReglageCampagne,
  type ResultatCampagne,
} from '../../api.js';
import { Modal } from '../Overlay.js';
import { Attente } from '../prospection/Attente.js';
import { Relecture } from '../prospection/Relecture.js';
import { Resultat } from '../prospection/Resultat.js';

type Phase =
  | { nom: 'saisie' }
  | { nom: 'attente'; id: string }
  | { nom: 'relecture'; campagne: CampagneProspection }
  | { nom: 'fin'; campagne: CampagneProspection; resultat: ResultatCampagne };

// Pas de signature (Marc signe lui-même) ; l'offre n'a pas de rôle pour une relance de tâche.
const reglage = (style: string, creneaux: boolean): ReglageCampagne => ({
  offre: 'vma',
  creneaux,
  signatureId: null,
  suivi: { type: 'courte' },
  touchesMax: 4,
  ...(style.trim() ? { style: style.trim() } : {}),
});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Brouillon de relance d'une tâche de mail : le même circuit que la Prospection (Claude rédige, Marc
// relit, l'OS dépose le brouillon dans la messagerie de l'instance), pour une seule tâche.
export function BrouillonRelance({
  slug,
  tacheId,
  contactId,
  tacheContactId,
}: {
  slug: string;
  tacheId: string;
  // Contact choisi dans la fenêtre ; transmis seulement s'il diffère de celui que la tâche porte.
  contactId: string | null;
  tacheContactId: string | null;
}) {
  const [phase, setPhase] = useState<Phase>({ nom: 'saisie' });
  const [style, setStyle] = useState('');
  const [creneaux, setCreneaux] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const lancer = () => {
    setEnCours(true);
    setErreur(null);
    const liens = contactId && contactId !== tacheContactId ? { [tacheId]: contactId } : {};
    creerCampagneRelance(slug, [tacheId], reglage(style, creneaux), liens)
      .then(
        (r) => setPhase({ nom: 'attente', id: r.campagneId }),
        (e: unknown) => setErreur(message(e)),
      )
      .finally(() => setEnCours(false));
  };

  if (phase.nom !== 'saisie') {
    return (
      <Modal large title="Brouillon de relance" onClose={() => setPhase({ nom: 'saisie' })}>
        {phase.nom === 'attente' && (
          <Attente
            slug={slug}
            id={phase.id}
            onPret={(campagne) =>
              setPhase(
                campagne.statut === 'terminee' ? { nom: 'saisie' } : { nom: 'relecture', campagne },
              )
            }
          />
        )}
        {phase.nom === 'relecture' && (
          <Relecture
            key={phase.campagne.id}
            slug={slug}
            campagne={phase.campagne}
            signatures={[]}
            onTermine={(resultat) => setPhase({ nom: 'fin', campagne: phase.campagne, resultat })}
          />
        )}
        {phase.nom === 'fin' && (
          <Resultat
            resultat={phase.resultat}
            onRetour={() => setPhase({ nom: 'saisie' })}
            onRevenir={() => setPhase({ nom: 'relecture', campagne: phase.campagne })}
          />
        )}
      </Modal>
    );
  }

  return (
    <section className="stack" style={{ gap: 8 }} aria-label="Brouillon de relance">
      <label className="field">
        <span>Contexte et style du brouillon</span>
        <textarea
          className="input"
          rows={3}
          placeholder="Ex. : suite au rendez-vous de mardi, ton court et chaleureux, rappeler la prochaine étape"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={creneaux} onChange={(e) => setCreneaux(e.target.checked)} />
        <span>Proposer 3 créneaux</span>
      </label>
      {erreur && (
        <p className="small" role="alert" style={{ color: 'var(--red)' }}>
          {erreur}
        </p>
      )}
      <div>
        <button type="button" className="btn" disabled={enCours} onClick={lancer}>
          Préparer un brouillon dans ma messagerie
        </button>
      </div>
    </section>
  );
}
