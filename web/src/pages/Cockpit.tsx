import { Brief } from './Brief.js';
import { Inbox } from './Inbox.js';

type InboxProps = Parameters<typeof Inbox>[0];

// Le poste de pilotage : l'Inbox d'abord, là où l'on agit, puis le brief de la journée et ses repères.
export function Cockpit(props: InboxProps) {
  return (
    <div className="cockpit">
      <section className="cockpit-inbox" aria-label="Inbox">
        <Inbox {...props} />
      </section>
      <section className="cockpit-brief" aria-label="Brief du jour">
        <Brief slug={props.slug} />
      </section>
    </div>
  );
}
