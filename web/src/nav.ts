// Menu copied from the mockup (maquettes/os-commercial/js/core.js, NAV).
export type NavItem = { id: string; label: string; icon: string; module?: string };
export type NavGroup = { title: string; later?: boolean; items: NavItem[] };

const item = (id: string, label: string, icon: string, module?: string): NavItem => ({
  id,
  label,
  icon,
  module,
});

export const NAV: NavGroup[] = [
  {
    title: 'Pilotage',
    items: [
      item('routines', 'Routines Claude', 'clock'),
      item('brief', 'Brief du jour', 'sun'),
      item('validations', 'À valider', 'inbox'),
      item('tableau', 'Tableau de bord', 'chart'),
    ],
  },
  { title: 'Stratégie', items: [item('demarrage', 'Démarrage du mandat', 'flag', 'demarrage')] },
  {
    title: 'Générer la demande',
    items: [item('prospection', 'Prospection', 'send'), item('bases', 'Bases vivantes', 'db')],
  },
  {
    title: 'Convertir',
    items: [
      item('pipeline', 'Pipeline', 'kanban'),
      item('entreprises', 'Entreprises', 'building'),
      item('contacts', 'Contacts', 'users'),
      item('agenda', 'Rendez-vous', 'cal'),
      item('devis', 'Devis', 'file', 'devis'),
      item('relais', 'Relais internes', 'users', 'relais'),
    ],
  },
  { title: 'Réglages', items: [item('parametres', 'Paramètres', 'gear')] },
  {
    title: 'Plus tard',
    later: true,
    items: [
      item('plan', "Plan d'action", 'map'),
      item('diagnostic', 'Diagnostic', 'radar', 'diagnostic'),
      item('detection', 'Détection', 'pulse'),
      item('autonomie', 'Autonomie', 'sliders'),
      item('journal', "Journal d'audit", 'list'),
      item('cerveau', 'Second cerveau', 'brain'),
    ],
  },
];

// Screens already built in the real app; every other menu entry shows « Bientôt ».
export const BUILT = new Set([
  'brief',
  'validations',
  'pipeline',
  'entreprises',
  'contacts',
  'journal',
  'parametres',
  'tableau',
  'agenda',
  'devis',
  'routines',
]);

// Where each screen comes from in docs/plans/2026-10-08-implementation-maquette.md.
export const LOTS: Record<string, string> = {
  routines: 'Lot 12, Routines Claude',
  tableau: 'Lot 14, Tableau de bord',
  agenda: 'Lot 15, Rendez-vous et Devis',
  devis: 'Lot 15, Rendez-vous et Devis',
  prospection: 'M4, spécification à finir',
  bases: 'M4, spécification à finir',
};

export const isBuilt = (id: string) => BUILT.has(id);

export const allItems = () => NAV.flatMap((g) => g.items);

// A screen tied to a module (Devis: Marc's own brick) only exists in instances that have it.
export const allowed = (navItem: NavItem, modules: string[]) =>
  !navItem.module || modules.includes(navItem.module);

export type InstanceSummary = {
  slug: string;
  nom: string;
  sous: string;
  type: 'propre' | 'mandat' | 'prospect';
  couleur: string;
  modules: string[];
};

export const INSTANCE_GROUPS = [
  ['propre', 'Mon activité'],
  ['mandat', 'Mandats en cours'],
  ['prospect', 'Mandats prospects'],
] as const;

export function groupInstances(list: InstanceSummary[]) {
  return INSTANCE_GROUPS.map(([type, label]) => ({
    type,
    label,
    instances: list.filter((i) => i.type === type),
  })).filter((g) => g.instances.length > 0);
}

export const toggleFavori = (favoris: string[], id: string): string[] =>
  favoris.includes(id) ? favoris.filter((f) => f !== id) : [...favoris, id];

// Drag-and-drop in the Favourites group: moves `id` just before or after `cibleId`.
export function reorderFavoris(
  favoris: string[],
  id: string,
  cibleId: string,
  apres: boolean,
): string[] {
  if (id === cibleId || !favoris.includes(id) || !favoris.includes(cibleId)) return favoris;
  const rest = favoris.filter((f) => f !== id);
  const at = rest.indexOf(cibleId) + (apres ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
