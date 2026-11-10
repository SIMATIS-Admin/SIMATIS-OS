import { useEffect, useState } from 'react';
import {
  detacherEntrepriseBase,
  fetchCandidatsEntreprise,
  fetchEntrepriseBase,
  rattacherEntrepriseBase,
  type EntrepriseAnnuaireWeb,
  type EntrepriseBaseWeb,
} from '../api.js';
import { SignauxEntreprise } from './SignauxEntreprise.js';
import { SiteEntreprise } from './SiteEntreprise.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const siren = (s: string) => s.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
// A published turnover of 0 means the figure is not disclosed.
const euros = (n: number | null) =>
  !n
    ? '—'
    : new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(n);

function Resume({ e }: { e: EntrepriseAnnuaireWeb }) {
  return (
    <>
      <strong>{e.nom}</strong>
      <span className="small muted">
        {' '}
        SIREN {siren(e.siren)}
        {[e.ville, e.naf && `NAF ${e.naf}`, e.effectif].filter(Boolean).map((p) => ` · ${p}`)}
        {e.active ? '' : ' · cessée'}
      </span>
    </>
  );
}

// The company of the State directory behind a record. The directory only proposes: nothing is
// linked until the pilot picks one, and the link follows the other contacts of the same company.
export function EntrepriseFiche({
  slug,
  ficheId,
  entrepriseId,
  onChange,
}: {
  slug: string;
  ficheId: string;
  entrepriseId: string | null;
  onChange: () => void;
}) {
  const [entreprise, setEntreprise] = useState<EntrepriseBaseWeb | null>(null);
  const [candidats, setCandidats] = useState<EntrepriseAnnuaireWeb[] | null>(null);
  const [saisie, setSaisie] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!entrepriseId) return setEntreprise(null);
    let actif = true;
    fetchEntrepriseBase(slug, entrepriseId).then(
      (e) => actif && setEntreprise(e),
      (e: unknown) => actif && setErreur(message(e)),
    );
    return () => {
      actif = false;
    };
  }, [slug, entrepriseId]);

  const agir = async (action: () => Promise<void>) => {
    setOccupe(true);
    setErreur(null);
    try {
      await action();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };
  const proposer = () =>
    agir(async () => setCandidats((await fetchCandidatsEntreprise(slug, ficheId)).candidats));
  const rattacher = (valeur: string) =>
    agir(async () => {
      const { entreprise: e, rattachees } = await rattacherEntrepriseBase(slug, ficheId, valeur);
      setEntreprise(e);
      setCandidats(null);
      setSaisie('');
      setInfo(
        `${rattachees} contact${rattachees > 1 ? 's' : ''} rattaché${rattachees > 1 ? 's' : ''}.`,
      );
      onChange();
    });
  const detacher = () =>
    agir(async () => {
      await detacherEntrepriseBase(slug, ficheId);
      setEntreprise(null);
      setInfo(null);
      onChange();
    });

  return (
    <section className="bv-entreprise" aria-label="Entreprise">
      <h3 className="bv-sous-titre">Entreprise</h3>
      {erreur && (
        <p className="error" role="alert">
          {erreur}
        </p>
      )}
      {info && <p className="small muted">{info}</p>}
      {entreprise ? (
        <>
          <p>
            <Resume e={entreprise} />
          </p>
          {entreprise.oppositionDiffusion && (
            <p>
              <span className="badge amber">
                L’annuaire indique que l’entreprise s’oppose à la diffusion commerciale de ses
                données.
              </span>
            </p>
          )}
          <dl className="bv-fiche">
            {entreprise.adresse && (
              <>
                <dt>Adresse</dt>
                <dd>{entreprise.adresse}</dd>
              </>
            )}
            {entreprise.categorie && (
              <>
                <dt>Catégorie</dt>
                <dd>{entreprise.categorie}</dd>
              </>
            )}
            {entreprise.creeLe && (
              <>
                <dt>Création</dt>
                <dd>{entreprise.creeLe.slice(0, 4)}</dd>
              </>
            )}
            {entreprise.finances.length > 0 && (
              <>
                <dt>Chiffres publiés</dt>
                <dd>
                  {entreprise.finances.slice(0, 3).map((f) => (
                    <div key={f.annee}>
                      {f.annee} : CA {euros(f.ca)} · résultat {euros(f.resultat)}
                    </div>
                  ))}
                </dd>
              </>
            )}
            {entreprise.dirigeants.length > 0 && (
              <>
                <dt>Dirigeants</dt>
                <dd>
                  {entreprise.dirigeants.map((d) => (
                    <div key={`${d.nom}-${d.fonction}`}>
                      {d.nom}
                      {d.fonction ? ` (${d.fonction})` : ''}
                    </div>
                  ))}
                </dd>
              </>
            )}
          </dl>
          <SiteEntreprise slug={slug} entreprise={entreprise} onLu={setEntreprise} />
          <SignauxEntreprise slug={slug} entrepriseId={entreprise.id} />
          <button className="btn ghost" disabled={occupe} onClick={() => void detacher()}>
            Détacher de cette entreprise
          </button>
        </>
      ) : candidats === null ? (
        <button className="btn" disabled={occupe} onClick={() => void proposer()}>
          Rattacher à l’annuaire des entreprises
        </button>
      ) : (
        <div>
          {candidats.length === 0 ? (
            <p className="muted">Aucune entreprise proposée pour ce nom.</p>
          ) : (
            <ul className="bv-candidats">
              {candidats.map((c) => (
                <li key={c.siren}>
                  <Resume e={c} />{' '}
                  <button
                    className="btn sm"
                    disabled={occupe}
                    onClick={() => void rattacher(c.siren)}
                  >
                    Choisir
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="small">
            SIREN
            <input value={saisie} onChange={(e) => setSaisie(e.target.value)} inputMode="numeric" />
          </label>{' '}
          <button
            className="btn sm"
            disabled={occupe || !saisie.trim()}
            onClick={() => void rattacher(saisie)}
          >
            Rattacher ce SIREN
          </button>
        </div>
      )}
    </section>
  );
}
