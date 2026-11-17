import { useEffect, useState } from 'react';
import {
  creerVisio,
  fetchEntreprises,
  fetchHoteVisio,
  type Entreprise,
  type VisioCreee,
} from '../api.js';
import { titreVisio } from '../../../src/visio/nomenclature.js';
import { Fenetre } from './Fenetre.js';

const DUREES = [15, 30, 45, 60, 90, 120];
const MOTIFS = ['Restitution', 'Point d’étape'];

const messageGoogle = (r: VisioCreee) =>
  r.google === 'ok'
    ? 'Visio créée : l’invitation est partie dans l’agenda des invités.'
    : r.google === 'simulation'
      ? 'Simulation : aucune invitation envoyée, aucun lien créé. Le rendez-vous existe dans l’OS.'
      : r.google === 'indisponible'
        ? 'Google Agenda n’est pas branché : le rendez-vous existe dans l’OS, sans lien.'
        : 'Visio non créée dans Google : le rendez-vous existe dans l’OS, sans lien ni invitation.';

// Rendez-vous en visio : l'entreprise et le motif donnent le titre (V - Client x Hôte - Motif),
// Google Agenda crée le lien Meet et prévient les invités.
export function NouvelleVisio({ slug, onFermer }: { slug: string; onFermer: () => void }) {
  const [recherche, setRecherche] = useState('');
  const [trouvees, setTrouvees] = useState<Entreprise[]>([]);
  const [entreprise, setEntreprise] = useState<{ id: string; nom: string } | null>(null);
  const [motif, setMotif] = useState('');
  const [date, setDate] = useState('');
  const [heure, setHeure] = useState('');
  const [duree, setDuree] = useState(60);
  const [invites, setInvites] = useState('');
  const [hote, setHote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [cree, setCree] = useState<VisioCreee | null>(null);

  useEffect(() => {
    fetchHoteVisio().then(
      (r) => setHote(r.hote),
      () => setHote(''),
    );
  }, []);
  useEffect(() => {
    if (entreprise || recherche.trim().length < 2) return setTrouvees([]);
    let actuel = true;
    fetchEntreprises(slug, recherche.trim()).then(
      (r) => actuel && setTrouvees(r.slice(0, 6)),
      () => actuel && setTrouvees([]),
    );
    return () => {
      actuel = false;
    };
  }, [slug, recherche, entreprise]);

  const adresses = invites
    .split(/[\s,;]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  const apercu =
    entreprise && hote ? titreVisio({ entreprise: entreprise.nom, hote, motif }) : null;
  const pret = !!entreprise && date !== '' && heure !== '';

  const creer = () => {
    if (!entreprise) return;
    const debut = new Date(`${date}T${heure}`);
    if (Number.isNaN(debut.getTime())) return setErreur('Date ou heure invalide.');
    setErreur(null);
    setEnvoi(true);
    creerVisio(slug, {
      entrepriseId: entreprise.id,
      motif: motif.trim() || null,
      debut: debut.toISOString(),
      dureeMinutes: duree,
      invites: adresses,
    }).then(
      (r) => {
        setCree(r);
        setEnvoi(false);
      },
      (e: unknown) => {
        setErreur(e instanceof Error ? e.message : String(e));
        setEnvoi(false);
      },
    );
  };

  if (cree) {
    return (
      <Fenetre
        titre="Visio préparée"
        sousTitre={cree.titre}
        onFermer={onFermer}
        pied={
          <button
            className="btn primary"
            onClick={() => {
              location.hash = `#/${slug}/fiche/rdv/${encodeURIComponent(cree.id)}`;
            }}
          >
            Ouvrir la fiche
          </button>
        }
      >
        <div className="stack">
          <p>{messageGoogle(cree)}</p>
          {cree.lienVisio && <p>{cree.lienVisio}</p>}
        </div>
      </Fenetre>
    );
  }
  return (
    <Fenetre
      titre="Nouvelle visio"
      sousTitre="Google Agenda crée le lien Meet et prévient les invités, une fois l’écriture réelle activée."
      onFermer={onFermer}
      pied={
        <>
          <button className="btn" onClick={onFermer}>
            Annuler
          </button>
          <button className="btn primary" disabled={!pret || envoi} onClick={creer}>
            Créer la visio
          </button>
        </>
      }
    >
      <div className="stack">
        <label>
          Entreprise
          <input
            className="input"
            value={entreprise ? entreprise.nom : recherche}
            onChange={(e) => {
              setEntreprise(null);
              setRecherche(e.target.value);
            }}
          />
        </label>
        {trouvees.length > 0 && (
          <div className="stack">
            {trouvees.map((e) => (
              <button key={e.id} className="btn" onClick={() => setEntreprise(e)}>
                {e.nom}
              </button>
            ))}
          </div>
        )}
        <label>
          Motif
          <input
            className="input"
            list="motifs-visio"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
          <datalist id="motifs-visio">
            {MOTIFS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        {apercu && (
          <p className="small muted">
            Titre : <strong>{apercu}</strong>
          </p>
        )}
        <div className="grid g2">
          <label>
            Date
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Heure
            <input
              className="input"
              type="time"
              value={heure}
              onChange={(e) => setHeure(e.target.value)}
            />
          </label>
        </div>
        <label>
          Durée
          <select
            className="input"
            value={duree}
            onChange={(e) => setDuree(Number(e.target.value))}
          >
            {DUREES.map((d) => (
              <option key={d} value={d}>
                {d} min
              </option>
            ))}
          </select>
        </label>
        <label>
          Invités
          <input
            className="input"
            placeholder="adresses séparées par une virgule"
            value={invites}
            onChange={(e) => setInvites(e.target.value)}
          />
        </label>
        {erreur && <p style={{ color: 'var(--red)' }}>{erreur}</p>}
      </div>
    </Fenetre>
  );
}
