import { LOTS } from '../nav.js';

export function Bientot({ view }: { view: string }) {
  return (
    <div className="panel">
      <div className="panel-b">
        <p>
          <b>Cet écran n'est pas encore construit.</b>
        </p>
        <p className="muted">
          Il arrive avec : {LOTS[view] ?? 'un lot à planifier'}. La maquette montre déjà son
          comportement.
        </p>
      </div>
    </div>
  );
}
