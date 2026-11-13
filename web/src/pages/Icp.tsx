import { useEffect, useState } from 'react';
import { fetchCiblages, type CiblageAtelier, type ChampCiblage } from '../api.js';
import { Icon } from '../icons.js';
import { cleCiblage } from './radar/RechercheStrategie.js';

type Etat = { etat: 'charge' } | { etat: 'absent' } | { etat: 'pret'; ciblages: CiblageAtelier[] };

const Champs = ({ titre, champs }: { titre: string; champs: ChampCiblage[] }) => {
  const remplis = champs.filter((c) => c.valeur.trim() !== '');
  if (remplis.length === 0) return null;
  return (
    <div>
      <h3>{titre}</h3>
      <dl>
        {remplis.map((c) => (
          <div key={c.cle}>
            <dt>{c.cle}</dt>
            <dd>{c.valeur}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

// Les ICP de l'instance courante, tels que l'Atelier stratégique les définit : on les lit ici, on les
// modifie dans l'Atelier. Quand les ateliers de l'instance portent sur plusieurs entreprises
// (SIMATIS, Alpes IA…), on en choisit une et on ne voit que ses ICP.
export function Icp({ slug, nom }: { slug: string; nom: string }) {
  const [lu, setLu] = useState<Etat>({ etat: 'charge' });
  const [choix, setChoix] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    fetchCiblages(slug).then(
      (ciblages) =>
        actif && setLu(Array.isArray(ciblages) ? { etat: 'pret', ciblages } : { etat: 'absent' }),
      () => actif && setLu({ etat: 'absent' }),
    );
    return () => {
      actif = false;
    };
  }, [slug]);

  if (lu.etat === 'charge')
    return (
      <div className="empty" role="status">
        Les ICP se chargent…
      </div>
    );
  if (lu.etat === 'absent' || lu.ciblages.length === 0)
    return (
      <section className="icp">
        <p className="muted">
          Aucun ICP pour {nom}. Définissez-les dans l’étape de ciblage de l’Atelier stratégique.
        </p>
        <a className="btn" href={`#/${slug}/atelier`}>
          Ouvrir l’Atelier stratégique
        </a>
      </section>
    );
  const groupes = [...new Set(lu.ciblages.map((c) => c.entreprise ?? nom))];
  const groupe = choix && groupes.includes(choix) ? choix : groupes[0]!;
  const affiches = lu.ciblages.filter((c) => (c.entreprise ?? nom) === groupe);
  return (
    <section className="icp">
      {groupes.length > 1 && (
        <div className="icp-choix" role="group" aria-label="Entreprise">
          {groupes.map((g) => (
            <button
              key={g}
              type="button"
              className={`chip ${g === groupe ? 'on' : ''}`}
              aria-pressed={g === groupe}
              onClick={() => setChoix(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}
      <p className="muted icp-intro">
        {affiches.length} ICP pour {groupe}. Ils se définissent dans l’Atelier stratégique.
      </p>
      <div className="icp-cartes">
        {affiches.map((c) => (
          <article key={cleCiblage(c)} className="icp-carte" aria-label={c.code}>
            <header>
              <Icon name="flag" />
              <h2>
                {c.code}
                {c.nom ? ` : ${c.nom}` : ''}
              </h2>
            </header>
            {c.offre && <p className="small icp-offre">{c.offre}</p>}
            <details className="icp-detail">
              <summary>Cible et persona</summary>
              <div className="icp-champs">
                <Champs titre="Cible" champs={c.icp} />
                <Champs titre="Persona" champs={c.persona} />
              </div>
            </details>
            <div className="icp-actions">
              <a
                className="btn primary"
                href={`#/${slug}/recherches/ouvrir/${encodeURIComponent(cleCiblage(c))}`}
              >
                Chercher selon cet ICP
              </a>
              <a
                className="btn"
                href={`#/${slug}/atelier/ouvrir/${encodeURIComponent(c.atelierId)}`}
              >
                Modifier dans l’Atelier
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
