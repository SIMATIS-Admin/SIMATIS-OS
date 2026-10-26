import { useEffect, useState } from 'react';
import { fetchDroitTransfert, fetchInstances, type RefTransfert } from '../../api.js';
import type { InstanceSummary } from '../../nav.js';
import { FenetreTransfert } from './FenetreTransfert.js';

// Instance an object belongs to. Only the super administrator in the own instance gets a pastille
// to change it; everywhere else it is not shown at all (the server enforces the same rule).
export function PastilleInstance({
  slug,
  instance,
  objet,
  onTransfere,
  autorise: autoriseConnu,
}: {
  slug: string;
  instance: { slug: string; nom?: string; couleur?: string | null };
  objet: RefTransfert;
  // The object now at the destination: the same one after a move, its copy after a copy.
  onTransfere: (cibleSlug: string, racine: RefTransfert) => void;
  // A page showing many pastilles already knows the right: no request per pastille.
  autorise?: boolean;
}) {
  const [autorise, setAutorise] = useState(autoriseConnu ?? false);
  const [liste, setListe] = useState<InstanceSummary[]>([]);
  const [menu, setMenu] = useState<InstanceSummary[] | null>(null);
  const [cible, setCible] = useState<InstanceSummary | null>(null);

  useEffect(() => {
    if (autoriseConnu !== undefined) return setAutorise(autoriseConnu);
    let vivant = true;
    fetchDroitTransfert(slug).then(
      (d) => vivant && setAutorise(d.autorise),
      () => vivant && setAutorise(false),
    );
    return () => {
      vivant = false;
    };
  }, [slug, autoriseConnu]);

  useEffect(() => {
    // The name and colour are only fetched when the caller did not give them.
    if (!autorise || instance.nom !== undefined) return;
    let vivant = true;
    fetchInstances().then(
      (l) => vivant && setListe(l),
      () => undefined,
    );
    return () => {
      vivant = false;
    };
  }, [autorise, instance.nom]);

  if (!autorise) return null;

  const propre = liste.find((i) => i.slug === instance.slug);
  const nom = instance.nom ?? propre?.nom ?? instance.slug;
  const couleur = instance.couleur ?? propre?.couleur ?? undefined;
  const ouvrir = () => {
    if (menu) return setMenu(null);
    // Fetched again on click: the list may have changed (a mandate created) since the page opened.
    void fetchInstances().then(
      (l) => {
        setListe(l);
        setMenu(l.filter((i) => i.slug !== instance.slug && i.type !== 'prospect'));
      },
      () => setMenu([]),
    );
  };

  return (
    <span className="pastille-instance-zone">
      <button
        type="button"
        className="badge pastille-instance"
        style={{ borderColor: couleur }}
        title="Changer l’instance de cet objet"
        onClick={ouvrir}
      >
        {nom}
      </button>
      {menu && !cible && (
        <div className="pastille-menu" role="menu">
          {menu.map((i) => (
            <button
              key={i.slug}
              type="button"
              role="menuitem"
              onClick={() => {
                setCible(i);
                setMenu(null);
              }}
            >
              {i.nom}
            </button>
          ))}
        </div>
      )}
      {cible && (
        <FenetreTransfert
          slug={slug}
          objet={objet}
          instanceOrigine={instance.slug}
          cible={cible}
          onFermer={() => setCible(null)}
          onFait={(c, racine) => {
            setCible(null);
            onTransfere(c, racine);
          }}
        />
      )}
    </span>
  );
}
