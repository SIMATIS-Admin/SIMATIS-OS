import { useEffect, useState } from 'react';
import {
  createOpportunite,
  definirPrincipal,
  delierFiche,
  fetchContacts,
  fetchEntreprises,
  fetchOpportunitesRecherche,
  fetchPipeline,
  lierFiche,
  type KindFiche,
  type RefFiche,
} from '../../api.js';
import { Icon } from '../../icons.js';
import { NouveauContact } from '../Contacts.js';
import { NouvelleEntreprise } from '../Entreprises.js';
import { NouvelleAffaire } from '../Pipeline.js';

export type LigneLien = { id: string; nom: string; principal: boolean; detail?: string };

const lien = (slug: string, kind: KindFiche, id: string) => `#/${slug}/fiche/${kind}/${id}`;
const initiales = (nom: string) =>
  nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase())
    .join('');
const simulation = (r: unknown): r is { simulation: true; message: string } =>
  typeof r === 'object' && r !== null && 'simulation' in r;

async function chercher(slug: string, kind: KindFiche, q: string) {
  if (kind === 'contact')
    return (await fetchContacts(slug, q)).map((c) => ({ id: c.id, nom: c.nom }));
  if (kind === 'entreprise')
    return (await fetchEntreprises(slug, q)).map((e) => ({ id: e.id, nom: e.nom }));
  return (await fetchOpportunitesRecherche(slug, q)).map((o) => ({ id: o.id, nom: o.titre }));
}

export function LierExistant({
  slug,
  kind,
  exclus,
  onChoix,
}: {
  slug: string;
  kind: KindFiche;
  exclus: string[];
  onChoix: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState<{ id: string; nom: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setResultats([]);
    void chercher(slug, kind, q).then(
      (r) => setResultats(r.filter((x) => !exclus.includes(x.id)).slice(0, 8)),
      () => setResultats([]),
    );
  }, [slug, kind, q, exclus]);
  return (
    <div className="fi-lier">
      <input
        className="input"
        aria-label="Rechercher à lier"
        placeholder="Rechercher…"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
      />
      {resultats.map((r) => (
        <button key={r.id} className="lien fi-resultat" onClick={() => onChoix(r.id)}>
          {r.nom}
        </button>
      ))}
    </div>
  );
}

// A deal is created in the first stage of the pipeline; the person can move it afterwards.
function CreerAffaire({
  slug,
  de,
  onClose,
  onFait,
}: {
  slug: string;
  de: RefFiche;
  onClose: () => void;
  onFait: (r: unknown) => void;
}) {
  const [etape, setEtape] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    void fetchPipeline(slug).then(
      (p) => setEtape(p.etapes[0] ?? null),
      () => setEtape(null),
    );
  }, [slug]);
  if (!etape) return null;
  return (
    <NouvelleAffaire
      slug={slug}
      etape={etape.label}
      onClose={onClose}
      onSave={async (saisie) =>
        onFait(await createOpportunite(slug, { ...saisie, etape: etape.id, lierA: de }))
      }
    />
  );
}

// Card of the links of a record (HubSpot « + Add »): create a linked record, link an existing one,
// unlink, and choose the primary one when the record owns it.
export function CarteLiens({
  slug,
  titre,
  kind,
  de,
  lignes,
  ecrit,
  principalGerable,
  onChange,
  onMessage,
}: {
  slug: string;
  titre: string;
  kind: KindFiche;
  de: RefFiche;
  lignes: LigneLien[];
  ecrit: boolean;
  principalGerable: boolean;
  onChange: () => void;
  onMessage: (message: string | null) => void;
}) {
  const [menu, setMenu] = useState<'ferme' | 'choix' | 'lier' | 'creer'>('ferme');
  const apres = (r: unknown) => {
    setMenu('ferme');
    onMessage(simulation(r) ? r.message : null);
    if (!simulation(r)) onChange();
  };
  // No id: the creation was only simulated, nothing to reload.
  const creee = (id: string | undefined, message?: string) => {
    setMenu('ferme');
    onMessage(message ?? null);
    if (id) onChange();
  };
  const erreur = (e: unknown) => onMessage(e instanceof Error ? e.message : String(e));
  const ref = (id: string): RefFiche => ({ kind, id });

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>
          {titre} ({lignes.length})
        </h2>
        {ecrit && (
          <button className="btn sm" onClick={() => setMenu(menu === 'ferme' ? 'choix' : 'ferme')}>
            + Ajouter
          </button>
        )}
      </div>
      {menu === 'choix' && (
        <div className="fi-menu">
          <button className="btn ghost sm" onClick={() => setMenu('creer')}>
            Créer
          </button>
          <button className="btn ghost sm" onClick={() => setMenu('lier')}>
            Lier une fiche existante
          </button>
        </div>
      )}
      {menu === 'lier' && (
        <LierExistant
          slug={slug}
          kind={kind}
          exclus={lignes.map((l) => l.id)}
          onChoix={(id) => void lierFiche(slug, de, ref(id)).then(apres, erreur)}
        />
      )}
      <ul className="panel-b fi-liste">
        {lignes.map((l) => (
          <li key={l.id} className="fi-ligne">
            <span className="fi-ident">
              <span className={`fi-av ${kind === 'contact' ? '' : 'carre'}`} aria-hidden="true">
                {initiales(l.nom)}
              </span>
              <span>
                <a href={lien(slug, kind, l.id)}>{l.nom}</a>
                {principalGerable && l.principal && <span className="badge blue"> Principal</span>}
                {l.detail && <span className="small muted"> {l.detail}</span>}
              </span>
            </span>
            {ecrit && (
              <span className="fi-actions">
                {principalGerable && !l.principal && (
                  <button
                    className="btn ghost sm"
                    aria-label={`Définir ${l.nom} comme principal`}
                    title="Définir comme principal"
                    onClick={() => void definirPrincipal(slug, de, ref(l.id)).then(apres, erreur)}
                  >
                    <Icon name="star" />
                  </button>
                )}
                <button
                  className="btn ghost sm"
                  aria-label={`Délier ${l.nom}`}
                  title="Délier"
                  onClick={() => void delierFiche(slug, de, ref(l.id)).then(apres, erreur)}
                >
                  <Icon name="x" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {menu === 'creer' && kind === 'contact' && (
        <NouveauContact slug={slug} lierA={de} onClose={() => setMenu('ferme')} onCreated={creee} />
      )}
      {menu === 'creer' && kind === 'entreprise' && (
        <NouvelleEntreprise
          slug={slug}
          lierA={de}
          onClose={() => setMenu('ferme')}
          onCreated={creee}
        />
      )}
      {menu === 'creer' && kind === 'affaire' && (
        <CreerAffaire slug={slug} de={de} onClose={() => setMenu('ferme')} onFait={apres} />
      )}
    </section>
  );
}
