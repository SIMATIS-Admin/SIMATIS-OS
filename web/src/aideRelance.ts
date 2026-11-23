import type { Evenement, Pipeline, PipelineOpp, PropositionItem, TacheVue } from './api.js';
import { etapeRadar } from './radar.js';

// L'aide à la relance : réunit en une file courte ce que Marc peut faire tout de suite, à partir de
// trois sources déjà connues de l'OS (tâches en retard, affaires sans activité, Radar). Aucun
// envoi : l'OS prépare, Marc relit et envoie.
export type SourceAction = 'retard' | 'aujourdhui' | 'dormante' | 'radar';
export type Raison = { source: SourceAction; jours: number | null; texte: string };
export type ActionRelance = {
  // Clé stable d'une entreprise (ou d'une affaire sans entreprise) : une seule ligne par clé.
  id: string;
  entreprise: string;
  contact: string | null;
  email: string | null;
  telephone: string | null;
  canal: 'mail' | 'appel';
  raisons: Raison[];
  // Étape de l'affaire (libellé) et montant, pour situer l'enjeu.
  etape: string | null;
  montant: number | null;
  opportuniteId: string | null;
  contactId: string | null;
  entrepriseId: string | null;
  // Mandat dont vient l'action quand ce n'est pas l'espace affiché (« Mon activité » réunit les
  // tâches de ses mandats) ; null : l'espace courant.
  instance: { slug: string; nom: string; couleur: string | null } | null;
  // Slug du mandat concerné, toujours renseigné : sert au filtre « mandats affichés ».
  mandat: string | null;
  tacheIds: string[];
  derniereActivite: string | null;
  // Rien d'autre qu'une tâche en retard depuis plus de 30 jours : probablement périmée.
  ancienne: boolean;
  tri: number[];
};

// Une action écartée ou reportée : clé → instant (ms) jusqu'auquel elle reste cachée.
export type Masquees = Record<string, number>;
export const POUR_TOUJOURS = 8.64e15;

const JOUR = 86_400_000;
export const RETARD_ANCIEN = 30;
const normaliser = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Une même entreprise peut exister dans deux mandats : la clé porte alors le mandat. Pour l'espace
// courant elle reste celle des versions précédentes, afin de garder les reports déjà faits.
const cleDe = (entreprise: string | null, secours: string, mandat: string | null = null) => {
  const base = entreprise?.trim() ? `ent:${normaliser(entreprise)}` : secours;
  return mandat ? `${mandat}|${base}` : base;
};

