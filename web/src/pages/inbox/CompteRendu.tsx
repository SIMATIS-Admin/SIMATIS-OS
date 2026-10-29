import { useEffect, useState } from 'react';
import { fetchCandidatsRdv, type CandidatRdv, type SujetVue } from '../../api.js';

const NOUVEAU = '';

const quand = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

// Compte rendu écrit sans quitter l'Inbox : il va sur le rendez-vous, miroir de l'événement Google
// (ou créé dans l'OS s'il n'y a pas d'événement), puis l'entrée est traitée.
export function CompteRendu({
  slug,
  s,
  onEnregistrer,
}: {
  slug: string;
  s: SujetVue;
  onEnregistrer: (corps: { eventId?: string; texte: string }) => void;
}) {
  const [candidats, setCandidats] = useState<CandidatRdv[] | null>(null);
  const [choix, setChoix] = useState(NOUVEAU);
  const [texte, setTexte] = useState('');
  useEffect(() => {
    let actuel = true;
    fetchCandidatsRdv(slug, s.id).then(
      (c) => {
        if (!actuel) return;
        setCandidats(c);
        setChoix(c.find((x) => x.propose)?.eventId ?? NOUVEAU);
      },
      () => actuel && setCandidats([]),
    );
    return () => {
      actuel = false;
    };
  }, [slug, s.id]);
  const choisi = candidats?.find((c) => c.eventId === choix);
  return (
    <div className="stack" style={{ marginBottom: 12 }}>
      <label className="small muted" htmlFor={`cr-rdv-${s.id}`}>
        Rendez-vous
      </label>
      <select
        id={`cr-rdv-${s.id}`}
        className="input"
        aria-label="Rendez-vous du compte rendu"
        value={choix}
        onChange={(e) => setChoix(e.target.value)}
      >
        <option value={NOUVEAU}>Nouveau rendez-vous (sans événement Google)</option>
        {(candidats ?? []).map((c) => (
          <option key={c.eventId} value={c.eventId}>
            {c.titre} · {quand(c.debut)}
          </option>
        ))}
      </select>
      {choisi?.compteRendu && (
        <div className="small muted">Ce rendez-vous a déjà un compte rendu : il sera remplacé.</div>
      )}
      <textarea
        className="input"
        rows={6}
        aria-label="Compte rendu"
        placeholder="Compte rendu du rendez-vous"
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
      />
      <div className="decision">
        <button
          className="btn go"
          disabled={!texte.trim()}
          onClick={() => onEnregistrer({ ...(choix ? { eventId: choix } : {}), texte })}
        >
          Enregistrer le compte rendu
        </button>
      </div>
    </div>
  );
}
