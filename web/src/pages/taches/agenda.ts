// What the Agenda puts where: meetings (timed) on the hour grid, tasks (dated) in their day.
import type { RdvAgenda, TacheVue } from '../../api.js';
import { plusJours } from './commun.js';
import { jourParis } from './creneaux.js';

export const MIME_TACHE = 'application/x-simatis-tache';

// One colour per kind of activity, repeated in the legend.
export const COULEUR_TYPE: Record<TacheVue['type'], string> = {
  appel: '#2f8f5b',
  email: '#3b7dd8',
  tache: '#7d8ba0',
  echeance: '#c0442e',
  reunion: '#7b5cc4',
  dejeuner: '#d9822b',
};

// Meetings of the main agenda in the SIMATIS teal; the other agendas each get their own colour.
export const COULEUR_RDV = '#41a594';
const PALETTE_AGENDAS = ['#e3a33b', '#4c8dd6', '#d9675b', '#33b679', '#8e6c4a', '#c2185b'];

export function couleurRdv(r: Pick<RdvAgenda, 'agenda' | 'couleur'>): string {
  if (r.couleur) return r.couleur;
  if (r.agenda === 'primary') return COULEUR_RDV;
  let h = 0;
  for (const c of r.agenda) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE_AGENDAS[h % PALETTE_AGENDAS.length] ?? COULEUR_RDV;
}

// A meeting or lunch with a time is a rendez-vous; everything else is a task of its day.
export const estRendezVous = (t: TacheVue) =>
  t.avecHeure && (t.type === 'reunion' || t.type === 'dejeuner');

// The days an all-day event covers (Google's end date is exclusive).
export function joursCouverts(r: RdvAgenda): string[] {
  const premier = jourParis(r.debut);
  if (!r.journee) return [premier];
  const dernier = jourParis(r.fin);
  const jours = [premier];
  for (let j = plusJours(premier, 1); j < dernier && jours.length < 60; j = plusJours(j, 1)) {
    jours.push(j);
  }
  return jours;
}
