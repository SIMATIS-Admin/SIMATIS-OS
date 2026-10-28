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
      item('inbox', 'Inbox', 'inbox'),
      item('tableau', 'Tableau de bord', 'chart'),
    ],
  },
  {
    title: 'Stratégie',
    items: [
      item('demarrage', 'Démarrage du mandat', 'flag', 'demarrage'),
      // Diagnostic et tests VMA réunis par entreprise (spec du 21 octobre 2026) ; la section s'appelle
      // « Outils et diagnostics » pour accueillir d'autres outils que le diagnostic.
      item('diagnostics', 'Outils et diagnostics', 'radar', 'diagnostic'),
    ],
  },
  {
    title: 'Générer la demande',
    items: [
      item('prospection', 'Prospection', 'send'),
      item('bases', 'Bases vivantes', 'db'),
      item('siteweb', 'Site web', 'globe', 'site-web'),
    ],
  },
  {
    title: 'Convertir',
    items: [
      item('pipeline', 'Pipeline', 'kanban'),
      item('entreprises', 'Entreprises', 'building'),
      item('contacts', 'Contacts', 'users'),
      item('agenda', 'Agenda', 'clock'),
      item('rendez-vous', 'Rendez-vous', 'cal'),
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
  'inbox',
  'pipeline',
  'entreprises',
  'contacts',
  'journal',
  'parametres',
  'tableau',
  'agenda',
  'rendez-vous',
  'devis',
  'diagnostics',
  'routines',
  'siteweb',
  'bases',
]);

// Where each screen comes from in docs/plans/2026-10-08-implementation-maquette.md.
export const LOTS: Record<string, string> = {
  routines: 'Lot 12, Routines Claude',
  tableau: 'Lot 14, Tableau de bord',
  agenda: 'Lot 15, Rendez-vous et Devis',
  devis: 'Lot 15, Rendez-vous et Devis',
  prospection: 'M4, spécification à finir',
};

export const isBuilt = (id: string) => BUILT.has(id);

// Former screen ids still found in bookmarks: « À valider » became the Inbox,
// and the Diagnostic and Tests VMA screens became one Diagnostics screen.
const ANCIENNES_VUES = new Map<string, string>([
  ['validations', 'inbox'],
  ['taches', 'agenda'],
  ['diagnostic', 'diagnostics'],
  ['tests-vma', 'diagnostics'],
]);
export const vueCanonique = (view: string) => ANCIENNES_VUES.get(view) ?? view;

export const allItems = () => NAV.flatMap((g) => g.items);

// A screen tied to a module (Devis: Marc's own brick) only exists in instances that have it.
export const allowed = (navItem: NavItem, modules: string[]) =>
  !navItem.module || modules.includes(navItem.module);

export type InstanceSummary = {
  slug: string;
  nom: string;
  sous: string;
  type: 'propre' | 'mandat' | 'prospect';
  // Mandate only (null otherwise): closing = qualified prospect with real data.
  phase: 'closing' | 'en_cours' | null;
  couleur: string;
  modules: string[];
};

// The technical type `prospect` is a demo (fictive data only).
export const INSTANCE_GROUPS = [
  ['propre', 'Mon activité'],
  ['en_cours', 'Mandats en cours'],
  ['closing', 'Mandats en Closing'],
  ['prospect', 'Démos'],
] as const;

export const groupeOf = (i: InstanceSummary) =>
  i.type === 'mandat' ? (i.phase ?? 'en_cours') : i.type;

export const libelleType = (i: Pick<InstanceSummary, 'type' | 'phase'>) =>
  i.type === 'propre'
    ? 'Mon activité'
    : i.type === 'prospect'
      ? 'Démo'
      : i.phase === 'closing'
        ? 'Mandat en Closing'
        : 'Mandat en cours';

export function groupInstances(list: InstanceSummary[]) {
  return INSTANCE_GROUPS.map(([type, label]) => ({
    type,
    label,
    instances: list.filter((i) => groupeOf(i) === type),
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
