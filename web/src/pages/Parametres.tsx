import { useEffect, useState } from 'react';
import {
  convertirProspect,
  fetchInstanceFiche,
  reinitialiserDemo,
  renameInstance,
  type InstanceFiche,
} from '../api.js';
import { Icon } from '../icons.js';
import type { InstanceSummary } from '../nav.js';
import { Connexions } from './parametres/Connexions.js';
import { RoutinesParametres } from './parametres/Routines.js';
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

// Two clicks for anything that deletes data: no browser dialog.
function Demonstration({ slug, onChange }: { slug: string; onChange: () => void }) {
  const [armed, setArmed] = useState<'reset' | 'convert' | null>(null);
  const [crm, setCrm] = useState<'hubspot' | 'aucun'>('hubspot');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>, done: string, then?: () => void) => {
    setBusy(true);
    setMessage(null);
    action()
      .then(
        () => {
          setMessage(done);
          onChange();
          then?.();
        },
        (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => {
        setBusy(false);
        setArmed(null);
      });
  };
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Démonstration</h2>
      </div>
      <div className="panel-b stack">
        <p style={{ margin: 0 }}>
          Espace aux données fictives. Réinitialiser remet le jeu de démonstration de départ.
        </p>
        <div>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              armed === 'reset'
                ? run(() => reinitialiserDemo(slug), 'Démonstration réinitialisée.')
                : setArmed('reset')
            }
          >
            {armed === 'reset' ? 'Confirmer la réinitialisation' : 'Réinitialiser la démo'}
          </button>
        </div>
        <hr />
        <p style={{ margin: 0 }}>
          Le prospect a signé ? Transformer en mandat supprime les données fictives ; il restera à
          brancher ses outils dans Connexions.
        </p>
        <label className="field">
          <span>CRM du client</span>
          <select
            className="input"
            value={crm}
            onChange={(e) => setCrm(e.target.value as 'hubspot' | 'aucun')}
          >
            <option value="hubspot">HubSpot</option>
            <option value="aucun">Pas de CRM : l'OS tient le pipeline</option>
          </select>
        </label>
        <div>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              armed === 'convert'
                ? run(
                    () => convertirProspect(slug, crm === 'hubspot' ? 'hubspot' : null),
                    'Mandat créé : branchez ses outils dans Connexions.',
                    () => location.reload(),
                  )
                : setArmed('convert')
            }
          >
            {armed === 'convert'
              ? 'Confirmer : supprimer les données fictives'
              : 'Transformer en mandat'}
          </button>
        </div>
        {message && <p className="small muted">{message}</p>}
      </div>
    </div>
  );
}

export function Parametres({ slug, onRenamed }: Props) {
  const [fiche, setFiche] = useState<InstanceFiche | null>(null);
  const [nom, setNom] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<'instance' | 'connexions' | 'routines'>(
    location.hash.includes('google=') ? 'connexions' : 'instance',
  );

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
        <button className={tab === 'instance' ? 'on' : ''} onClick={() => setTab('instance')}>
          {fiche.type === 'propre' ? 'Activité' : 'Mandat'}
        </button>
        <button className={tab === 'connexions' ? 'on' : ''} onClick={() => setTab('connexions')}>
          Connexions
        </button>
        <button className={tab === 'routines' ? 'on' : ''} onClick={() => setTab('routines')}>
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
      {tab === 'connexions' ? (
        <Connexions slug={slug} />
      ) : tab === 'routines' ? (
        <RoutinesParametres slug={slug} onConnexions={() => setTab('connexions')} />
      ) : (
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
                  À la fin du mandat, l'instance est archivée puis sa copie de travail purgée. Rien
                  à exporter : le client a déjà tout dans ses outils.
                </p>
              </div>
            </div>
          )}
          {fiche.type === 'prospect' && <Demonstration slug={slug} onChange={onRenamed} />}
        </div>
      )}
    </>
  );
}
