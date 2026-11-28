import type { ConnexionsReponse, PartenairesReponse, RoutineInfo, Sante } from './api.js';
import { allItems, isBuilt, type InstanceSummary } from './nav.js';

// Ce que l'organigramme sait de l'instance affichée. `null` : pas encore lu ou illisible, à ne pas
// confondre avec « non branché ».
export type EtatInstance = {
  connexions: ConnexionsReponse | null;
  partenaires: PartenairesReponse | null;
  routines: RoutineInfo[] | null;
  executeur: Sante['executeur'] | null;
};
export const ETAT_INCONNU: EtatInstance = {
  connexions: null,
  partenaires: null,
  routines: null,
  executeur: null,
};

// Fonctions de la note qui n'ont pas le nom d'une entrée du menu.
const VUES: Record<string, string> = {
  Inbox: 'cockpit',
  'Relais internes': 'relais',
  Gestion: 'gestion',
  'Feuille de route de l’OS': 'feuille-de-route-os',
  'Instances et modules': 'portefeuille',
  'Propositions et autonomie': 'parametres',
  'Routines et exécuteur': 'parametres',
  Connexions: 'parametres',
  'Commutateur Claude / Codex': 'parametres',
};
// Écrans hors menu, donc absents de la liste des écrans construits.
const HORS_MENU = new Set(['gestion', 'feuille-de-route-os', 'portefeuille']);
const MODULES: Record<string, string> = {
  devis: 'devis',
  diagnostics: 'diagnostic',
  atelier: 'atelier',
  siteweb: 'site-web',
  cerveau: 'cerveau',
  gestion: 'gestion',
  'feuille-de-route-os': 'cerveau',
  relais: 'relais',
  demarrage: 'demarrage',
};
const VUES_PROPRES = new Set(['gestion', 'feuille-de-route-os', 'atelier', 'devis']);
const FONCTIONS_PROPRES = new Set([
  'SalesNav',
  'Envoi par Chrome',
  'Messages LinkedIn',
  'Test de VMA',
]);

export const RESERVE = 'Réservé à Mon activité.';

export type Acces = { vue: string | null; raison: string | null; reservee: boolean };

const vueDe = (nom: string) => VUES[nom] ?? allItems().find((i) => i.label === nom)?.id;

// Où mène une fonction de la note dans une instance, ou pourquoi elle n'y est pas. Une sous-fonction
// suit l'écran de son parent.
export function accesFonction(
  nom: string,
  parent: string | undefined,
  instance: InstanceSummary,
): Acces {
  const vue = vueDe(nom) ?? (parent ? vueDe(parent) : undefined);
  const reservee = FONCTIONS_PROPRES.has(nom) || (!!vue && VUES_PROPRES.has(vue));
  const refus = (raison: string): Acces => ({ vue: null, raison, reservee });
  if (reservee && instance.type !== 'propre') return refus(RESERVE);
  if (!vue) return { vue: null, raison: null, reservee };
  const module = MODULES[vue];
  if (module && !instance.modules.includes(module))
    return refus('Module non activé dans cette instance.');
  if (!HORS_MENU.has(vue) && !isBuilt(vue)) return refus('Écran pas encore construit.');
  return { vue, raison: null, reservee };
}

export const libelleVue = (vue: string) =>
  ({
    gestion: 'Gestion',
    'feuille-de-route-os': 'Feuille de route de l’OS',
    portefeuille: 'Portefeuille',
  })[vue] ??
  allItems().find((i) => i.id === vue)?.label ??
  vue;

export type EtatSource = 'branche' | 'erreur' | 'absent' | 'inconnu' | 'indisponible';
export const LIBELLE_SOURCE: Record<EtatSource, string> = {
  branche: 'branché',
  erreur: 'en erreur',
  absent: 'non branché',
  inconnu: 'non vérifié',
  indisponible: 'pas dans cette instance',
};

export type Source = {
  id: string;
  nom: string;
  etat: EtatSource;
  // Par quel moyen les données entrent (ou sortent).
  moyen: string;
  // Où elles servent dans l'OS.
  alimente: string;
  // Écran qui permet de gérer la source.
  vue: string | null;
  // Dernier message d'erreur d'une connexion en panne.
  erreur?: string;
};

