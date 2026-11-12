import type { SuspectBase } from '../../api.js';

// Suspects de la base vivante, pas encore dans le CRM : ils s'ouvrent et se travaillent dans les
// Bases vivantes, où vit leur historique de prospection.
export function SuspectsBase({ slug, suspects }: { slug: string; suspects: SuspectBase[] }) {
  if (suspects.length === 0) return null;
  return (
    <section className="com-suspects-base" aria-label="Suspects des Bases vivantes">
      <div className="panel-h">
        <b>Suspects des Bases vivantes</b>
        <span className="small muted">
          {suspects.length} fiche{suspects.length > 1 ? 's' : ''} pas encore dans le CRM
        </span>
        <a className="link" href={`#/${slug}/bases`}>
          Ouvrir les Bases vivantes
        </a>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Contact</th>
            <th>Entreprise</th>
            <th>Fonction</th>
            <th>Email</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {suspects.map((s) => (
            <tr key={s.id}>
              <td>{s.nom}</td>
              <td>{s.entreprise}</td>
              <td className="muted">{s.fonction ?? '—'}</td>
              <td className="muted">{s.email ?? '—'}</td>
              <td>Suspect</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
