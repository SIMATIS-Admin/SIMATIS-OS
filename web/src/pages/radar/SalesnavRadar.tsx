import { useEffect, useState } from 'react';
import {
  enregistrerReglagesSalesnav,
  fetchReglagesSalesnav,
  patchFiche,
  type ReglagesSalesnav,
} from '../../api.js';
import { SalesnavMessages } from '../SalesnavMessages.js';

export type AffaireSalesnav = {
  id: string;
  titre: string;
  entreprise: string;
  contact: string;
  etape: number;
  lien: string;
};

export const ETAPES_RADAR = ['À contacter', 'Contactées', 'À relancer', 'Ont répondu'] as const;

const message = (e: unknown) => (e instanceof Error ? e.message : 'Une erreur est survenue.');

const AVERTISSEMENTS: Record<ReglagesSalesnav['niveau'], string> = {
  normal: '',
  attention:
    'Au-delà de 15 demandes par jour, LinkedIn risque de restreindre votre compte. Montez progressivement.',
  danger:
    'Plus de 20 demandes par jour : le risque de restriction du compte est élevé. Baissez le quota.',
};

// Le quartier SalesNav du Radar : le quota de demandes par jour, l'avancement des opportunités qui
// arrivent par Sales Navigator (une par une ou par lot) et les messages à envoyer. Les opportunités
// restent celles du Radar ; cet écran ne fait que les regrouper par canal.
export function SalesnavRadar({
  slug,
  affaires,
  onRetour,
  onChange,
}: {
  slug: string;
  affaires: AffaireSalesnav[];
  onRetour: () => void;
  onChange: () => void;
}) {
  const [reglages, setReglages] = useState<ReglagesSalesnav | null>(null);
  const [quota, setQuota] = useState(8);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [etapeLot, setEtapeLot] = useState(1);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    fetchReglagesSalesnav(slug).then(
      (r) => {
        if (!actif) return;
        setReglages(r);
        setQuota(r.quotaJour);
      },
      (e: unknown) => actif && setErreur(message(e)),
    );
    return () => {
      actif = false;
    };
  }, [slug]);

  const enregistrer = async (r: { quotaJour?: number; pause?: boolean }) => {
    setErreur(null);
    try {
      const nouveau = await enregistrerReglagesSalesnav(slug, r);
      setReglages(nouveau);
      setQuota(nouveau.quotaJour);
      setInfo('Réglage enregistré.');
    } catch (e) {
      setErreur(message(e));
    }
  };

  const appliquer = async (ids: string[], champs: Record<string, unknown>) => {
    setErreur(null);
    setInfo(null);
    const resultats = await Promise.allSettled(
      ids.map((id) => patchFiche(slug, 'affaire', id, champs)),
    );
    const echecs = resultats.filter((r) => r.status === 'rejected').length;
    if (echecs > 0)
      setErreur(`${echecs} affaire${echecs > 1 ? 's n’ont' : ' n’a'} pas été mise à jour.`);
    else setInfo(`${ids.length} affaire${ids.length > 1 ? 's mises' : ' mise'} à jour.`);
    setSelection(new Set());
    onChange();
  };

  const niveau = reglages
    ? quota > 20
      ? 'danger'
      : quota > 15
        ? 'attention'
        : 'normal'
    : 'normal';
  const parEtape = ETAPES_RADAR.map((nom, i) => ({
    nom,
    nombre: affaires.filter((a) => a.etape === i).length,
  }));
  const bascule = (id: string) =>
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const ids = [...selection];

  return (
    <section className="salesnav-radar" aria-label="SalesNav">
      <header className="sr-entete">
        <button type="button" className="btn" onClick={onRetour}>
          ← Retour au Radar
        </button>
        <h2>SalesNav</h2>
        <span className="muted small">
          {affaires.length} opportunité{affaires.length > 1 ? 's' : ''}
        </span>
      </header>
      {erreur && (
        <p role="alert" className="salesnav-erreur">
          {erreur}
        </p>
      )}
      {info && !erreur && (
        <p role="status" className="muted small">
          {info}
        </p>
      )}

      <div className="sr-quota">
        <h3>Demandes de connexion par jour</h3>
        <label>
          <span className="sr-valeur">
            {quota} par jour · {quota * 5} par semaine
          </span>
          <input
            type="range"
            aria-label="Demandes par jour"
            min={0}
            max={reglages?.quotaMax ?? 25}
            step={1}
            value={quota}
            onChange={(e) => setQuota(Number(e.target.value))}
          />
        </label>
        <p className="muted small">
          Recommandé au départ : {reglages?.recommande ?? 8} par jour, puis {reglages?.cible ?? 12}{' '}
          si le taux d’acceptation reste bon. Montez de 2 par semaine.
        </p>
        {AVERTISSEMENTS[niveau] && (
          <p role="alert" className={`sr-alerte sr-${niveau}`}>
            {AVERTISSEMENTS[niveau]}
          </p>
        )}
        <div className="sr-actions">
          <button
            type="button"
            className="btn primary"
            disabled={!reglages || quota === reglages.quotaJour}
            onClick={() => void enregistrer({ quotaJour: quota })}
          >
            Enregistrer le quota
          </button>
          <label className="sr-pause">
            <input
              type="checkbox"
              checked={reglages?.pause ?? false}
              disabled={!reglages}
              onChange={(e) => void enregistrer({ pause: e.target.checked })}
            />
            Mettre le canal en pause
          </label>
        </div>
      </div>

      <div className="sr-etapes" aria-label="Avancement des opportunités SalesNav">
        {parEtape.map((e) => (
          <div key={e.nom} className="sr-etape">
            <strong>{e.nombre}</strong>
            <span>{e.nom}</span>
          </div>
        ))}
      </div>

      <div className="sr-liste">
        <h3>Opportunités</h3>
        {affaires.length === 0 ? (
          <p className="muted small">
            Aucune opportunité par ce canal pour le moment. Ajoutez-en depuis « Ajouter au Radar »
            en choisissant le canal SalesNav.
          </p>
        ) : (
          <>
            <div className="sr-lot" aria-label="Actions sur la sélection">
              <span className="small">
                {ids.length} sélectionnée{ids.length > 1 ? 's' : ''}
              </span>
              <label>
                <span className="small">Passer à l’étape</span>
                <select
                  aria-label="Étape à appliquer"
                  value={etapeLot}
                  onChange={(e) => setEtapeLot(Number(e.target.value))}
                >
                  {ETAPES_RADAR.map((nom, i) => (
                    <option key={nom} value={i}>
                      {nom}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn"
                disabled={ids.length === 0}
                onClick={() => void appliquer(ids, { radarEtapeManuelle: etapeLot })}
              >
                Appliquer
              </button>
              <button
                type="button"
                className="btn"
                disabled={ids.length === 0}
                onClick={() => void appliquer(ids, { radarCanalManuel: 'À préciser' })}
              >
                Sortir de SalesNav
              </button>
            </div>
            <ul className="sr-affaires">
              {affaires.map((a) => (
                <li key={a.id}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${a.titre}`}
                      checked={selection.has(a.id)}
                      onChange={() => bascule(a.id)}
                    />
                  </label>
                  <a href={a.lien} className="sr-nom">
                    <strong>{a.entreprise || a.titre}</strong>
                    <span className="muted small">{a.contact || a.titre}</span>
                  </a>
                  <select
                    aria-label={`Étape de ${a.titre}`}
                    value={a.etape}
                    onChange={(e) =>
                      void appliquer([a.id], { radarEtapeManuelle: Number(e.target.value) })
                    }
                  >
                    {ETAPES_RADAR.map((nom, i) => (
                      <option key={nom} value={i}>
                        {nom}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <details className="sr-messages">
        <summary>Messages d’invitation et de relance</summary>
        <SalesnavMessages slug={slug} />
      </details>
    </section>
  );
}
