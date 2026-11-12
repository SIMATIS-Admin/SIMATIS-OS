import { useEffect, useState } from 'react';
import { fetchCiblages, type CiblageAtelier } from '../../api.js';
import { Fenetre } from '../Fenetre.js';
import { RechercheEntreprises } from '../RechercheEntreprises.js';

// L'étiquette de l'ICP : son code et l'entreprise de l'atelier (deux ateliers peuvent avoir un « ICP A »).
export const etiquetteIcp = (c: Pick<CiblageAtelier, 'code' | 'entreprise'>) =>
  `icp ${c.code.replace(/^icp\s*/i, '')}${c.entreprise ? ` (${c.entreprise})` : ''}`.slice(0, 40);

type Etat = { etat: 'charge' } | { etat: 'absent' } | { etat: 'pret'; ciblages: CiblageAtelier[] };

// « Chercher selon ma stratégie » : l'ICP et le persona viennent de l'Atelier stratégique. Le Radar
// compose la demande, la recherche d'entreprises existante la comprend, et le pilote vérifie
// les critères et les résultats avant d'ajouter quoi que ce soit à la base.
export function RechercheStrategie({ slug, onAjoute }: { slug: string; onAjoute: () => void }) {
  const [lu, setLu] = useState<Etat>({ etat: 'charge' });
  const [choix, setChoix] = useState(0);
  const [ouvert, setOuvert] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    fetchCiblages(slug).then(
      (ciblages) =>
        actif && setLu(Array.isArray(ciblages) ? { etat: 'pret', ciblages } : { etat: 'absent' }),
      // Pas de module Atelier dans cet espace : la section n'a pas lieu d'être.
      () => actif && setLu({ etat: 'absent' }),
    );
    return () => {
      actif = false;
    };
  }, [slug]);

  if (lu.etat !== 'pret') return null;
  if (lu.ciblages.length === 0)
    return (
      <section className="radar-strategie" aria-label="Chercher selon ma stratégie">
        <h2>Chercher selon ma stratégie</h2>
        <p className="small muted">
          Aucun ICP renseigné dans vos ateliers : remplissez l’étape de ciblage de l’Atelier
          stratégique, puis revenez ici.
        </p>
        <a className="btn" href={`#/${slug}/atelier`}>
          Ouvrir l’Atelier stratégique
        </a>
      </section>
    );
  const c = lu.ciblages[Math.min(choix, lu.ciblages.length - 1)]!;
  return (
    <section className="radar-strategie" aria-label="Chercher selon ma stratégie">
      <h2>Chercher selon ma stratégie</h2>
      <label className="small" htmlFor="radar-icp">
        ICP à cibler
      </label>
      <select
        id="radar-icp"
        className="input"
        value={choix}
        onChange={(e) => setChoix(Number(e.target.value))}
      >
        {lu.ciblages.map((x, i) => (
          <option key={`${x.atelierId}-${x.code}-${i}`} value={i}>
            {x.code}
            {x.nom ? ` : ${x.nom}` : ''}
            {x.entreprise ? ` (${x.entreprise})` : ''}
          </option>
        ))}
      </select>
      <pre className="radar-demande" aria-label="Demande composée">
        {c.demande}
      </pre>
      <div className="radar-actions">
        <button className="btn primary" onClick={() => setOuvert(true)}>
          Chercher selon cet ICP
        </button>
        <a className="btn" href={`#/${slug}/atelier`}>
          Modifier l’ICP dans l’Atelier
        </a>
      </div>
      {info && <p className="small">{info}</p>}
      {ouvert && (
        <Fenetre
          titre={`Chercher selon ${c.code}`}
          sousTitre="La demande vient de l'Atelier stratégique. Vérifiez les critères compris et les résultats : rien n'entre dans la base sans votre choix."
          onFermer={() => setOuvert(false)}
        >
          <RechercheEntreprises
            slug={slug}
            listes={[]}
            demandeInitiale={c.demande}
            etiquette={etiquetteIcp(c)}
            onAjoute={(m) => {
              setInfo(m);
              onAjoute();
            }}
          />
        </Fenetre>
      )}
    </section>
  );
}
