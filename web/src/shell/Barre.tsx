import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  createOpportunite,
  createTache,
  fetchPipeline,
  fetchDroitTransfert,
  fetchRecherche,
  fetchRechercheMandats,
  type Recherche,
  type RechercheMandat,
} from '../api.js';
import { Icon } from '../icons.js';
import { NouveauContact } from '../pages/Contacts.js';
import { NouvelleEntreprise } from '../pages/Entreprises.js';
import { NouvelleAffaire } from '../pages/Pipeline.js';
import { PastilleInstance } from '../pages/transfert/PastilleInstance.js';
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
  ['contact', 'Contact'],
  ['entreprise', 'Organisation'],
  ['activite', 'Activité'],
];

const aplatir = (
  r: Pick<Recherche, 'affaires' | 'personnes' | 'organisations'>,
): [string, Resultat[]][] => [
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
    'Contacts',
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
  // Own instance only: the mandates are searched when asked, read only.
  const [droit, setDroit] = useState(false);
  const [mandats, setMandats] = useState(false);
  const [parMandat, setParMandat] = useState<RechercheMandat[]>([]);
  const [nonLus, setNonLus] = useState<string[]>([]);
  const [panne, setPanne] = useState(false);
  const [relance, setRelance] = useState(0);

  useEffect(() => {
    let vivant = true;
    fetchDroitTransfert(slug).then(
      (d) => vivant && setDroit(d.autorise === true),
      () => vivant && setDroit(false),
    );
    return () => {
      vivant = false;
    };
  }, [slug]);

  useEffect(() => {
    // Results of the previous text must not stay next to the new one.
    setParMandat([]);
    setNonLus([]);
    if (!droit || !mandats || q.trim().length < 2) return;
    let vivant = true;
    const minuteur = window.setTimeout(() => {
      void fetchRechercheMandats(slug, q.trim()).then(
        (r) => {
          if (!vivant) return;
          setParMandat(r.mandats ?? []);
          setNonLus(r.echecs ?? []);
        },
        () => vivant && setParMandat([]),
      );
    }, 150);
    return () => {
      vivant = false;
      window.clearTimeout(minuteur);
    };
  }, [slug, q, droit, mandats, relance]);

  useEffect(() => {
    if (q.trim().length < 2) return setGroupes(null);
    let vivant = true;
    const minuteur = window.setTimeout(() => {
      void fetchRecherche(slug, q.trim()).then(
        (r) => {
          if (!vivant) return;
          setPanne(false);
          setGroupes(aplatir(r));
        },
        () => {
          // The panel stays, so the mandates can still be searched.
          if (!vivant) return;
          setPanne(true);
          setGroupes([]);
        },
      );
    }, 150);
    return () => {
      vivant = false;
      window.clearTimeout(minuteur);
    };
  }, [slug, q, relance]);

  const ouvrir = (r: Resultat, instance = slug) => {
    setQ('');
    setGroupes(null);
    location.hash = `#/${instance}/fiche/${r.kind}/${r.id}`;
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
            {droit && (
              <label className="barre-mandats small">
                <input
                  type="checkbox"
                  checked={mandats}
                  onChange={(e) => setMandats(e.target.checked)}
                />{' '}
                Inclure les mandats
              </label>
            )}
            {panne && <p className="small muted">La recherche dans cette instance a échoué.</p>}
            {vides && !panne && parMandat.length === 0 && (
              <p className="small muted">Aucun résultat.</p>
            )}
            {nonLus.length > 0 && (
              <p className="small barre-echecs" role="status">
                Mandats non lus : {nonLus.join(', ')}.
              </p>
            )}
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
            {parMandat.map((m) => (
              <div key={m.instance.slug}>
                <h4>{m.instance.nom}</h4>
                {aplatir(m)
                  .flatMap(([, liste]) => liste)
                  .map((r) => (
                    <div
                      key={`${m.instance.slug}-${r.kind}-${r.id}`}
                      className="barre-resultat-ligne"
                    >
                      <button
                        role="option"
                        aria-selected={false}
                        className="barre-resultat"
                        onClick={() => ouvrir(r, m.instance.slug)}
                      >
                        <b>{r.titre}</b> {r.sous && <span className="small muted">{r.sous}</span>}
                      </button>
                      <PastilleInstance
                        slug={slug}
                        instance={m.instance}
                        autorise
                        objet={{ type: r.kind, id: r.id }}
                        onTransfere={() => setRelance((n) => n + 1)}
                      />
                    </div>
                  ))}
              </div>
            ))}
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
            else location.hash = `#/${slug}/agenda`;
          }}
        />
      )}
    </div>
  );
}