export function comparerTri(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

type Entree = {
  pipeline: Pick<Pipeline, 'etapes' | 'opportunites' | 'inactiviteJours'>;
  enRetard: TacheVue[];
  // Tâches dont l'échéance est aujourd'hui (HubSpot comme OS) : elles se font maintenant, sans retard.
  duJour?: TacheVue[];
  maintenant?: Date;
  masquees?: Masquees;
  // Espace affiché : ses tâches gardent la clé simple, celles des autres mandats portent leur slug.
  slugCourant?: string;
};

// Ordre de priorité : tâche en retard (la plus ancienne d'abord), puis affaire sans activité la plus
// avancée dans le pipeline, puis signal du Radar (a répondu, à relancer, à contacter).
export function construireFile({
  pipeline,
  enRetard,
  duJour = [],
  maintenant = new Date(),
  masquees = {},
  slugCourant,
}: Entree): ActionRelance[] {
  const parCle = new Map<string, ActionRelance>();
  const obtenir = (cle: string, base: () => ActionRelance) => {
    let a = parCle.get(cle);
    if (!a) {
      a = base();
      parCle.set(cle, a);
    }
    return a;
  };
  const vide = (cle: string, entreprise: string, mandat: string | null): ActionRelance => ({
    id: cle,
    entreprise,
    contact: null,
    email: null,
    telephone: null,
    canal: 'mail',
    raisons: [],
    etape: null,
    montant: null,
    opportuniteId: null,
    contactId: null,
    entrepriseId: null,
    instance: null,
    mandat,
    tacheIds: [],
    derniereActivite: null,
    ancienne: false,
    tri: [3],
  });
  const poser = (a: ActionRelance, tri: number[]) => {
    if (comparerTri(tri, a.tri) < 0) a.tri = tri;
  };

  for (const t of [...enRetard, ...duJour]) {
    if (t.fait || (t.canal !== 'email' && t.canal !== 'appel')) continue;
    const nom = t.entreprise?.nom ?? t.opportunite?.titre ?? t.contact?.nom ?? t.titre;
    const autre = t.instance && t.instance.slug !== slugCourant ? t.instance : null;
    const cle = cleDe(t.entreprise?.nom ?? null, `tache:${t.id}`, autre?.slug ?? null);
    const a = obtenir(cle, () => vide(cle, nom, autre?.slug ?? slugCourant ?? null));
    const duJourMeme = duJour.includes(t);
    const jours = duJourMeme
      ? 0
      : t.echeance
        ? Math.max(1, Math.floor((maintenant.getTime() - Date.parse(t.echeance)) / JOUR))
        : 1;
    a.raisons.push({ source: duJourMeme ? 'aujourdhui' : 'retard', jours, texte: t.titre });
    a.tacheIds.push(t.id);
    a.instance ??= autre;
    a.contact ??= t.contact?.nom ?? null;
    a.contactId ??= t.contact?.id ?? null;
    a.email ??= t.contact?.email ?? null;
    a.telephone ??= t.contact?.telephone ?? null;
    a.entrepriseId ??= t.entreprise?.id ?? null;
    a.opportuniteId ??= t.opportunite?.id ?? null;
    if (t.canal === 'appel') a.canal = 'appel';
    // Une tâche en retard depuis plus d'un mois est probablement périmée : elle passe après les
    // affaires sans activité et les signaux du Radar, plus frais.
    // Une tâche du jour passe après les retards (le plus ancien d'abord), avant le reste.
    poser(a, jours > RETARD_ANCIEN ? [2.5, -jours] : [0, -jours]);
  }

  const etapesRadar = new Set(pipeline.etapes.slice(0, 2).map((e) => e.id));
  const rangEtape = new Map(pipeline.etapes.map((e, i) => [e.id, i]));
  const libelleEtape = new Map(pipeline.etapes.map((e) => [e.id, e.label]));
  const rejoindre = (o: PipelineOpp, raison: Raison, tri: number[], appel = false) => {
    const cle = cleDe(o.entreprise, `opp:${o.id}`);
    const a = obtenir(cle, () => vide(cle, o.entreprise ?? o.titre, slugCourant ?? null));
    a.raisons.push(raison);
    a.opportuniteId ??= o.id;
    a.contact ??= o.contact;
    a.etape ??= libelleEtape.get(o.etape) ?? null;
    a.montant ??= o.montant;
    a.derniereActivite ??= o.derniereActivite;
    if (appel) a.canal = 'appel';
    poser(a, tri);
  };

  for (const o of pipeline.opportunites) {
    if (o.clos) continue;
    if (etapesRadar.has(o.etape)) {
      const e = etapeRadar(o);
      const n = o.tentatives ?? 0;
      if (e === 3)
        rejoindre(o, { source: 'radar', jours: null, texte: 'A répondu : à traiter' }, [2, 0]);
      else if (e === 2)
        rejoindre(
          o,
          { source: 'radar', jours: null, texte: `${n} tentative(s) sans réponse : à relancer` },
          [2, 1],
          n >= 3,
        );
      else if (e === 0)
        rejoindre(
          o,
          { source: 'radar', jours: null, texte: 'Première prise de contact à faire' },
          [2, 2],
        );
    } else if (o.joursInactif !== null && o.joursInactif > pipeline.inactiviteJours) {
      rejoindre(
        o,
        {
          source: 'dormante',
          jours: o.joursInactif,
          texte: `Aucune activité depuis ${o.joursInactif} jours`,
        },
        [1, -(rangEtape.get(o.etape) ?? 0), -o.joursInactif],
      );
    }
  }

  for (const a of parCle.values())
    a.ancienne = a.raisons.every((r) => r.source === 'retard' && (r.jours ?? 0) > RETARD_ANCIEN);

  return [...parCle.values()]
    .filter((a) => (masquees[a.id] ?? 0) <= maintenant.getTime())
    .sort((x, y) => comparerTri(x.tri, y.tri));
}

// ---- Textes préparés ---------------------------------------------------------------------------

const CIVILITES = /^(m\.?|mme\.?|mlle\.?|monsieur|madame|mademoiselle|dr\.?|pr\.?)$/i;
// Le prénom seul (« Bonjour Landry »), jamais le nom de famille : on écarte les civilités et les
// mots tout en majuscules (« DUPONT Jeanne »). Même règle que la salutation des mails du serveur.
export function prenomDe(nomComplet: string | null | undefined): string {
  const mots = (nomComplet ?? '')
    .trim()
    .split(/\s+/)
    .filter((m) => m && !CIVILITES.test(m));
  const enMajuscules = (m: string) =>
    m.length > 1 && m === m.toUpperCase() && m !== m.toLowerCase();
  return mots.find((m) => !enMajuscules(m)) ?? mots[0] ?? '';
}

export type Angle = 'repondu' | 'froid' | 'relance' | 'suivi';
export function angleDe(a: ActionRelance): Angle {
  if (a.raisons.some((r) => r.source === 'retard' || r.source === 'aujourdhui')) return 'suivi';
  if (a.raisons.some((r) => r.source === 'dormante')) return 'relance';
  if (a.raisons.some((r) => r.texte.startsWith('A répondu'))) return 'repondu';
  return a.raisons.some((r) => r.texte.includes('sans réponse')) ? 'relance' : 'froid';
}

const CORPS: Record<Angle, string> = {
  repondu:
    'Merci pour votre retour. Je vous propose un échange de 20 minutes pour voir concrètement ce que cela peut vous apporter et répondre à vos questions.',
  froid:
    'Je propose aux dirigeants un point de 20 minutes sur leur organisation commerciale, sans engagement. Seriez-vous disponible dans les prochains jours ?',
  relance:
    "Je me permets de revenir vers vous : où en est votre réflexion ? S'il reste un point à éclaircir, je peux vous répondre rapidement.",
  suivi:
    'Je reviens vers vous pour faire suite à notre dernier échange et voir comment avancer ensemble. Auriez-vous quelques minutes cette semaine ?',
};
const OBJETS: Record<Angle, string> = {
  repondu: 'Suite à votre retour',
  froid: 'Un point sur votre organisation commerciale',
  relance: 'Où en êtes-vous ?',
  suivi: 'Suite à notre échange',
};

// Mail prêt à relire : salutation au prénom seul, corps selon l'angle, sans signature (celle de la
// messagerie). Les créneaux libres seront ajoutés avec les brouillons Gmail.
export function redigerMail(a: ActionRelance): { objet: string; corps: string } {
  const angle = angleDe(a);
  const prenom = prenomDe(a.contact);
  return {
    objet: OBJETS[angle],
    corps: `${prenom ? `Bonjour ${prenom},` : 'Bonjour,'}\n\n${CORPS[angle]}`,
  };
}

export type FicheAppel = { objectif: string; ouverture: string; questions: string[] };
const OBJECTIFS: Record<Angle, string> = {
  repondu: 'Répondre à ses questions et fixer un rendez-vous.',
  froid: 'Se présenter et proposer un premier échange de 20 minutes.',
  relance: 'Savoir où il en est et lever le point qui bloque.',
  suivi: 'Reprendre le fil du dernier échange et décider de la suite.',
};
export function ficheAppel(a: ActionRelance): FicheAppel {
  const prenom = prenomDe(a.contact);
  return {
    objectif: OBJECTIFS[angleDe(a)],
    ouverture: `${prenom ? `Bonjour ${prenom}, c'est` : "Bonjour, c'est"} Marc de SIMATIS. Avez-vous un instant ?`,
    questions: [
      "Où en est l'organisation commerciale aujourd'hui ?",
      "Qui d'autre faut-il associer à la discussion ?",
    ],
  };
}

// Suite proposée une fois l'action faite (tâche à planifier) : délai en jours.
export type Suite = { libelle: string; canal: 'email' | 'appel' | null; jours: number };
// Sans numéro connu, aucune suite par téléphone n'est proposée : on ne planifie pas un appel impossible.
export function suitesProposees(
  canal: 'mail' | 'appel',
  resultat?: string,
  avecTelephone = true,
): Suite[] {
  const aucune: Suite = { libelle: 'Aucune suite', canal: null, jours: 0 };
  if (canal === 'mail')
    return [
      ...(avecTelephone
        ? [{ libelle: 'Relancer par téléphone dans 5 jours', canal: 'appel', jours: 5 } as Suite]
        : []),
      { libelle: 'Relancer par mail dans 7 jours', canal: 'email', jours: 7 },
      aucune,
    ];
  if (resultat === 'joint')
    return [{ libelle: 'Envoyer un mail récapitulatif demain', canal: 'email', jours: 1 }, aucune];
  return [
    { libelle: 'Rappeler dans 2 jours', canal: 'appel', jours: 2 },
    { libelle: 'Envoyer un mail dans 2 jours', canal: 'email', jours: 2 },
    aucune,
  ];
}

// ---- Brouillons préparés par la routine ----------------------------------------------------------

const ENTITES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
// Les mails arrivent parfois avec leurs entités (« qu&#39;un ») : on les remet en caractères.
export const decoderEntites = (texte: string): string =>
  texte.replace(/&(?:nbsp|amp|lt|gt|quot|#39|#\d{1,6});/g, (e) => {
    if (ENTITES[e]) return ENTITES[e];
    const code = Number(e.slice(2, -1));
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : e;
  });
// Texte lisible d'un mail HTML : l'aperçu n'insère jamais de HTML dans la page.
export function htmlEnTexte(html: string): string {
  const sansBalises = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n\n')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '');
  return decoderEntites(sansBalises)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Le brouillon que la routine a déjà préparé pour cette action : par tâche liée, sinon par contact.
export function brouillonPour(
  action: ActionRelance,
  propositions: PropositionItem[],
): PropositionItem | null {
  const brouillons = propositions.filter(
    (p) => p.type === 'email.brouillon' && p.statut === 'proposee',
  );
  const tache = brouillons.find((p) => {
    const id = p.contenu.tacheId;
    return typeof id === 'string' && action.tacheIds.includes(id);
  });
  if (tache) return tache;
  return (
    brouillons.find((p) => action.contactId !== null && p.contenu.contactId === action.contactId) ??
    null
  );
}

// Mandats cochés : une action d'un mandat décoché n'est ni listée ni proposée en séquence.
export const dansMandats = (a: ActionRelance, masques: string[]) =>
  !a.mandat || !masques.includes(a.mandat);

// ---- Situation : tout ce qui s'est passé avec le contact ---------------------------------------

// Mails de la messagerie et événements de la fiche (notes, appels, rendez-vous, étapes, activités
// faites) en une seule chronologie, du plus récent au plus ancien. Quand la messagerie a répondu,
// ses mails font foi : les emails de la fiche seraient des doublons.
export function chronologie(mails: Evenement[] | null, fiche: Evenement[]): Evenement[] {
  const vus = new Set<string>();
  return [...(mails ?? []), ...fiche.filter((e) => mails === null || e.type !== 'email')]
    .filter((e) => (vus.has(e.id) ? false : (vus.add(e.id), true)))
    .sort((a, b) => b.at.localeCompare(a.at));
}

// ---- Ventiler : étaler les actions choisies sur plusieurs jours ouvrés -------------------------

export const PAR_JOUR_MAX = 5;
export const JOURS_MIN = 3;

// Le jour ouvré numéro `k` après `depuis` (le jour 0 est `depuis` lui-même), à 9 h. Samedi et
// dimanche sont sautés : une action reportée un week-end réapparaîtrait sans que Marc travaille.
export function jourOuvre(depuis: Date, k: number): Date {
  const d = new Date(depuis);
  d.setHours(9, 0, 0, 0);
  for (let restant = k; restant > 0;) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) restant--;
  }
  return d;
}

// Répartit les actions, dans l'ordre reçu, au plus PAR_JOUR_MAX par jour et sur au moins JOURS_MIN
// jours ouvrés, avec des paquets de taille presque égale (10 actions : 4, 3, 3). Le premier paquet
// reste pour aujourd'hui ; on rend seulement les autres, avec le jour (à 9 h) où elles reviennent.
export function ventiler(
  ids: string[],
  depuis: Date = new Date(),
): { id: string; jusqua: number }[] {
  const jours = Math.min(ids.length, Math.max(JOURS_MIN, Math.ceil(ids.length / PAR_JOUR_MAX)));
  if (jours <= 1) return [];
  const base = Math.floor(ids.length / jours);
  const reste = ids.length % jours;
  const resultat: { id: string; jusqua: number }[] = [];
  let debut = 0;
  for (let j = 0; j < jours; j++) {
    const taille = base + (j < reste ? 1 : 0);
    if (j > 0) {
      const jusqua = jourOuvre(depuis, j).getTime();
      for (const id of ids.slice(debut, debut + taille)) resultat.push({ id, jusqua });
    }
    debut += taille;
  }
  return resultat;
}
