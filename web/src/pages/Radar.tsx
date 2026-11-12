import { useEffect, useState } from 'react';
import { fetchRadar, type EtatRadar } from '../api.js';
import { RechercheStrategie } from './radar/RechercheStrategie.js';
import { SequenceReglage } from './radar/SequenceReglage.js';

// `href` : la carte ouvre la fiche (les prospects du CRM en ont une, pas les fiches de la base).
type Carte = {
  id: string;
  titre: string;
  detail: string | null;
  href?: string;
  // Étiquettes ICP de la fiche : l'ICP d'où elle vient.
  icp?: string[];
};

// « · relance possible » quand le délai est écoulé, sinon « · relance le 17 nov. ».
const relance = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  return date.getTime() <= Date.now()
    ? ' · relance possible'
    : ` · relance le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })}`;
};

const etiquettesIcp = (tags: string[]) => tags.filter((t) => t.startsWith('icp '));

const etapes = (slug: string, radar: EtatRadar) => [
  {
    id: 'a-enrichir',
    titre: 'À enrichir',
    aide: 'Dans la base, sans personne à contacter',
    total: radar.aEnrichir.total,
    cartes: radar.aEnrichir.fiches.map((f): Carte => ({
      id: f.id,
      titre: f.entreprise,
      detail: f.nom || 'Contact à trouver',
      icp: etiquettesIcp(f.tags),
    })),
    lien: {
      href: `#/${slug}/bases/ouvrir/a-enrichir`,
      libelle: `Enrichir les ${radar.aEnrichir.total}`,
    },
  },
  {
    id: 'prets',
    titre: 'Prêts à contacter',
    aide: 'Jamais sollicités, joignables',
    total: radar.prets.total,
    cartes: radar.prets.fiches.map((f): Carte => ({
      id: f.id,
      titre: f.nom,
      detail: f.entreprise,
      icp: etiquettesIcp(f.tags),
    })),
    lien: {
      href: `#/${slug}/prospection/ouvrir/froid`,
      libelle: `Écrire aux ${radar.prets.total}`,
    },
  },
  {
    id: 'contactes',
    titre: 'Contactés',
    aide:
      radar.reprise.total > 0
        ? `Touches envoyées, dont ${radar.reprise.total} affaire${radar.reprise.total > 1 ? 's' : ''} du Pipeline sans rendez-vous`
        : 'Une ou plusieurs touches envoyées',
    total: radar.contactes.total + radar.reprise.total,
    // Les affaires du Pipeline d'abord : ce sont des personnes déjà approchées, avec une fiche.
    cartes: [
      ...radar.reprise.fiches.slice(0, 3).map((f): Carte => ({
        id: f.id,
        titre: f.nom,
        detail: f.entreprise ? `${f.entreprise} · affaire en cours` : 'Affaire en cours',
        href: `#/${slug}/fiche/contact/${f.id}`,
      })),
      ...radar.contactes.fiches.map((f): Carte => ({
        id: f.id,
        titre: f.nom,
        detail: `${f.entreprise} · ${f.nbContacts} touche${f.nbContacts > 1 ? 's' : ''}${relance(f.prochaineRelanceLe)}`,
        icp: etiquettesIcp(f.tags),
      })),
    ].slice(0, 5),
    lien: { href: `#/${slug}/prospection/ouvrir/froid`, libelle: 'Relancer' },
  },
  {
    id: 'ont-repondu',
    titre: 'Ont répondu',
    aide: 'À répondre depuis le Cockpit',
    total: radar.ontRepondu.total,
    cartes: radar.ontRepondu.fiches.map((f): Carte => ({
      id: f.id,
      titre: f.nom,
      detail: f.entreprise,
      icp: etiquettesIcp(f.tags),
    })),
    lien: { href: `#/${slug}/cockpit`, libelle: 'Répondre depuis le Cockpit' },
  },
  {
    id: 'rdv-accepte',
    titre: 'RDV accepté',
    aide: 'Ils passent dans le Pipeline',
    total: radar.rdvAccepte.total,
    cartes: radar.rdvAccepte.fiches.map((f): Carte => ({
      id: f.id,
      titre: f.nom,
      detail: f.entreprise,
      href: `#/${slug}/fiche/contact/${f.id}`,
    })),
    lien: { href: `#/${slug}/pipeline`, libelle: 'Ouvrir le Pipeline' },
  },
];

// Le pipe de détection : des suspects jusqu'au rendez-vous. Les quatre premières étapes sont lues
// dans la base vivante, la dernière est la liste des prospects du CRM. Prospection et Bases vivantes
// gardent leurs écrans, accessibles d'ici.
export function Radar({ slug }: { slug: string }) {
  const [radar, setRadar] = useState<EtatRadar | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const recharger = () =>
    fetchRadar(slug).then(
      (r) => setRadar(r),
      (e: unknown) => setErreur(e instanceof Error ? e.message : String(e)),
    );
  useEffect(() => {
    let actif = true;
    fetchRadar(slug).then(
      (r) => actif && setRadar(r),
      (e: unknown) => actif && setErreur(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      actif = false;
    };
  }, [slug]);

  if (erreur) return <p className="empty">{erreur}</p>;
  if (!radar)
    return (
      <div className="empty" role="status">
        Le Radar se prépare…
      </div>
    );
  return (
    <section className="radar">
      <p className="muted radar-intro">
        Du suspect au rendez-vous : chaque colonne est une étape. Un rendez-vous accepté fait passer
        le contact dans le Pipeline.
      </p>
      <div className="radar-actions">
        <a className="btn" href={`#/${slug}/bases`}>
          Trouver des suspects
        </a>
        <a className="btn" href={`#/${slug}/prospection`}>
          Campagnes et envois
        </a>
      </div>
      <RechercheStrategie slug={slug} onAjoute={() => void recharger()} />
      <SequenceReglage slug={slug} />
      <div className="radar-colonnes">
        {etapes(slug, radar).map((e) => (
          <section key={e.id} className="radar-colonne" aria-label={e.titre}>
            <header>
              <h2>{e.titre}</h2>
              <span className="radar-total num">{e.total}</span>
            </header>
            <p className="small muted">{e.aide}</p>
            {e.cartes.map((c) => {
              const contenu = (
                <>
                  <b>{c.titre}</b>
                  {c.detail && <span className="small muted">{c.detail}</span>}
                  {c.icp?.map((t) => (
                    <span key={t} className="radar-icp">
                      {t.toUpperCase()}
                    </span>
                  ))}
                </>
              );
              return c.href ? (
                <a key={c.id} className="radar-carte radar-carte-lien" href={c.href}>
                  {contenu}
                </a>
              ) : (
                <div key={c.id} className="radar-carte">
                  {contenu}
                </div>
              );
            })}
            {e.total === 0 && <p className="small muted">Personne à cette étape.</p>}
            {e.total > e.cartes.length && (
              <p className="small muted">+ {e.total - e.cartes.length} autres</p>
            )}
            <a className="link" href={e.lien.href}>
              {e.lien.libelle}
            </a>
          </section>
        ))}
      </div>
    </section>
  );
}
