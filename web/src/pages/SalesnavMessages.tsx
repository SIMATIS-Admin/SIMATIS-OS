import { useCallback, useEffect, useState } from 'react';
import {
  creerCampagneSalesnav,
  enregistrerModeleSalesnav,
  enregistrerSurchargeSalesnav,
  fetchCiblages,
  fetchSalesnav,
  retirerSurchargeSalesnav,
  supprimerCampagneSalesnav,
  type CampagneSalesnav,
  type EtapeSalesnav,
  type VueSalesnav,
} from '../api.js';

const LIBELLES: Record<EtapeSalesnav, string> = {
  invitation: 'Note d’invitation',
  acceptation: 'Après acceptation',
  relance1: 'Relance 1',
  relance2: 'Relance 2',
};

const message = (e: unknown) => (e instanceof Error ? e.message : 'Une erreur est survenue.');

// Un champ de message : le texte modifiable, le compteur de caractères (la note d'invitation a une
// limite chez LinkedIn) et les boutons. `propre` : le texte vient de la campagne et non du modèle.
function Champ({
  etape,
  limite,
  initial,
  propre,
  libelleBouton,
  onSave,
  onRetirer,
}: {
  etape: EtapeSalesnav;
  limite: number;
  initial: string;
  propre?: boolean;
  libelleBouton: string;
  onSave: (texte: string) => Promise<void>;
  onRetirer?: () => Promise<void>;
}) {
  const [texte, setTexte] = useState(initial);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => setTexte(initial), [initial]);
  const trop = etape === 'invitation' && texte.trim().length > limite;
  const inchange = texte.trim() === initial.trim();
  const agir = async (fn: () => Promise<void>) => {
    setOccupe(true);
    setErreur(null);
    try {
      await fn();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };
  return (
    <div className="salesnav-champ">
      <label>
        <span className="salesnav-etape">
          {LIBELLES[etape]}
          {propre !== undefined && (
            <span className={`chip small ${propre ? 'on' : ''}`}>
              {propre ? 'Propre à la campagne' : 'Modèle par défaut'}
            </span>
          )}
        </span>
        <textarea
          value={texte}
          rows={etape === 'invitation' ? 4 : 5}
          onChange={(e) => setTexte(e.target.value)}
        />
      </label>
      <div className="salesnav-pied">
        {etape === 'invitation' && (
          <span className={`small ${trop ? 'salesnav-trop' : 'muted'}`} aria-live="polite">
            {texte.trim().length} / {limite} caractères
          </span>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={occupe || trop || inchange || texte.trim() === ''}
          onClick={() => void agir(() => onSave(texte))}
        >
          {libelleBouton}
        </button>
        {onRetirer && propre && (
          <button
            type="button"
            className="btn"
            disabled={occupe}
            onClick={() => void agir(onRetirer)}
          >
            Remettre le modèle
          </button>
        )}
      </div>
      {erreur && (
        <p role="alert" className="salesnav-erreur small">
          {erreur}
        </p>
      )}
    </div>
  );
}

// Messages du canal Sales Navigator : le modèle par défaut de chaque cible, que l'on modifie ici, et
// les campagnes qui peuvent remplacer un message pour leur lot seulement.
export function SalesnavMessages({ slug }: { slug: string }) {
  const [vue, setVue] = useState<VueSalesnav | null>(null);
  const [cibles, setCibles] = useState<{ valeur: string; nom: string }[]>([]);
  const [cible, setCible] = useState('');
  const [nom, setNom] = useState('');
  const [campagneCible, setCampagneCible] = useState('');
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      setVue(await fetchSalesnav(slug));
    } catch (e) {
      setErreur(message(e));
    }
  }, [slug]);

  useEffect(() => {
    void charger();
    // Les ICP de l'Atelier aident à nommer les cibles ; absents, on saisit la cible à la main.
    fetchCiblages(slug).then(
      (c) =>
        setCibles(
          Array.isArray(c)
            ? c.map((x) => ({
                valeur: `${x.entreprise ? `${x.entreprise} · ` : ''}${x.code}`,
                nom: x.nom,
              }))
            : [],
        ),
      () => setCibles([]),
    );
  }, [slug, charger]);

  if (!vue) {
    return erreur ? (
      <p role="alert" className="salesnav-erreur">
        {erreur}
      </p>
    ) : (
      <div className="empty" role="status">
        Les messages se chargent…
      </div>
    );
  }

  // Le nom du segment aide à reconnaître la lettre de l'ICP dans la liste de suggestions.
  const nomsCibles = new Map(cibles.map((c) => [c.valeur, c.nom]));
  const toutesCibles = [...new Set([...nomsCibles.keys(), ...vue.modeles.map((m) => m.icp)])];
  const texteModele = (icp: string, etape: EtapeSalesnav) =>
    vue.modeles.find((m) => m.icp === icp && m.etape === etape)?.texte ?? '';
  const cibleChoisie = cible.trim();

  const creer = async () => {
    setErreur(null);
    try {
      await creerCampagneSalesnav(slug, nom.trim(), campagneCible.trim());
      setNom('');
      await charger();
    } catch (e) {
      setErreur(message(e));
    }
  };

  const supprimer = async (c: CampagneSalesnav) => {
    if (!window.confirm(`Supprimer la campagne « ${c.nom} » ?`)) return;
    setErreur(null);
    try {
      await supprimerCampagneSalesnav(slug, c.id);
      await charger();
    } catch (e) {
      setErreur(message(e));
    }
  };

  const campagnes: CampagneSalesnav[] = vue.campagnes;
  return (
    <section className="salesnav">
      <p className="muted">
        Messages à envoyer à la main depuis Sales Navigator. Utilisez <code>{'{prénom}'}</code> et{' '}
        <code>{'{entreprise}'}</code> : ils sont remplis au moment de copier le message.
      </p>
      {erreur && (
        <p role="alert" className="salesnav-erreur">
          {erreur}
        </p>
      )}

      <h2>Modèles par défaut</h2>
      <label className="salesnav-cible">
        Cible
        <input
          list="salesnav-cibles"
          value={cible}
          placeholder="Choisir ou saisir une cible"
          onChange={(e) => setCible(e.target.value)}
        />
        <datalist id="salesnav-cibles">
          {toutesCibles.map((c) => (
            <option key={c} value={c} label={nomsCibles.get(c)} />
          ))}
        </datalist>
      </label>
      {cibleChoisie === '' ? (
        <p className="muted small">Choisissez une cible pour écrire ou modifier ses messages.</p>
      ) : (
        <div className="salesnav-grille">
          {vue.etapes.map((etape) => (
            <Champ
              key={`${cibleChoisie}-${etape}`}
              etape={etape}
              limite={vue.limiteInvitation}
              initial={texteModele(cibleChoisie, etape)}
              libelleBouton="Enregistrer le modèle"
              onSave={async (texte) => {
                await enregistrerModeleSalesnav(slug, cibleChoisie, etape, texte);
                await charger();
              }}
            />
          ))}
        </div>
      )}

      <h2>Campagnes</h2>
      <p className="muted small">
        Une campagne utilise les modèles de sa cible. Modifiez un message dans la campagne pour le
        remplacer pour ce lot seulement, sans toucher au modèle.
      </p>
      <div className="salesnav-creation">
        <input
          aria-label="Nom de la campagne"
          value={nom}
          placeholder="Nom de la campagne"
          onChange={(e) => setNom(e.target.value)}
        />
        <input
          aria-label="Cible de la campagne"
          list="salesnav-cibles"
          value={campagneCible}
          placeholder="Cible"
          onChange={(e) => setCampagneCible(e.target.value)}
        />
        <button
          type="button"
          className="btn primary"
          disabled={nom.trim() === '' || campagneCible.trim() === ''}
          onClick={() => void creer()}
        >
          Créer la campagne
        </button>
      </div>
      {campagnes.length === 0 && <p className="muted small">Aucune campagne pour le moment.</p>}
      {campagnes.map((c) => (
        <article key={c.id} className="salesnav-campagne" aria-label={c.nom}>
          <header>
            <h3>
              {c.nom} <span className="muted small">({c.icp})</span>
            </h3>
            <button
              type="button"
              className="btn"
              aria-expanded={ouverte === c.id}
              onClick={() => setOuverte(ouverte === c.id ? null : c.id)}
            >
              {ouverte === c.id ? 'Fermer' : 'Modifier les messages'}
            </button>
            <button type="button" className="btn" onClick={() => void supprimer(c)}>
              Supprimer
            </button>
          </header>
          {ouverte === c.id && (
            <div className="salesnav-grille">
              {vue.etapes.map((etape) => {
                const propre = c.surcharges.find((s) => s.etape === etape);
                return (
                  <Champ
                    key={`${c.id}-${etape}`}
                    etape={etape}
                    limite={vue.limiteInvitation}
                    initial={propre?.texte ?? texteModele(c.icp, etape)}
                    propre={propre !== undefined}
                    libelleBouton="Enregistrer pour cette campagne"
                    onSave={async (texte) => {
                      await enregistrerSurchargeSalesnav(slug, c.id, etape, texte);
                      await charger();
                    }}
                    onRetirer={async () => {
                      await retirerSurchargeSalesnav(slug, c.id, etape);
                      await charger();
                    }}
                  />
                );
              })}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