const FOURNISSEURS: Record<string, string> = {
  gmail: 'Gmail',
  infomaniak: 'Messagerie Infomaniak',
  'google-agenda': 'Google Agenda',
  hubspot: 'HubSpot',
  'crm-os': 'CRM compatible',
};

export function sources(instance: InstanceSummary, etat: EtatInstance): Source[] {
  const propre = instance.type === 'propre';
  const a = (module: string) => instance.modules.includes(module);
  const connexion = (kind: 'crm' | 'messagerie' | 'agenda', defaut: string) => {
    const c = etat.connexions?.connexions.find((x) => x.kind === kind);
    const statut: EtatSource = !etat.connexions
      ? 'inconnu'
      : !c || c.etat === 'non_configuree'
        ? 'absent'
        : c.etat === 'erreur'
          ? 'erreur'
          : 'branche';
    return {
      c,
      etat: statut,
      nom: c ? (FOURNISSEURS[c.fournisseur] ?? c.fournisseur) : defaut,
      erreur: statut === 'erreur' ? (c?.derniereErreur ?? undefined) : undefined,
    };
  };
  const messagerie = connexion('messagerie', 'Messagerie');
  const agenda = connexion('agenda', 'Agenda');
  const crm = connexion('crm', 'CRM du client');
  const routine = (...cles: string[]): EtatSource =>
    !etat.routines
      ? 'inconnu'
      : etat.routines.some((r) => cles.includes(r.cle) && r.actif)
        ? 'branche'
        : 'absent';

  return [
    {
      id: 'messagerie',
      nom: messagerie.nom,
      etat: messagerie.etat,
      erreur: messagerie.erreur,
      moyen:
        'Lecture des échanges et création de brouillons. Un envoi direct exige le double verrou.' +
        (etat.connexions?.secondeBoite ? ' Une seconde boîte est lue en lecture seule.' : ''),
      alimente: 'Cockpit, Inbox, fiches, Campagnes, Base des suspects',
      vue: 'parametres',
    },
    {
      id: 'agenda',
      nom: agenda.nom,
      etat: agenda.etat,
      erreur: agenda.erreur,
      moyen: 'Lecture seule des rendez-vous et des créneaux libres.',
      alimente: 'Agenda, Rendez-vous, créneaux proposés dans les mails',
      vue: 'parametres',
    },
    {
      id: 'crm',
      nom: crm.nom,
      etat: crm.etat,
      erreur: crm.erreur,
      moyen: !crm.c
        ? 'Sans CRM externe, l’OS tient lui-même le pipeline.'
        : crm.c.reglages.sens === 'deux_sens'
          ? 'Synchronisation dans les deux sens ; les écritures passent par le double verrou.'
          : 'Copie en lecture seule vers l’OS.' +
            (crm.c.degrade ? ' Connexion en mode dégradé (clé personnelle).' : ''),
      alimente: 'Pipeline, Entreprises, Contacts, tâches',
      vue: 'parametres',
    },
    {
      id: 'publiques',
      nom: 'Données publiques',
      etat: 'branche',
      moyen: 'Annuaire des entreprises et annonces du BODACC, en lecture.',
      alimente: 'Recherches, signaux, Base des suspects',
      vue: 'recherches',
    },
    {
      id: 'linkedin',
      nom: 'LinkedIn / SalesNav',
      etat: propre ? routine('linkedin', 'salesnav') : 'indisponible',
      moyen:
        'Notifications repérées dans la messagerie ; texte lu et demandes envoyées dans le Chrome du pilote.',
      alimente: 'Inbox, Radar',
      vue: propre ? 'radar' : null,
    },
    {
      id: 'reunions',
      nom: 'Réunions et visios',
      etat: propre ? routine('inbox') : 'indisponible',
      moyen:
        'Résumés Wispr Flow déposés par la routine Inbox ; visios enregistrées et transcrites sur le poste.',
      alimente: 'Inbox, Rendez-vous, comptes rendus',
      vue: propre ? 'rendez-vous' : null,
    },
    {
      id: 'siteweb',
      nom: 'Site web',
      etat: a('site-web') ? 'branche' : 'indisponible',
      moyen: 'Formulaire de contact relevé par l’OS, audience Google Analytics en lecture.',
      alimente: 'Inbox, Site web',
      vue: a('site-web') ? 'siteweb' : null,
    },
    {
      id: 'cerveau',
      nom: 'Second cerveau',
      etat: a('cerveau') ? 'branche' : 'indisponible',
      moyen: propre
        ? 'Notes privées (dépôt privé et Drive), lues et complétées par l’OS et les routines.'
        : 'Espace partagé uniquement : documents et messages échangés avec le partenaire.',
      alimente: 'Second cerveau, rédaction par Claude, Feuille de route',
      vue: a('cerveau') ? 'cerveau' : null,
    },
  ];
}

