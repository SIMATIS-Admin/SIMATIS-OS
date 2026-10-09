import { useEffect, useState, type ReactNode } from 'react';
import { creerProspect, fetchPortefeuille, type PortefeuilleLigne } from '../api.js';
import { Icon } from '../icons.js';
import type { InstanceSummary } from '../nav.js';

const SITUATION: Record<InstanceSummary['type'], ReactNode> = {
  propre: <>Activité propre</>,
  mandat: <span className="badge blue">Mandat en cours</span>,
  prospect: <span className="badge amber">Mandat prospect</span>,
};

const compteur = (n: number | null) => (n === null ? <span className="muted">—</span> : n);

function NouveauProspect({ onCreated }: { onCreated: () => void }) {
  const [nom, setNom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creer = () => {
    setBusy(true);
    setError(null);
    creerProspect(nom).then(
      (i) => {
        onCreated();
        location.hash = `#/${i.slug}/brief`;
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      },
    );
  };
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div className="panel-h">
        <h2>Nouveau mandat prospect</h2>
      </div>
      <div className="panel-b stack">
        <p style={{ margin: 0 }}>
          Un espace de démonstration aux données fictives, pour montrer l'OS à un prospect. Il
          n'écrit jamais dans un outil réel ; s'il signe, il devient un mandat (Paramètres).
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="Nom du prospect"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
          />
          <button className="btn primary" disabled={busy || !nom.trim()} onClick={creer}>
            Créer la démonstration
          </button>
        </div>
        {error && (
          <p className="small" style={{ color: 'var(--red)', margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function Portefeuille({
  instances,
  onCreated,
}: {
  instances: InstanceSummary[];
  onCreated: () => void;
}) {
  const [rows, setRows] = useState<PortefeuilleLigne[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPortefeuille().then(setRows, (e: unknown) => setError(String(e)));
  }, []);

  const couleur = (slug: string) => instances.find((i) => i.slug === slug)?.couleur ?? '#999';
  return (
    <>
      <div className="alert blue" style={{ marginBottom: 18 }}>
        <Icon name="lock" />
        <div>
          Cette vue ne montre que des compteurs. Aucun contact, aucun échange et aucun montant d'un
          mandat n'apparaît dans un autre.
        </div>
      </div>
      <div className="panel">
        {error && <div className="empty">{error}</div>}
        <table className="tbl">
          <thead>
            <tr>
              <th>Instance</th>
              <th>Situation</th>
              <th className="r">À valider</th>
              <th className="r">Tâches en retard</th>
              <th className="r">Rendez-vous 7 j</th>
              <th className="r">Routines actives</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr
                key={r.slug}
                className="click"
                onClick={() => (location.hash = `#/${r.slug}/entreprises`)}
              >
                <td>
                  <span
                    className="inst-dot"
                    style={{ display: 'inline-block', background: couleur(r.slug), marginRight: 8 }}
                  />
                  <b>{r.nom}</b>
                </td>
                <td>{SITUATION[r.type]}</td>
                <td className="r num">{r.aValider}</td>
                <td className="r num">{compteur(r.tachesEnRetard)}</td>
                <td className="r num">{compteur(r.rdv7j)}</td>
                <td className="r num">{compteur(r.routinesActives)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>
        Les tirets se rempliront avec les tâches, l'agenda et les routines. Cliquez sur une ligne
        pour ouvrir l'instance.
      </p>
      <NouveauProspect onCreated={onCreated} />
    </>
  );
}
