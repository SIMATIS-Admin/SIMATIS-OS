import { useEffect, useState } from 'react';
import { fetchRadar, type EtatRadar } from '../api.js';

// `href` : la carte ouvre la fiche (les prospects du CRM en ont une, pas les fiches de la base).
type Carte = { id: string; titre: string; detail: string | null; href?: string };

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
    })),
    lien: {
      href: `#/${slug}/prospection/ouvrir/froid`,
      libelle: `Écrire aux ${radar.prets.total}`,
    },
  },
  {
    id: 'contactes',
    titre: 'Contactés',
    aide: 'Une ou plusieurs touches envoyées',
    total: radar.contactes.total,
    cartes: radar.contactes.fiches.map((f): Carte => ({
      id: f.id,
      titre: f.nom,
      detail: `${f.entreprise} · ${f.nbContacts} touche${f.nbContacts > 1 ? 's' : ''}`,
    })),
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