export type EtapeMoteur = {
  id: string;
  nom: string;
  mention: string | null;
  texte: string;
  vue: string | null;
};

// La chaîne qui va d'un déclenchement à une écriture dans un outil externe.
export function moteur(etat: EtatInstance): EtapeMoteur[] {
  const { routines, executeur, connexions } = etat;
  const actives = routines?.filter((r) => r.actif) ?? [];
  return [
    {
      id: 'routines',
      nom: 'Routines',
      mention: routines ? `${actives.length} sur ${routines.length} actives` : null,
      texte:
        'Tâches confiées à Claude, à heure fixe, sur événement ou à la demande.' +
        (actives.length ? ` Actives ici : ${actives.map((r) => r.nom).join(', ')}.` : ''),
      vue: 'parametres',
    },
    {
      id: 'executeur',
      nom: 'Exécuteur',
      mention: executeur ? (executeur.actif ? 'en marche' : 'à l’arrêt') : null,
      texte:
        'Programme du poste qui lance les routines avec Claude Code (ou Codex), avec un accès limité à une seule instance le temps de l’exécution.',
      vue: 'parametres',
    },
    {
      id: 'proposition',
      nom: 'L’IA propose',
      mention: null,
      texte: 'Brouillons, tâches et corrections sont déposés dans l’Inbox ou sur l’écran concerné.',
      vue: 'cockpit',
    },
    {
      id: 'validation',
      nom: 'Vous validez',
      mention: null,
      texte:
        'Le niveau d’autonomie de chaque action dit ce qui attend votre accord. Un envoi se valide toujours.',
      vue: 'parametres',
    },
    {
      id: 'verrou',
      nom: 'Double verrou',
      mention: connexions
        ? connexions.ecrituresReelles
          ? 'ouvert'
          : 'fermé : écritures simulées'
        : null,
      texte:
        'Une écriture dans un outil externe exige deux accords : le réglage du serveur et l’interrupteur de l’instance. Sinon elle est simulée.',
      vue: 'parametres',
    },
    {
      id: 'ecriture',
      nom: 'Outils externes',
      mention: null,
      texte:
        'Résultat : brouillons ou envois dans la messagerie, mise à jour du CRM, notes dans le second cerveau, messages au partenaire. Chaque action est inscrite au journal.',
      vue: 'parametres',
    },
  ];
}

export type Relais = { resume: string; partenaires: string[]; texte: string };

const TEXTE_RELAIS =
  'Le relais relie l’OS d’une instance à celui d’un partenaire, après échange d’un lien d’invitation. Chaque OS vient relever ses messages : le partenaire ne voit que les objets choisis, les missions reçues deviennent des propositions à valider et tout envoi passe par le double verrou. Un message déposé aussi dans l’espace partagé n’est compté qu’une fois.';

export function relais(instance: InstanceSummary, etat: EtatInstance): Relais {
  const p = etat.partenaires;
  const actifs = (p?.partenaires ?? [])
    .filter((x) => x.statut === 'active')
    .map((x) => {
      const niveau = p?.niveaux.find((n) => n.id === x.niveau)?.libelle ?? x.niveau;
      return `${x.nom} · autonomie : ${niveau}`;
    });
  const resume =
    instance.type === 'prospect'
      ? 'Pas de relais pour une démo.'
      : !p
        ? 'État du relais non vérifié.'
        : !p.actif
          ? 'Relais non configuré sur ce poste.'
          : !p.porteuse
            ? 'Les messages d’ici passent par le relais du mandat qui porte la connexion.'
            : actifs.length
              ? `${actifs.length} partenaire${actifs.length > 1 ? 's' : ''} relié${actifs.length > 1 ? 's' : ''}.`
              : 'Aucun partenaire relié à cette instance.';
  return { resume, partenaires: actifs, texte: TEXTE_RELAIS };
}
