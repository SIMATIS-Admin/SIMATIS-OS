import { useEffect, useState } from 'react';
import { fetchInstanceFiche, renameInstance, type InstanceFiche } from '../api.js';
import { Icon } from '../icons.js';
import type { InstanceSummary } from '../nav.js';
import { Tip } from './widgets.js';

const TYPE_NOM: Record<InstanceSummary['type'], string> = {
  propre: 'Mon activité',
  mandat: 'Mandat en cours',
  prospect: 'Mandat prospect',
};
const TYPE_BADGE: Record<InstanceSummary['type'], string> = {
  propre: 'green',
  mandat: 'blue',
  prospect: 'amber',
};

type Props = { slug: string; onRenamed: () => void };

export function Parametres({ slug, onRenamed }: Props) {
  const [fiche, setFiche] = useState<InstanceFiche | null>(null);
  const [nom, setNom] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchInstanceFiche(slug).then(
      (f) => {
        setFiche(f);
        setNom(f.nom);
      },
      (e: unknown) => setMessage(String(e)),
    );
  }, [slug]);

  if (!fiche) return message ? <div className="empty">{message}</div> : null;

  const save = () =>
    renameInstance(slug, nom).then(
      () => {
        setMessage('Nom enregistré.');
        onRenamed();
      },
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );

  return (
    <>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className="on">{fiche.type === 'propre' ? 'Activité' : 'Mandat'}</button>
        <button disabled title="Arrive avec le connecteur HubSpot (lot 8)">
          Connexions
        </button>
        <button disabled title="Arrive avec les routines Claude (lot 12)">
          Routines Claude
        </button>
      </div>
      <div className="alert blue" style={{ marginBottom: 18 }}>
        <Icon name="lock" />
        <div>
          Réglages de <b>{fiche.nom}</b> uniquement. Chaque instance a ses propres connexions ; les
          accès eux-mêmes ne sont jamais affichés.
        </div>
      </div>
      <div className="grid g2">
        <div className="panel">
          <div className="panel-h">
            <h2>{fiche.nom}</h2>
            <span className={`badge ${TYPE_BADGE[fiche.type]}`}>{TYPE_NOM[fiche.type]}</span>
          </div>
          <div className="panel-b">
            {fiche.type !== 'propre' && (
              <label className="field">
                <span>Nom affiché</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" value={nom} onChange={(e) => setNom(e.target.value)} />
                  <button
                    className="btn primary"
                    disabled={!nom.trim() || nom === fiche.nom}
                    onClick={() => void save()}
                  >
                    Enregistrer
                  </button>
                </div>
              </label>
            )}
            {message && <p className="small muted">{message}</p>}
            <table className="tbl small">
              <tbody>
                <tr>
                  <td className="muted">Type</td>
                  <td>{TYPE_NOM[fiche.type]}</td>
                </tr>
                <tr>
                  <td className="muted">Données</td>
                  <td>
                    {fiche.type === 'prospect'
                      ? 'Fictives, propres à cet espace'
                      : 'Copie de travail des outils du client'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">
                    Écritures réelles{' '}
                    <Tip text="Double verrou : il faut l'activer sur le serveur (REAL_WRITES) et pour cette instance. Sinon, toute écriture vers un outil tiers est simulée." />
                  </td>
                  <td>{fiche.ecrituresReelles ? 'Activées' : 'Désactivées (simulation)'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        {fiche.type === 'mandat' && (
          <div className="panel">
            <div className="panel-h">
              <h2>Fin de mandat</h2>
            </div>
            <div className="panel-b">
              <p style={{ margin: 0 }}>
                À la fin du mandat, l'instance est archivée puis sa copie de travail purgée. Rien à
                exporter : le client a déjà tout dans ses outils.
              </p>
            </div>
          </div>
        )}
        {fiche.type === 'prospect' && (
          <div className="panel">
            <div className="panel-h">
              <h2>Démonstration</h2>
            </div>
            <div className="panel-b">
              <p style={{ margin: 0 }}>
                Espace de démonstration aux données fictives. La réinitialisation et la
                transformation en mandat arrivent avec le lot 13.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
