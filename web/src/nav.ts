// Menu copied from the mockup (maquettes/os-commercial/js/core.js, NAV).
export type NavItem = {
  id: string;
  label: string;
  icon: string;
  module?: string;
  // Écran en bêta : une pastille s'affiche à côté du nom.
  beta?: boolean;
};
export type NavGroup = { title: string; later?: boolean; items: NavItem[] };

const item = (id: string, label: string, icon: string, module?: string): NavItem => ({
  id,
  label,
  icon,
  module,
});

// « Mon espace » : l'arborescence complète de l'OS, rangée par rubrique (spec du 13 novembre 2026).
// Le Cockpit s'y trouve aussi ; le menu l'affiche en plus tout en haut, toujours visible.
export const NAV: NavGroup[] = [
  {
    title: 'Ma journée',
    items: [item('cockpit', 'Cockpit', 'sun'), item('agenda', 'Agenda', 'clock')],
  },
  {
    title: 'Détecter',
    items: [
      item('radar', 'Radar', 'radar'),
      // Campagnes et Base des suspects gardent les écrans Prospection et Bases vivantes.
      item('recherches', 'Recherches', 'search'),
      item('icp', 'ICP', 'flag'),
      item('prospection', 'Campagnes', 'send'),
      item('bases', 'Base des suspects', 'db'),
    ],
  },
  {
    title: 'Vendre',
    items: [
      item('pipeline', 'Pipeline', 'kanban'),
      item('rendez-vous', 'Rendez-vous', 'cal'),
      item('devis', 'Devis', 'file', 'devis'),
      // Diagnostic et tests VMA réunis par entreprise (spec du 21 octobre 2026) ; la section s'appelle
      // « Outils et diagnostics » pour accueillir d'autres outils que le diagnostic.
      item('diagnostics', 'Outils et diagnostics', 'radar', 'diagnostic'),
      item('relais', 'Relais internes', 'users', 'relais'),
    ],
  },
  {
    title: 'Ma base',
    items: [item('entreprises', 'Entreprises', 'building'), item('contacts', 'Contacts', 'users')],
  },
  {
    title: "Piloter l'activité",
    items: [
      // Atelier de lancement d'un mandat : stratégie, objectifs, ICP, feuille de route (spec du 28 octobre 2026).
      { ...item('atelier', 'Atelier stratégique', 'map', 'atelier'), beta: true },
      item('tableau', 'Tableau de bord', 'chart'),
      item('cerveau', 'Second cerveau', 'brain', 'cerveau'),
      item('demarrage', 'Démarrage du mandat', 'flag', 'demarrage'),
    ],
  },
  {
    title: 'Plus',
    later: true,
    items: [
      item('routines', 'Automatismes', 'clock'),
      item('cours', 'Supports', 'file'),
      item('siteweb', 'Site web', 'globe', 'site-web'),
      item('parametres', 'Paramètres', 'gear'),
      item('plan', "Plan d'action", 'map'),
      item('detection', 'Détection', 'pulse'),
      item('autonomie', 'Autonomie', 'sliders'),
      item('journal', "Journal d'audit", 'list'),
    ],
  },
];

// Screens already built in the real app; every other menu entry shows « Bientôt ».
export const BUILT = new Set([
  'cockpit',
  'radar',
  'recherches',
  'icp',
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
  'atelier',
  'routines',
  'siteweb',
  'bases',
  'cerveau',
  'prospection',
  'cours',
]);

// Where each screen comes from in docs/plans/2026-10-08-implementation-maquette.md.
export const LOTS: Record<string, string> = {
  routines: 'Lot 12, Routines Claude',
  tableau: 'Lot 14, Tableau de bord',
  agenda: 'Lot 15, Rendez-vous et Devis',
  devis: 'Lot 15, Rendez-vous et Devis',
};

export const isBuilt = (id: string) => BUILT.has(id);

// Former screen ids still found in bookmarks: « À valider » became the Inbox, then the Inbox and
// the Brief became the Cockpit,
// and the Diagnostic and Tests VMA screens became one Diagnostics screen.
const ANCIENNES_VUES = new Map<string, string>([
  ['validations', 'cockpit'],
  ['brief', 'cockpit'],
  ['inbox', 'cockpit'],
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
