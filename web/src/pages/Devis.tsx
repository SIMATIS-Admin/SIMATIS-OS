import { useCallback, useEffect, useState } from 'react';
import {
  creerDevis,
  fetchDevis,
  fetchParametresDevis,
  type DevisItem,
  type ParametresDevis,
} from '../api.js';
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
  // Modèles à proposer avant de créer le devis d'une affaire qui n'en a pas encore.
  const [choix, setChoix] = useState<ParametresDevis['modeles'] | null>(null);
  // Vrai seulement le temps de créer (ou retrouver) le devis de l'affaire : après, le retour à la liste reste possible.
  const [prepare, setPrepare] = useState(Boolean(affaire));

  const charger = useCallback(() => {
    fetchDevis(slug).then(setListe, (e: unknown) => setErreur(String(e)));
  }, [slug]);
  useEffect(charger, [charger, vue.ecran]);

  const depuisAffaire = useCallback(
    (opportuniteId: string, modeleId?: string) =>
      creerDevis(slug, opportuniteId, modeleId).then(
        (d) => {
          setPrepare(false);
          setVue({ ecran: 'editeur', id: d.id, prix: !d.existant });
        },
        (e: unknown) => {
          setPrepare(false);
          setErreur(e instanceof Error ? e.message : String(e));
        },
      ),
    [slug],
  );
  useEffect(() => {
    if (!affaire) return;
    // Un devis existant s'ouvre tel quel ; sinon, s'il y a des modèles, on laisse choisir.
    Promise.all([fetchDevis(slug), fetchParametresDevis(slug).catch(() => null)]).then(
      ([existants, p]) => {
        const modeles = p?.modeles ?? [];
        if (existants.some((d) => d.opportuniteId === affaire) || modeles.length === 0) {
          void depuisAffaire(affaire);
        } else {
          setPrepare(false);
          setChoix(modeles);
        }
      },
      () => void depuisAffaire(affaire),
    );
  }, [affaire, slug, depuisAffaire]);

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
  if (choix && affaire && vue.ecran === 'liste')
    return (
      <div className="panel">
        <div className="panel-b stack">
          <h3>Partir d’un modèle de mission ?</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {choix.map((m) => (
              <button
                key={m.id}
                className="btn"
                onClick={() => {
                  setChoix(null);
                  void depuisAffaire(affaire, m.id);
                }}
              >
                {m.nom}
              </button>
            ))}
            <button
              className="btn primary"
              onClick={() => {
                setChoix(null);
                void depuisAffaire(affaire);
              }}
            >
              Sans modèle
            </button>
          </div>
        </div>
      </div>
    );
  if (prepare && vue.ecran === 'liste')
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
          onChoisir={(id, modeleId) => void depuisAffaire(id, modeleId)}
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
