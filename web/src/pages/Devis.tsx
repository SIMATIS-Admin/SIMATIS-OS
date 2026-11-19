import { useCallback, useEffect, useState } from 'react';
import { creerDevis, fetchDevis, type DevisItem } from '../api.js';
import { DevisAffaire } from './DevisAffaire.js';
import { DevisEditeur } from './DevisEditeur.js';
import { DevisListe } from './DevisListe.js';

type Vue =
  { ecran: 'liste' } | { ecran: 'affaire' } | { ecran: 'editeur'; id: string; prix?: boolean };

// `ouvrir` : devis à ouvrir ; `affaire` : affaire dont on prépare (ou rouvre) le devis d'un clic.
export function Devis({
  slug,
  ouvrir,
  affaire,
}: {
  slug: string;
  ouvrir?: string;
  affaire?: string;
}) {
  const [liste, setListe] = useState<DevisItem[] | null>(null);
  const [vue, setVue] = useState<Vue>(
    ouvrir ? { ecran: 'editeur', id: ouvrir } : { ecran: 'liste' },
  );
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(() => {
    fetchDevis(slug).then(setListe, (e: unknown) => setErreur(String(e)));
  }, [slug]);
  useEffect(charger, [charger, vue.ecran]);

  const depuisAffaire = useCallback(
    (opportuniteId: string) =>
      creerDevis(slug, opportuniteId).then(
        (d) => setVue({ ecran: 'editeur', id: d.id, prix: !d.existant }),
        (e: unknown) => setErreur(e instanceof Error ? e.message : String(e)),
      ),
    [slug],
  );
  useEffect(() => {
    if (affaire) void depuisAffaire(affaire);
  }, [affaire, depuisAffaire]);

  if (erreur) return <div className="empty">{erreur}</div>;
  if (vue.ecran === 'editeur')
    return (
      <>
        <button
          className="btn"
          style={{ marginBottom: 12 }}
          onClick={() => setVue({ ecran: 'liste' })}
        >
          ← Tous les devis
        </button>
        <DevisEditeur
          key={vue.id}
          slug={slug}
          id={vue.id}
          etapeInitiale={vue.prix ? 'prix' : 'mission'}
          onOuvrir={(id) => setVue({ ecran: 'editeur', id })}
        />
      </>
    );
  if (affaire && vue.ecran === 'liste')
    return (
      <div className="empty" role="status">
        Préparation du devis…
      </div>
    );
  if (!liste)
    return (
      <div className="empty" role="status" aria-live="polite">
        Chargement des devis…
      </div>
    );
  if (vue.ecran === 'affaire')
    return (
      <>
        <button
          className="btn"
          style={{ marginBottom: 12 }}
          onClick={() => setVue({ ecran: 'liste' })}
        >
          Annuler
        </button>
        <DevisAffaire
          slug={slug}
          avecDevis={new Set(liste.map((d) => d.opportuniteId))}
          onChoisir={(id) => void depuisAffaire(id)}
        />
      </>
    );
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn primary" onClick={() => setVue({ ecran: 'affaire' })}>
          + Nouveau devis
        </button>
      </div>
      <DevisListe liste={liste} onOuvrir={(id) => setVue({ ecran: 'editeur', id })} />
    </>
  );
}
