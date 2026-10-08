import { useEffect, useState, type ReactNode } from 'react';
import { fetchPortefeuille, type PortefeuilleLigne } from '../api.js';
import { Icon } from '../icons.js';
import type { InstanceSummary } from '../nav.js';

const SITUATION: Record<InstanceSummary['type'], ReactNode> = {
  propre: <>Activité propre</>,
  mandat: <span className="badge blue">Mandat en cours</span>,
  prospect: <span className="badge amber">Mandat prospect</span>,
};

const compteur = (n: number | null) => (n === null ? <span className="muted">—</span> : n);

export function Portefeuille({ instances }: { instances: InstanceSummary[] }) {
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
    </>
  );
}
