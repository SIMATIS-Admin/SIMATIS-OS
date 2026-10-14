import { useCallback, useEffect, useState } from 'react';
import {
  choisirPropriete,
  connecterAnalytics,
  fetchProprietes,
  fetchRapportSite,
  fetchSiteWeb,
  type EtatSiteWeb,
  type ProprieteAnalytics,
  type RapportSite,
} from '../api.js';
import { Icon } from '../icons.js';

const entier = (n: number) => Math.round(n).toLocaleString('fr-FR');
const pourcent = (n: number) => `${Math.round(n * 100)} %`;
const duree = (s: number) => {
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s` : `${Math.round(s)} s`;
};
const jour = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const MOIS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
const libelleMois = (m: string) => MOIS[Number(m.slice(5, 7)) - 1] ?? m;

// Change against the previous 28 days, in words and arrow as well as color.
export function Evolution({ actuel, precedent }: { actuel: number; precedent: number }) {
  if (precedent === 0) {
    return <span className="small muted">{actuel === 0 ? 'stable' : 'nouveau'}</span>;
  }
  const ecart = Math.round(((actuel - precedent) / precedent) * 100);
  if (ecart === 0) return <span className="small muted">= stable</span>;
  return (
    <span className={`small sw-evol ${ecart > 0 ? 'up' : 'down'}`}>
      {ecart > 0 ? '▲ +' : '▼ '}
      {ecart} % vs 28 j précédents
    </span>
  );
}

function Kpi({
  libelle,
  valeur,
  actuel,
  precedent,
  aide,
}: {
  libelle: string;
  valeur: string;
  actuel: number;
  precedent: number;
  aide: string;
}) {
  return (
    <div className="panel kpi">
      <span className="l">{libelle}</span>
      <span className="v">{valeur}</span>
      <Evolution actuel={actuel} precedent={precedent} />
      <span className="small muted sw-aide">{aide}</span>
    </div>
  );
}

function Rapport({
  r,
  onFrais,
  onChanger,
}: {
  r: RapportSite;
  onFrais: () => void;
  onChanger: () => void;
}) {
  const { actuel: a, precedent: p } = r;
  const taux = (d: number, v: number) => (v ? d / v : 0);
  const maxMois = Math.max(1, ...r.mois.map((m) => m.visiteurs));
  const totalCanaux = r.canaux.reduce((s, c) => s + c.sessions, 0) || 1;
  const maxCanal = Math.max(1, ...r.canaux.map((c) => c.sessions));
  return (
    <>
      <div className="sw-entete">
        <div className="small muted">
          Du {jour(r.periode.du)} au {jour(r.periode.au)}, comparé aux 28 jours précédents (
          {jour(r.precedente.du)} – {jour(r.precedente.au)}). Mis à jour à{' '}
          {new Date(r.genereLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          .
        </div>
        <div className="sw-actions">
          <button className="btn sm ghost" onClick={onChanger}>
            Changer de site
          </button>
          <button className="btn sm" onClick={onFrais}>
            Actualiser
          </button>
        </div>
      </div>

      <div className="grid g3">
        <Kpi
          libelle="Visiteurs"
          valeur={entier(a.visiteurs)}
          actuel={a.visiteurs}
          precedent={p.visiteurs}
          aide={`dont ${entier(a.nouveaux)} venus pour la première fois`}
        />
        <Kpi
          libelle="Demandes reçues par le formulaire"
          valeur={entier(r.demandes.actuel)}
          actuel={r.demandes.actuel}
          precedent={r.demandes.precedent}
          aide="relevées par l'OS dans votre Inbox"
        />
        <Kpi
          libelle="Visiteurs qui font une demande"
          valeur={`${(taux(r.demandes.actuel, a.visiteurs) * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`}
          actuel={taux(r.demandes.actuel, a.visiteurs)}
          precedent={taux(r.demandes.precedent, p.visiteurs)}
          aide="le rendement du site : demandes ÷ visiteurs"
        />
        <Kpi
          libelle="Visites engagées"
          valeur={pourcent(a.engagement)}
          actuel={a.engagement}
          precedent={p.engagement}
          aide="visites de plus de 10 s ou de 2 pages et plus"
        />
        <Kpi
          libelle="Durée moyenne d'une visite"
          valeur={duree(a.dureeMoyenne)}
          actuel={a.dureeMoyenne}
          precedent={p.dureeMoyenne}
          aide={`${entier(a.sessions)} visites, ${entier(a.pagesVues)} pages vues`}
        />
        <Kpi
          libelle="Pages vues par visite"
          valeur={(a.sessions ? a.pagesVues / a.sessions : 0).toLocaleString('fr-FR', {
            maximumFractionDigits: 1,
          })}
          actuel={a.sessions ? a.pagesVues / a.sessions : 0}
          precedent={p.sessions ? p.pagesVues / p.sessions : 0}
          aide="plus il est haut, plus le visiteur explore"
        />
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-h">
          <div>
            <h2>Visiteurs par mois</h2>
            <div className="small muted">
              Douze mois : la tendance de fond, au-delà des à-coups.
            </div>
          </div>
        </div>
        <div className="panel-b">
          {r.mois.length === 0 ? (
            <div className="empty">Pas encore de visite enregistrée.</div>
          ) : (
            <div className="sw-cols" role="list" aria-label="Visiteurs par mois">
              {r.mois.map((m, k) => {
                const enCours = k === r.mois.length - 1;
                const titre = `${libelleMois(m.mois)} ${m.mois.slice(0, 4)} : ${entier(m.visiteurs)} visiteurs, ${entier(m.sessions)} visites${enCours ? ' (mois en cours)' : ''}`;
                return (
                  <div
                    key={m.mois}
                    className="sw-col"
                    role="listitem"
                    title={titre}
                    aria-label={titre}
                  >
                    <span className="sw-col-v num">{entier(m.visiteurs)}</span>
                    <div
                      className={`sw-col-bar${enCours ? ' partiel' : ''}`}
                      style={{ height: `${Math.max(2, (m.visiteurs / maxMois) * 100)}%` }}
                    />
                    <span className="sw-col-l">{libelleMois(m.mois)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="small muted">Le dernier mois, hachuré, est en cours.</p>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-h">
            <div>
              <h2>D'où viennent les visiteurs</h2>
              <div className="small muted">Visites des 28 derniers jours, par canal.</div>
            </div>
          </div>
          <div className="panel-b bars">
            {r.canaux.length === 0 && <div className="empty">Aucune visite sur la période.</div>}
            {r.canaux.map((c) => (
              <div
                key={c.canal}
                className="row"
                title={`${c.canal} : ${entier(c.sessions)} visites, ${pourcent(c.engagement)} engagées`}
              >
                <span>{c.canal}</span>
                <div className="bar" style={{ width: `${(c.sessions / maxCanal) * 100}%` }} />
                <span className="v">{pourcent(c.sessions / totalCanaux)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h">
            <div>
              <h2>Sites qui vous envoient du monde</h2>
              <div className="small muted">Moteurs, réseaux, sites partenaires.</div>
            </div>
          </div>
          <div className="panel-b">
            <table className="tbl small">
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="r">Visites</th>
                </tr>
              </thead>
              <tbody>
                {r.sources.map((s) => (
                  <tr key={s.source}>
                    <td>{s.source === '(direct)' ? 'Accès direct' : s.source}</td>
                    <td className="r num">{entier(s.sessions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-h">
          <div>
            <h2>Pages les plus lues</h2>
            <div className="small muted">
              Ce qui intéresse vos visiteurs : à rapprocher des demandes reçues.
            </div>
          </div>
        </div>
        <div className="panel-b">
          <table className="tbl small">
            <thead>
              <tr>
                <th>Page</th>
                <th className="r">Vues</th>
                <th className="r">Visiteurs</th>
              </tr>
            </thead>
            <tbody>
              {r.pages.map((pg) => (
                <tr key={`${pg.chemin}|${pg.titre}`}>
                  <td>
                    {pg.titre || pg.chemin}
                    <div className="small muted">{pg.chemin}</div>
                  </td>
                  <td className="r num">{entier(pg.vues)}</td>
                  <td className="r num">{entier(pg.visiteurs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Choix({
  slug,
  onChoisi,
  onConnecter,
}: {
  slug: string;
  onChoisi: () => void;
  onConnecter: () => void;
}) {
  const [liste, setListe] = useState<ProprieteAnalytics[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchProprietes(slug).then(setListe, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [slug]);
  if (error)
    return (
      <div className="alert amber">
        <Icon name="info" />
        <div>{error}</div>
      </div>
    );
  if (!liste) return <div className="empty">Lecture des sites accessibles…</div>;
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Quel est votre site ?</h2>
      </div>
      <div className="panel-b stack">
        {liste.length === 0 ? (
          <p>
            Ce compte Google n'a accès à aucun site dans Google Analytics. Reconnectez-vous avec un
            autre compte, par exemple celui qui a créé le site.
          </p>
        ) : (
          <>
            <p className="small muted">Comptes et sites que ce compte Google peut lire :</p>
            {liste.map((p) => (
              <button
                key={p.id}
                className="btn"
                onClick={() =>
                  void choisirPropriete(slug, p.id, p.nom).then(onChoisi, (e: unknown) =>
                    setError(String(e)),
                  )
                }
              >
                {p.nom}
                {p.compte && <span className="muted small"> ({p.compte})</span>}
              </button>
            ))}
          </>
        )}
        <div>
          <button className="btn ghost sm" onClick={onConnecter}>
            Utiliser un autre compte Google
          </button>
        </div>
      </div>
    </div>
  );
}

export function SiteWeb({ slug }: { slug: string }) {
  const [etat, setEtat] = useState<EtatSiteWeb | null>(null);
  const [rapport, setRapport] = useState<RapportSite | null>(null);
  const [changer, setChanger] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const err = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const charger = useCallback(
    (frais = false) => {
      setError(null);
      fetchSiteWeb(slug).then((e) => {
        setEtat(e);
        if (e.connecte && e.propriete) fetchRapportSite(slug, frais).then(setRapport, err);
      }, err);
    },
    [slug],
  );
  useEffect(() => charger(), [charger]);

  const connecter = () =>
    connecterAnalytics(slug).then(({ url }) => {
      window.location.href = url;
    }, err);

  if (!etat) return error ? <div className="empty">{error}</div> : null;

  if (!etat.googleClientDisponible) {
    return (
      <div className="alert amber">
        <Icon name="lock" />
        <div>
          Le code secret Google de l'OS n'est pas encore enregistré :{' '}
          <a href={`#/${slug}/parametres`}>Paramètres &gt; Connexions</a>.
        </div>
      </div>
    );
  }

  if (!etat.connecte) {
    return (
      <div className="panel">
        <div className="panel-h">
          <h2>Connecter Google Analytics</h2>
        </div>
        <div className="panel-b stack">
          <p>
            L'OS lit l'audience de votre site dans Google Analytics, en lecture seule : il ne
            modifie rien. Choisissez le compte Google qui a accès aux statistiques du site ; si vous
            ne savez pas lequel, essayez votre compte habituel, l'OS vous dira s'il voit votre site.
          </p>
          <p className="small muted">
            Cette connexion est séparée de votre messagerie : elle ne change rien à Gmail ni à
            l'agenda.
          </p>
          {error && (
            <div className="alert amber">
              <Icon name="info" />
              <div>{error}</div>
            </div>
          )}
          <div>
            <button className="btn primary" onClick={() => void connecter()}>
              Connecter le compte Google Analytics
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!etat.propriete || changer) {
    return (
      <Choix
        slug={slug}
        onConnecter={() => void connecter()}
        onChoisi={() => {
          setChanger(false);
          setRapport(null);
          charger();
        }}
      />
    );
  }

  if (error) {
    return (
      <div className="stack">
        <div className="alert amber">
          <Icon name="info" />
          <div>{error}</div>
        </div>
        <div>
          <button className="btn sm" onClick={() => charger(true)}>
            Réessayer
          </button>{' '}
          <button className="btn sm ghost" onClick={() => void connecter()}>
            Reconnecter le compte Google
          </button>
        </div>
      </div>
    );
  }
  if (!rapport) return <div className="empty">Lecture de Google Analytics…</div>;
  return <Rapport r={rapport} onFrais={() => charger(true)} onChanger={() => setChanger(true)} />;
}
