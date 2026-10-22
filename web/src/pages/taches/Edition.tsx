import { useCallback, useEffect, useState } from 'react';
import {
  fetchContacts,
  fetchEntreprises,
  fetchOpportunitesRecherche,
  type TacheSaisie,
  type TacheVue,
} from '../../api.js';
import { Icon } from '../../icons.js';
import { typeActivite } from '../../../../src/crm/type-tache.js';
import { Modal } from '../Overlay.js';
import { ACTIVITES, ORDRE_ACTIVITES, plusJours } from './commun.js';
import { heureParis, jourParis, memeHeure, parisVersIso } from './creneaux.js';

type Type = TacheVue['type'];
const DUREES = [15, 30, 45, 60, 90, 120, 180, 240, 480];
const duree = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`.replace('.5', ' h 30'));

function Types({ type, onChoix }: { type: Type; onChoix: (t: Type) => void }) {
  return (
    <div className="types-activite" role="group" aria-label="Type">
      {ORDRE_ACTIVITES.map((t) => {
        const [ico, lbl] = ACTIVITES[t];
        return (
          <button
            key={t}
            type="button"
            className={`chip ${type === t ? 'on' : ''}`}
            aria-pressed={type === t}
            aria-label={lbl}
            title={lbl}
            onClick={() => onChoix(t)}
          >
            <Icon name={ico} />
          </button>
        );
      })}
    </div>
  );
}

// The type follows the title until the pilot clicks one (Pipedrive: chosen in one click).
function useType(titre: string, initial: Type | null) {
  const [choisi, setChoisi] = useState<Type | null>(initial);
  return { type: choisi ?? typeActivite(titre), choisi, choisir: setChoisi };
}

export type Enregistrement = TacheSaisie & { hubspot: boolean };

type Choix = { id: string; nom: string } | null;

// Person, company or deal of an activity or a meeting, found by search (Pipedrive window).
export function Lien({
  label,
  chercher,
  choix,
  onChoix,
}: {
  label: string;
  chercher: (q: string) => Promise<{ id: string; nom: string }[]>;
  choix: Choix;
  onChoix: (c: Choix) => void;
}) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ id: string; nom: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    let vivant = true;
    void chercher(q).then(
      (r) => vivant && setRes(r.slice(0, 6)),
      () => vivant && setRes([]),
    );
    return () => {
      vivant = false;
    };
  }, [q, chercher]);
  return (
    <div className="field">
      <span>{label}</span>
      {choix ? (
        <span>
          {choix.nom}{' '}
          <button type="button" className="lien" onClick={() => onChoix(null)}>
            changer
          </button>
        </span>
      ) : (
        <>
          <input
            className="input"
            aria-label={label}
            placeholder="Rechercher…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {res.map((r) => (
            <button
              key={r.id}
              type="button"
              className="lien fi-resultat"
              onClick={() => onChoix(r)}
            >
              {r.nom}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// Create (no task) or edit an activity; `hubspot` shows the "Créer aussi dans HubSpot" box.
export function EditionTache({
  tache,
  hubspot,
  slug,
  initial,
  onSave,
  onClose,
}: {
  tache: TacheVue | null;
  hubspot: boolean;
  // Given for a new activity whose person and deal are chosen here (not from a detail page).
  slug?: string;
  // New activity prefilled from something to handle (an Inbox subject).
  initial?: { titre: string; echeance: string | null; contact: { id: string; nom: string } | null };
  onSave: (saisie: Enregistrement) => Promise<void>;
  onClose: () => void;
}) {
  const [titre, setTitre] = useState(tache?.titre ?? initial?.titre ?? '');
  const echeanceInitiale = tache?.echeance ?? initial?.echeance ?? null;
  const { type, choisi, choisir } = useType(titre, null);
  const [jour, setJour] = useState(echeanceInitiale ? jourParis(echeanceInitiale) : '');
  const [avecHeure, setAvecHeure] = useState(tache?.avecHeure ?? false);
  const [heure, setHeure] = useState(
    tache?.echeance && tache.avecHeure ? heureParis(tache.echeance) : '09:00',
  );
  const [minutes, setMinutes] = useState(tache?.dureeMinutes ?? 30);
  const [occupe, setOccupe] = useState(tache?.occupe ?? false);
  const [notes, setNotes] = useState(tache?.notes ?? '');
  const [fait, setFait] = useState(tache?.fait ?? false);
  const [versHubspot, setVersHubspot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const personneInitiale = tache?.contact ?? initial?.contact ?? null;
  const entrepriseInitiale = tache?.entreprise ?? null;
  const [personne, setPersonne] = useState<Choix>(personneInitiale);
  const [entreprise, setEntreprise] = useState<Choix>(entrepriseInitiale);
  const [affaire, setAffaire] = useState<Choix>(null);
  const chercherEntreprise = useCallback(
    (q: string) =>
      slug
        ? fetchEntreprises(slug, q).then((r) => r.map((e) => ({ id: e.id, nom: e.nom })))
        : Promise.resolve([]),
    [slug],
  );
  const chercherPersonne = useCallback(
    (q: string) =>
      slug
        ? fetchContacts(slug, q).then((r) => r.map((c) => ({ id: c.id, nom: c.nom })))
        : Promise.resolve([]),
    [slug],
  );
  const chercherAffaire = useCallback(
    (q: string) =>
      slug
        ? fetchOpportunitesRecherche(slug, q).then((r) =>
            r.map((o) => ({
              id: o.id,
              nom: o.entreprise ? `${o.titre} · ${o.entreprise}` : o.titre,
            })),
          )
        : Promise.resolve([]),
    [slug],
  );
  const typeAffiche = choisi ?? (tache && !titreModifie(tache, titre) ? tache.type : type);

  // Without a precise time, a HubSpot task keeps its own time on the new day.
  const echeance = !jour
    ? null
    : avecHeure
      ? parisVersIso(jour, heure)
      : memeHeure(echeanceInitiale, jour);

  const submit = () => {
    setBusy(true);
    setError(null);
    onSave({
      titre: titre.trim(),
      notes: notes.trim() ? notes : null,
      echeance,
      avecHeure,
      ...(avecHeure ? { dureeMinutes: minutes, occupe } : {}),
      ...(choisi ? { type: choisi } : {}),
      ...(tache ? { fait } : {}),
      // A new activity takes the links chosen; an edit sends only those that changed.
      ...(tache
        ? {
            ...(personne?.id !== personneInitiale?.id ? { contactId: personne?.id ?? null } : {}),
            ...(entreprise?.id !== entrepriseInitiale?.id
              ? { entrepriseId: entreprise?.id ?? null }
              : {}),
          }
        : {
            ...(personne ? { contactId: personne.id } : {}),
            ...(entreprise ? { entrepriseId: entreprise.id } : {}),
            ...(affaire ? { opportuniteId: affaire.id } : {}),
          }),
      hubspot: versHubspot,
    })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal title={tache ? "Modifier l'activité" : 'Nouvelle activité'} onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        <label className="field">
          <span>Intitulé</span>
          <input className="input" value={titre} onChange={(e) => setTitre(e.target.value)} />
        </label>
        <Types type={typeAffiche} onChoix={choisir} />
        <div className="grid g2">
          <label className="field">
            <span>Date</span>
            <input
              className="input"
              type="date"
              value={jour}
              onChange={(e) => setJour(e.target.value)}
            />
          </label>
          <label className="check" style={{ alignSelf: 'end' }}>
            <input
              type="checkbox"
              checked={avecHeure}
              onChange={(e) => setAvecHeure(e.target.checked)}
            />
            <span>Heure précise</span>
          </label>
        </div>
        {avecHeure && (
          <div className="grid g2">
            <label className="field">
              <span>Heure</span>
              <input
                className="input"
                type="time"
                value={heure}
                onChange={(e) => setHeure(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Durée</span>
              <select
                className="input"
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              >
                {DUREES.map((m) => (
                  <option key={m} value={m}>
                    {duree(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={occupe}
                onChange={(e) => setOccupe(e.target.checked)}
              />
              <span>Occupé</span>
            </label>
          </div>
        )}
        <label className="field">
          <span>Notes</span>
          <textarea
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {tache && (
          <label className="check">
            <input type="checkbox" checked={fait} onChange={(e) => setFait(e.target.checked)} />
            <span>Faite</span>
          </label>
        )}
        {tache && (!slug ? tache.contact || tache.opportunite : tache.opportunite) && (
          <p className="small muted">
            {(slug ? [tache.opportunite?.titre] : [tache.contact?.nom, tache.opportunite?.titre])
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {slug && (
          <div className="grid g2">
            <Lien
              label="Contact"
              chercher={chercherPersonne}
              choix={personne}
              onChoix={setPersonne}
            />
            <Lien
              label="Entreprise"
              chercher={chercherEntreprise}
              choix={entreprise}
              onChoix={setEntreprise}
            />
            {!tache && (
              <Lien
                label="Affaire"
                chercher={chercherAffaire}
                choix={affaire}
                onChoix={setAffaire}
              />
            )}
          </div>
        )}
        {!tache && hubspot && (
          <label className="check">
            <input
              type="checkbox"
              checked={versHubspot}
              onChange={(e) => setVersHubspot(e.target.checked)}
            />
            <span>Créer aussi dans HubSpot</span>
          </label>
        )}
        {error && (
          <p className="small" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}
        <div>
          <button className="btn primary" disabled={busy || !titre.trim()} onClick={submit}>
            {tache ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const titreModifie = (t: TacheVue, titre: string) => t.titre !== titre;

// "Et ensuite ?" (Pipedrive): right after an activity is done, plan the next one on the same
// contact and deal; same type, in 7 days, without a precise time.
export function Ensuite({
  apres,
  hubspot,
  onPlanifier,
  onFermer,
}: {
  apres: TacheVue;
  hubspot: boolean;
  onPlanifier: (saisie: Enregistrement) => Promise<void>;
  onFermer: (plusJamais: boolean) => void;
}) {
  const [titre, setTitre] = useState('');
  const { choisi, choisir } = useType(titre, apres.type);
  const [jour, setJour] = useState(() => plusJours(jourParis(new Date().toISOString()), 7));
  const [versHubspot, setVersHubspot] = useState(apres.origine === 'hubspot');
  const [plusJamais, setPlusJamais] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = choisi ?? apres.type;

  const planifier = () => {
    setError(null);
    onPlanifier({
      titre: titre.trim(),
      type,
      echeance: parisVersIso(jour, '09:00'),
      avecHeure: false,
      contactId: apres.contact?.id ?? null,
      opportuniteId: apres.opportunite?.id ?? null,
      hubspot: hubspot && versHubspot,
    })
      .then(() => onFermer(plusJamais))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <Modal title="Et ensuite ?" onClose={() => onFermer(plusJamais)}>
      <div className="stack" style={{ gap: 10 }}>
        <p className="small muted">
          « {apres.titre} » est faite.
          {apres.contact || apres.opportunite
            ? ` Prochaine étape avec ${[apres.contact?.nom, apres.opportunite?.titre].filter(Boolean).join(' · ')} :`
            : ' Prochaine étape :'}
        </p>
        <label className="field">
          <span>Intitulé</span>
          <input className="input" value={titre} onChange={(e) => setTitre(e.target.value)} />
        </label>
        <Types type={type} onChoix={choisir} />
        <label className="field">
          <span>Date</span>
          <input
            className="input"
            type="date"
            value={jour}
            onChange={(e) => setJour(e.target.value)}
          />
        </label>
        {hubspot && (
          <label className="check">
            <input
              type="checkbox"
              checked={versHubspot}
              onChange={(e) => setVersHubspot(e.target.checked)}
            />
            <span>Créer aussi dans HubSpot</span>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={plusJamais}
            onChange={(e) => setPlusJamais(e.target.checked)}
          />
          <span>Ne plus me proposer</span>
        </label>
        {error && (
          <p className="small" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}
        <div className="decision">
          <button className="btn primary" disabled={!titre.trim() || !jour} onClick={planifier}>
            Planifier
          </button>
          <button className="btn" onClick={() => onFermer(plusJamais)}>
            Pas maintenant
          </button>
        </div>
      </div>
    </Modal>
  );
}
