import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  createOpportunite,
  createTache,
  fetchPipeline,
  fetchRecherche,
  type Recherche,
} from '../api.js';
import { Icon } from '../icons.js';
import { NouveauContact } from '../pages/Contacts.js';
import { NouvelleEntreprise } from '../pages/Entreprises.js';
import { NouvelleAffaire } from '../pages/Pipeline.js';
import { EditionTache } from '../pages/taches/Edition.js';

// Pipedrive top bar: one search over deals, people and organisations, and a « + » quick add.

type Resultat = {
  kind: 'affaire' | 'contact' | 'entreprise';
  id: string;
  titre: string;
  sous: string;
};
type Ajout = 'affaire' | 'contact' | 'entreprise' | 'activite';
const AJOUTS: [Ajout, string][] = [
  ['affaire', 'Affaire'],
  ['contact', 'Personne'],
  ['entreprise', 'Organisation'],
  ['activite', 'Activité'],
];

const aplatir = (r: Recherche): [string, Resultat[]][] => [
  [
    'Affaires',
    r.affaires.map((a) => ({
      kind: 'affaire',
      id: a.id,
      titre: a.titre,
      sous: a.entreprise ?? '',
    })),
  ],
  [
    'Personnes',
    r.personnes.map((p) => ({ kind: 'contact', id: p.id, titre: p.nom, sous: p.entreprise ?? '' })),
  ],
  [
    'Organisations',
    r.organisations.map((o) => ({
      kind: 'entreprise',
      id: o.id,
      titre: o.nom,
      sous: o.ville ?? '',
    })),
  ],
];

export function Barre({ slug }: { slug: string }) {
  const [q, setQ] = useState('');
  const [groupes, setGroupes] = useState<[string, Resultat[]][] | null>(null);
  const [menu, setMenu] = useState(false);
  const [ajout, setAjout] = useState<Ajout | null>(null);
  const [premiereEtape, setPremiereEtape] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setGroupes(null);
    let vivant = true;
    const minuteur = window.setTimeout(() => {
      void fetchRecherche(slug, q.trim()).then(
        (r) => vivant && setGroupes(aplatir(r)),
        () => vivant && setGroupes(null),
      );
    }, 150);
    return () => {
      vivant = false;
      window.clearTimeout(minuteur);
    };
  }, [slug, q]);

  const ouvrir = (r: Resultat) => {
    setQ('');
    setGroupes(null);
    location.hash = `#/${slug}/fiche/${r.kind}/${r.id}`;
  };
  const touche = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setQ('');
    if (e.key === 'Enter') {
      const premier = groupes?.flatMap(([, l]) => l)[0];
      if (premier) ouvrir(premier);
    }
  };
  const choisir = (a: Ajout) => {
    setMenu(false);
    setMessage(null);
    if (a === 'affaire')
      void fetchPipeline(slug).then(
        (p) => {
          const etape = p.etapes[0]?.id;
          if (!etape) return setMessage('Aucune étape ouverte dans le pipeline.');
          setPremiereEtape(etape);
          setAjout('affaire');
        },
        (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
      );
    else setAjout(a);
  };
  const vides = groupes?.every(([, l]) => l.length === 0);

  return (
    <div className="barre">
      <div className="barre-recherche">
        <Icon name="search" />
        <input
          className="input"
          type="search"
          aria-label="Recherche globale"
          placeholder="Rechercher affaires, personnes, organisations…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={touche}
        />
        {groupes && (
          <div className="barre-resultats" role="listbox">
            {vides && <p className="small muted">Aucun résultat.</p>}
            {groupes.map(([titre, liste]) =>
              liste.length ? (
                <div key={titre}>
                  <h4>{titre}</h4>
                  {liste.map((r) => (
                    <button
                      key={`${r.kind}-${r.id}`}
                      role="option"
                      aria-selected={false}
                      className="barre-resultat"
                      onClick={() => ouvrir(r)}
                    >
                      <b>{r.titre}</b> {r.sous && <span className="small muted">{r.sous}</span>}
                    </button>
                  ))}
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
      <div className="barre-ajout">
        <button
          className="btn primary"
          aria-label="Ajout rapide"
          title="Ajouter"
          onClick={() => setMenu(!menu)}
        >
          +
        </button>
        {menu && (
          <div className="tb-menu" role="menu">
            {AJOUTS.map(([a, l]) => (
              <button key={a} role="menuitem" className="barre-resultat" onClick={() => choisir(a)}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
      {message && (
        <span className="small" style={{ color: 'var(--red)' }}>
          {message}
        </span>
      )}
      {ajout === 'affaire' && premiereEtape && (
        <NouvelleAffaire
          slug={slug}
          etape="première étape du pipeline"
          onClose={() => setAjout(null)}
          onSave={async (saisie) => {
            const r = await createOpportunite(slug, { ...saisie, etape: premiereEtape });
            setAjout(null);
            if ('simulation' in r) setMessage(r.message);
            else location.hash = `#/${slug}/fiche/affaire/${r.id}`;
          }}
        />
      )}
      {ajout === 'contact' && (
        <NouveauContact
          slug={slug}
          onClose={() => setAjout(null)}
          onCreated={(id) => {
            setAjout(null);
            location.hash = `#/${slug}/fiche/contact/${id}`;
          }}
        />
      )}
      {ajout === 'entreprise' && (
        <NouvelleEntreprise
          slug={slug}
          onClose={() => setAjout(null)}
          onCreated={(id) => {
            setAjout(null);
            location.hash = `#/${slug}/fiche/entreprise/${id}`;
          }}
        />
      )}
      {ajout === 'activite' && (
        <EditionTache
          tache={null}
          hubspot={false}
          slug={slug}
          onClose={() => setAjout(null)}
          onSave={async ({ hubspot, ...saisie }) => {
            const r = await createTache(slug, { ...saisie, hubspot });
            setAjout(null);
            if ('simulation' in r) setMessage(r.message);
            else location.hash = `#/${slug}/taches`;
          }}
        />
      )}
    </div>
  );
}
