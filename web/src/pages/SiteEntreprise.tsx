import { useState } from 'react';
import { lireSiteEntrepriseBase, type EntrepriseBaseWeb } from '../api.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const joli = (tel: string) =>
  tel.replace(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '0$1 $2 $3 $4 $5');
const jour = (d: string) => new Date(d).toLocaleDateString('fr-FR');

// What the company's own site says: its switchboard, its general e-mail addresses, its LinkedIn
// page. The site is only read when the pilot asks (it is somebody else's server), from the
// address typed here, the one already known, or the domain the contacts write from.
export function SiteEntreprise({
  slug,
  entreprise,
  onLu,
}: {
  slug: string;
  entreprise: EntrepriseBaseWeb;
  onLu: (e: EntrepriseBaseWeb) => void;
}) {
  const [saisie, setSaisie] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const lire = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      onLu(await lireSiteEntrepriseBase(slug, entreprise.id, saisie.trim() || undefined));
      setSaisie('');
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };
  const lu = Boolean(entreprise.siteLuLe);

  return (
    <section className="bv-site" aria-label="Site web de l’entreprise">
      <h4 className="bv-sous-titre">Site web</h4>
      {erreur && (
        <p className="small muted" role="status">
          {erreur}
        </p>
      )}
      {lu ? (
        <dl className="bv-fiche">
          <dt>Site</dt>
          <dd>
            {entreprise.siteWeb ? (
              <a href={entreprise.siteWeb} target="_blank" rel="noreferrer">
                {entreprise.siteWeb.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
              </a>
            ) : (
              '—'
            )}{' '}
            <span className={`badge ${entreprise.siteConfirme ? '' : 'amber'}`}>
              {entreprise.siteConfirme ? 'confirmé par son SIREN' : 'non confirmé : à vérifier'}
            </span>
          </dd>
          <dt>Standard</dt>
          <dd>
            {entreprise.siteTelephones.length === 0
              ? '—'
              : entreprise.siteTelephones.map((t) => (
                  <div key={t}>
                    <a href={`tel:${t}`}>{joli(t)}</a>
                  </div>
                ))}
          </dd>
          <dt>E-mail général</dt>
          <dd>
            {entreprise.siteEmails.length === 0
              ? '—'
              : entreprise.siteEmails.map((m) => (
                  <div key={m}>
                    <a href={`mailto:${m}`}>{m}</a>
                  </div>
                ))}
          </dd>
          <dt>LinkedIn</dt>
          <dd>
            {entreprise.linkedin ? (
              <a href={entreprise.linkedin} target="_blank" rel="noreferrer">
                Page de l’entreprise
              </a>
            ) : (
              '—'
            )}
          </dd>
        </dl>
      ) : (
        <p className="muted">Site non lu.</p>
      )}
      <label className="small">
        Adresse du site (facultatif)
        <input
          className="input"
          value={saisie}
          placeholder={entreprise.siteWeb ?? 'exemple.fr'}
          onChange={(e) => setSaisie(e.target.value)}
        />
      </label>{' '}
      <button className="btn sm" disabled={occupe} onClick={() => void lire()}>
        {occupe ? 'Lecture…' : lu ? 'Relire le site' : 'Lire le site'}
      </button>
      {entreprise.siteLuLe && (
        <span className="small muted"> Lu le {jour(entreprise.siteLuLe)}.</span>
      )}
    </section>
  );
}
