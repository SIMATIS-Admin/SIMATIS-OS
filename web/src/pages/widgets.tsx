// Small display pieces copied from the mockup (core.js gauge, who, tip).
import { Icon } from '../icons.js';

const NIVEAUX: Record<string, { nom: string; d: string }> = {
  L0: { nom: 'Suggère', d: "L'OS suggère, rien n'est écrit." },
  L1: { nom: 'Prépare', d: "L'OS prépare (brouillon, proposition), vous exécutez." },
  L2: { nom: 'Exécute après accord', d: "L'OS exécute après votre validation explicite." },
  L3: { nom: 'Exécute seul', d: "L'OS exécute seul (actions non destructives, sans engagement)." },
};

export function Gauge({ niveau }: { niveau: string }) {
  const def = NIVEAUX[niveau];
  if (!def) return <span className="badge">{niveau}</span>;
  const n = Number(niveau.slice(1));
  return (
    <span className={`gauge l${n}`} title={def.d}>
      <i>
        {[0, 1, 2, 3].map((k) => (
          <b key={k} className={k <= n ? 'on' : ''} />
        ))}
      </i>
      <strong>{niveau}</strong> {def.nom}
    </span>
  );
}

export function Who({ acteur }: { acteur: string }) {
  if (acteur === 'pilote') {
    return (
      <span className="who pilote">
        <span className="dot" />
        Décidé par vous
      </span>
    );
  }
  const label = acteur.startsWith('agent:')
    ? `Agent ${acteur.slice('agent:'.length)}`
    : acteur === 'systeme'
      ? 'Système'
      : "Préparé par l'OS";
  return (
    <span className="who">
      <span className="dot" />
      {label}
    </span>
  );
}

export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" tabIndex={0} role="img" aria-label={text} data-tip={text}>
      <Icon name="info" />
    </span>
  );
}
