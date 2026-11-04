import { useEffect, useState } from 'react';
import {
  lancerEnrichissement,
  lireEnrichissement,
  suggestionsEnrichissement,
  validerEnrichissement,
  type LigneEnrichissement,
  type SuggestionEnrichissement,
  type TacheEnrichissement,
} from '../api.js';
import { Fenetre } from './Fenetre.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function LancerEnrichissement({
  slug,
  ficheIds,
  lotMax,
  onFermer,
  onLance,
}: {
  slug: string;
  ficheIds: string[];
  lotMax: number;
  onFermer: () => void;
  onLance: (tacheId: string) => void;
}) {
  const [occupe, setOccupe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trop = ficheIds.length > lotMax;
  const pret = !trop && ficheIds.length > 0;

  const lancer = async () => {
    setOccupe(true);
    setError(null);
    try {
      const tache = await lancerEnrichissement(slug, {
        type: 'contacts',
        profil: ['Dirigeant'],
        maxParEntreprise: 1,
        ficheIds,
      });
      onLance(tache.id);
    } catch (e) {
      setError(message(e));
      setOccupe(false);
    }
  };

  return (
    <Fenetre
      titre="Enrichir avec l'IA"
      onFermer={onFermer}
      pied={
        <>
          <button className="btn" onClick={onFermer}>
            Annuler
          </button>
          <button className="btn primary" disabled={!pret || occupe} onClick={() => void lancer()}>
            Lancer sur {ficheIds.length} fiche{ficheIds.length > 1 ? 's' : ''}
          </button>
        </>
      }
    >
      <div className="bv-enrichir">
        <p>
          Codex recherche un dirigeant si la fiche contient uniquement une entreprise. Si un contact
          figure déjà sur la fiche, Codex recherche les coordonnées de cette personne.
        </p>
        <p>
          Pour chaque contact, Codex cherche son e-mail professionnel, son téléphone et son profil
          LinkedIn.
        </p>
        {trop && (
          <p className="error">
            Un lot est limité à {lotMax} fiches : désélectionnez-en {ficheIds.length - lotMax}.
          </p>
        )}
        <p className="small muted">
          Codex recherche sur le web public depuis le Mac connecté. Vous choisissez ensuite les
          suggestions à appliquer à vos fiches.
        </p>
        {error && <p className="error">{error}</p>}
      </div>
    </Fenetre>
  );
}

const nomDe = (s: SuggestionEnrichissement) =>
  [s.prenom, s.nom].filter(Boolean).join(' ') || '(nom inconnu)';

export function SuggestionsEnrichissement({
  slug,
  tacheId,
  onFini,
}: {
  slug: string;
  tacheId: string;
  onFini: () => void;
}) {
  const [tache, setTache] = useState<TacheEnrichissement | null>(null);
  const [lignes, setLignes] = useState<LigneEnrichissement[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionEnrichissement[] | null>(null);
  const [gardees, setGardees] = useState<Set<string>>(new Set());
  const [occupe, setOccupe] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const lire = async () => {
      try {
        const etat = await lireEnrichissement(slug, tacheId);
        if (!actif) return;
        setTache(etat.tache);
        setLignes(etat.lignes);
        if (etat.tache.etat === 'en_cours') {
          minuteur = setTimeout(() => void lire(), 2000);
          return;
        }
        const liste = (await suggestionsEnrichissement(slug, tacheId)).filter(
          (s) => s.etat === 'a_valider',
        );
        if (!actif) return;
        setSuggestions(liste);
        // Un mail simplement déduit n'est jamais coché d'office.
        setGardees(new Set(liste.filter((s) => s.modeEmail !== 'deduit').map((s) => s.id)));
      } catch (e) {
        if (actif) setError(message(e));
      }
    };
    void lire();
    return () => {
      actif = false;
      clearTimeout(minuteur);
    };
  }, [slug, tacheId]);

  const valider = async () => {
    if (!suggestions) return;
    setOccupe(true);
    setError(null);
    try {
      await validerEnrichissement(
        slug,
        tacheId,
        suggestions.filter((s) => gardees.has(s.id)).map((s) => s.id),
        suggestions.filter((s) => !gardees.has(s.id)).map((s) => s.id),
      );
      onFini();
    } catch (e) {
      setError(message(e));
      setOccupe(false);
    }
  };

  const ecartees = lignes.filter((l) => l.etat === 'ignoree' || l.etat === 'echec');
  const parEntreprise = new Map<string, SuggestionEnrichissement[]>();
  for (const s of suggestions ?? [])
    parEntreprise.set(s.entreprise, [...(parEntreprise.get(s.entreprise) ?? []), s]);

  return (
    <Fenetre
      titre="Suggestions de l'enrichissement"
      tiroir
      onFermer={onFini}
      pied={
        <>
          <button className="btn" onClick={onFini}>
            Fermer
          </button>
          {suggestions && suggestions.length > 0 && (
            <button className="btn primary" disabled={occupe} onClick={() => void valider()}>
              Valider la sélection
            </button>
          )}
        </>
      }
    >
      {error && <p className="error">{error}</p>}
      {!tache && !error && <p className="muted">Chargement…</p>}
      {tache?.etat === 'en_cours' && (
        <p className="muted">
          Recherche en cours :{' '}
          {lignes.filter((l) => l.etat === 'terminee' || l.etat === 'echec').length} /{' '}
          {lignes.filter((l) => l.etat !== 'ignoree').length} fiches traitées…
        </p>
      )}
      {tache?.etat === 'interrompue' && (
        <p className="error">Enrichissement interrompu : {tache.erreur}</p>
      )}
      {suggestions && suggestions.length === 0 && tache?.etat === 'terminee' && (
        <p className="muted">Aucun contact trouvé pour ce lot.</p>
      )}
      {[...parEntreprise].map(([entreprise, liste]) => (
        <section key={entreprise} className="bv-sugg-groupe">
          <h3 className="bv-sous-titre">{entreprise}</h3>
          {liste[0]?.contactExistant && (
            <p className="small muted">Contact déjà connu : {liste[0].contactExistant}</p>
          )}
          <ul className="bv-sugg">
            {liste.map((s) => (
              <li key={s.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Garder ${nomDe(s)}`}
                    checked={gardees.has(s.id)}
                    onChange={() =>
                      setGardees((g) => {
                        const n = new Set(g);
                        if (!n.delete(s.id)) n.add(s.id);
                        return n;
                      })
                    }
                  />{' '}
                  <strong>{nomDe(s)}</strong>
                  {s.fonction ? ` · ${s.fonction}` : ''}
                </label>
                <div className="small">
                  {s.email && (
                    <span>
                      {s.email}{' '}
                      {s.modeEmail === 'deduit' && <span className="badge amber">déduit</span>}
                    </span>
                  )}
                  {s.emailEntreprise && (
                    <span> · E-mail de l’entreprise : {s.emailEntreprise}</span>
                  )}
                  {s.telephone && <span> · {s.telephone}</span>}
                  {s.linkedin && (
                    <>
                      {' · '}
                      <a href={s.linkedin} target="_blank" rel="noopener noreferrer">
                        Profil LinkedIn
                      </a>
                    </>
                  )}
                  {s.sourceUrl ? (
                    <>
                      {' · '}
                      <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
                        Source
                      </a>
                    </>
                  ) : (
                    <span className="muted"> · sans source</span>
                  )}
                  <span className="muted"> · confiance {s.confiance}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {ecartees.length > 0 && (
        <section>
          <h3 className="bv-sous-titre">Fiches non traitées</h3>
          <ul className="small">
            {ecartees.map((l) => (
              <li key={l.id}>
                {l.entreprise} : {l.raison ?? 'échec'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Fenetre>
  );
}
