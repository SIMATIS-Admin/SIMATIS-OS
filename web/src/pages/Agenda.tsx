import { Taches } from './Taches.js';

// The Agenda: meetings on the calendar (Google and the CRM's timed meetings), tasks by day beside
// it. A Google meeting opens its row in Rendez-vous, where it is prepared and its compte rendu written.
export function Agenda({ slug }: { slug: string }) {
  return <Taches slug={slug} />;
}
