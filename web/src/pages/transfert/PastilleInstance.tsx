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
}: {
  slug: string;
  instance: { slug: string; nom: string; couleur: string | null };
  objet: RefTransfert;
  onTransfere: (cibleSlug: string) => void;
}) {
  const [autorise, setAutorise] = useState(false);
  const [menu, setMenu] = useState<InstanceSummary[] | null>(null);
  const [cible, setCible] = useState<InstanceSummary | null>(null);

  useEffect(() => {
    let vivant = true;
    fetchDroitTransfert(slug).then(
      (d) => vivant && setAutorise(d.autorise),
      () => vivant && setAutorise(false),
    );
    return () => {
      vivant = false;
    };
  }, [slug]);

  if (!autorise) return null;

  const ouvrir = () =>
    menu
      ? setMenu(null)
      : void fetchInstances().then(
          (liste) => setMenu(liste.filter((i) => i.slug !== instance.slug)),
          () => setMenu([]),
        );

  return (
    <span className="pastille-instance-zone">
      <button
        type="button"
        className="badge pastille-instance"
        style={{ borderColor: instance.couleur ?? undefined }}
        title="Changer l’instance de cet objet"
        onClick={ouvrir}
      >
        {instance.nom}
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
          onFait={(c) => {
            setCible(null);
            onTransfere(c);
          }}
        />
      )}
    </span>
  );
}
