/* Données de démonstration : 100 % fictives (sociétés, personnes, montants, mandats).
   Aucune donnée réelle de client, de prospect ou de mandat. Dates relatives à aujourd'hui. */

const TODAY = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; })();
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dp = n => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return iso(d); };
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* Trois créneaux variés, jours ouvrés, entre 9h30-12h et 14h-17h (règle de rédaction du pilote). */
function creneauxD(offset) {
  const heures = ['9h30', '10h00', '11h00', '14h00', '15h30', '16h00', '10h30', '14h30'];
  const out = []; const d = new Date(TODAY); d.setDate(d.getDate() + 3 + (offset % 4)); let i = offset;
  while (out.length < 3) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      const h = heures[i % heures.length];
      out.push({ l: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' à ' + h, iso: iso(d), h });
      i += 3; d.setDate(d.getDate() + 2);
    } else d.setDate(d.getDate() + 1);
  }
  return out;
}
const creneaux = offset => creneauxD(offset).map(x => x.l);

const ETAPES = [
  { id: 'detection', nom: 'Détection' },
  { id: 'prospection', nom: 'Prospection' },
  { id: 'qualification', nom: 'Qualification' },
  { id: 'proposition', nom: 'Proposition' },
  { id: 'negociation', nom: 'Négociation' }
];

const CRITERES = [
  { id: 'besoin', nom: 'Besoin / enjeu', bas: 'flou ou mineur', haut: 'clair, critique, prioritaire' },
  { id: 'decideur', nom: 'Décideur / influence', bas: 'hors périmètre', haut: 'décideur impliqué' },
  { id: 'budget', nom: 'Budget', bas: 'aucun', haut: 'validé ou flexible' },
  { id: 'timing', nom: 'Timing', bas: 'plus de 12 mois', haut: 'moins de 3 mois ou échéance' },
  { id: 'engagement', nom: 'Engagement du prospect', bas: 'pas de réponse', haut: 'réactif, propose un RDV' }
];

const NIVEAUX = {
  L0: { nom: 'Suggère', d: "L'OS suggère, rien n'est écrit." },
  L1: { nom: 'Prépare', d: "L'OS prépare (brouillon, proposition), vous exécutez." },
  L2: { nom: 'Exécute après accord', d: "L'OS exécute après votre validation explicite." },
  L3: { nom: 'Exécute seul', d: "L'OS exécute seul (actions non destructives, sans engagement)." }
};

const AUTONOMIE_DEFAUT = [
  { id: 'lire', action: 'Lire CRM, messagerie, agenda, bases', niv: 'L3' },
  { id: 'brouillon', action: "Créer un brouillon d'email", niv: 'L1' },
  { id: 'envoi', action: 'Envoyer un email', niv: 'L2', min: 'L2', fixe: 'Jamais L3 : un envoi se valide toujours.' },
  { id: 'journal', action: 'Écrire dans une base (journal en ajout seul, statuts)', niv: 'L3' },
  { id: 'modif', action: "Modifier des valeurs existantes d'une base", niv: 'L2' },
  { id: 'masse', action: 'Modification de masse', niv: 'L2', fixe: 'Toujours avec simulation et instantané.' },
  { id: 'tache', action: 'Créer ou modifier une tâche CRM', niv: 'L2' },
  { id: 'cloture', action: 'Clôturer une tâche prouvée par un envoi réel', niv: 'L3' },
  { id: 'devis', action: 'Préparer un devis, fixer un prix ou une remise', niv: 'L1', fixe: 'Le prix est toujours fixé par le pilote.' },
  { id: 'transmettre', action: 'Transmettre un devis ou un engagement au client', niv: 'L2', fixe: 'Validation explicite obligatoire.' },
  { id: 'cerveau', action: 'Écrire dans le second cerveau', niv: 'L2', fixe: 'Toujours en brouillon, jamais validé par l\'OS.' },
  { id: 'suppr', action: 'Supprimer des données', niv: 'interdit', fixe: 'Interdit : on archive.' }
];

/* ------------------------------------------------------------------ */
/* Instances : une par activité ou mandat, cloisonnées.                 */
/* ------------------------------------------------------------------ */

const INSTANCES = [
  { id: 'simatis', nom: 'Mon activité', sous: 'Développement SIMATIS', outil: 'HubSpot (simulé)', crm: 'HubSpot', c: '#41A594', modules: ['diagnostic', 'devis'],
    conn: [['CRM', 'HubSpot SIMATIS', 'ok'], ['Messagerie', 'Gmail SIMATIS', 'ok'], ['Agenda', 'Agenda SIMATIS', 'ok']] },
  { id: 'helioval', nom: 'Helioval', sous: "Mandat fictif : bureau d'études", outil: 'HubSpot (simulé)', crm: 'HubSpot', situation: 'Système à structurer', c: '#4C8DD6', modules: ['relais'],
    conn: [['CRM', 'HubSpot du mandat', 'ok'], ['Messagerie', 'Gmail du mandat', 'ok'], ['Agenda', 'Agenda du mandat', 'ok']] },
  { id: 'aquaterra', nom: 'Aquaterra', sous: "Mandat fictif : équipements", outil: 'Pipeline natif', situation: 'Système à créer', c: '#9A7BE0', modules: ['demarrage'],
    conn: [['Pipeline', 'Pipeline natif de l\'OS', 'ok'], ['Messagerie', 'Gmail du mandat', 'non'], ['Agenda', 'Agenda du mandat', 'non']] },
  { id: 'demo', nom: 'Dupont Industrie', sous: 'Démonstration prospect', outil: 'Données fictives', c: '#E3A33B', demo: true, modules: ['diagnostic'],
    conn: [['CRM', 'Données fictives', 'ok'], ['Messagerie', 'Aucun envoi possible', 'ok'], ['Agenda', 'Agenda fictif', 'ok']] }
];

function seedInstance(cfg) {
  const d = {
    societes: cfg.societes, contacts: cfg.contacts, opps: cfg.opps,
    taches: cfg.taches || [], rdv: cfg.rdv || [], devis: cfg.devis || [],
    validations: cfg.validations || [], journal: cfg.journal || [], notes: cfg.notes || [],
    bases: cfg.bases || [], signaux: cfg.signaux || [], diagnostics: cfg.diagnostics || [],
    routines: cfg.routines.map(r => ({ ...r, params: { ...PARAMS_DEFAUT[r.id] } })), plan: cfg.plan, funnel: cfg.funnel, autonomie: AUTONOMIE_DEFAUT.map(a => ({ ...a })),
    relais: cfg.relais || [], campagnes: cfg.campagnes || [], temps: cfg.temps || 0,
    activites: activitesSeed(cfg.rythme ?? 1),
    reglages: JSON.parse(JSON.stringify(REGLAGES_DEFAUT))
  };
  return d;
}

/* Réglages des connexions, par instance (modifiés dans Paramètres). */
const CHAMPS_CRM = ['Nom et prénom', 'Email', 'Téléphone', 'Fonction', 'Propriétaire', 'Montant', 'Étape', 'Date de clôture', 'Notes', 'Historique des emails', 'Chiffre d\'affaires annuel', 'Champs personnalisés'];
const REGLAGES_DEFAUT = {
  crm: { freq: 'Toutes les 15 minutes', sens: 'Dans les deux sens', objets: ['entreprises', 'contacts', 'transactions', 'taches'], exclus: ['Chiffre d\'affaires annuel', 'Champs personnalisés'] },
  gmail: { histo: '12 mois', contenu: 'Extraits seulement' },
  agenda: { calendriers: 'Agenda principal', tampon: 15 }
};

/* Historique fictif des tâches réalisées, jour par jour, sur 45 jours ouvrés : emails, appels, autres tâches. */
function activitesSeed(r) {
  const out = [];
  if (!r) return out;
  for (let n = 1; n <= 45; n++) {
    const d = new Date(TODAY); d.setDate(d.getDate() - n);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    out.push({ date: iso(d), email: Math.round(((n * 7) % 9 + 3) * r), appel: Math.round(((n * 5) % 4 + 1) * r), autre: (n * 2) % 3 });
  }
  return out;
}

const email = (c, objet, lignes, slots, rappel) =>
  `<p>Bonjour ${c},</p>` + lignes.map(l => `<p>${l}</p>`).join('') +
  (slots ? `<p>Seriez-vous disponible à l'un de ces créneaux ?</p><ul>${slots.map(s => `<li>${s}</li>`).join('')}</ul>` : '') +
  `<p>Bien à vous,</p>`;

/* Les routines sont des skills Claude, exécutées avec les connexions de l'instance et d'aucune autre. */
/* Paramètres modifiables de chaque routine. Le rythme affiché en découle. */
const PARAMS_DEFAUT = {
  'r-quot': { heure: '7h00', jours: 'Jours ouvrés', max: 20, canaux: ['email', 'appel'], retard: 30, creneaux: 3, delai: 3, plages: '9h30-12h00 et 14h00-17h00' },
  'r-nett': { declenchement: 'Après chaque envoi de relances', suivi: 21 },
  'r-hebdo': { jour: 'Lundi', heure: '8h00' },
  'r-evt': { devis: 10, stop: true }
};
const routinesStd = (extra, crm = 'le pipeline') => [
  { id: 'r-quot', nom: 'Routine quotidienne de relance', rythme: 'Chaque jour ouvré à 7h00, ou à la demande', actif: true, dernier: dp(0), rapport: extra.quot,
    etapes: [`Lire les tâches de relance échues et du jour dans ${crm}`, 'Vérifier l\'historique de messagerie de chaque contact', 'Chercher trois créneaux libres dans l\'agenda', 'Rédiger les brouillons dans Gmail, sans signature', 'Préparer les fiches et le planning d\'appels', 'Produire le brief du jour'] },
  { id: 'r-nett', nom: 'Nettoyage des tâches après relance', rythme: 'Après chaque envoi de relances, ou à la demande', actif: true, dernier: dp(-1), rapport: { fait: ['3 tâches clôturées : envoi réel constaté'], attente: ['2 tâches de suivi proposées'], echec: [] },
    etapes: ['Constater dans Gmail les relances réellement envoyées', `Clôturer les tâches correspondantes dans ${crm}`, 'Proposer les tâches de suivi à recréer, à valider'] },
  { id: 'r-hebdo', nom: 'Revue hebdomadaire', rythme: 'Lundi à 8h00', actif: true, dernier: dp(-((TODAY.getDay() + 6) % 7)), rapport: extra.hebdo,
    etapes: [`Relire ${crm} par niveau de score`, 'Lister les devis à relancer et les causes de perte', 'Proposer des notes pour le second cerveau'] },
  { id: 'r-evt', nom: 'Sur événement', rythme: 'Nouveau lead, réponse reçue, devis sans réponse depuis 10 jours', actif: true, dernier: dp(-1), rapport: { fait: ['1 réponse reçue : séquence arrêtée'], attente: [], echec: [] },
    etapes: ['Qualifier le nouveau lead', 'Arrêter la séquence dès qu\'un contact répond', 'Préparer la relance d\'un devis sans réponse'] }
];

const SEED = () => {
  const data = {};

  /* ---------- Mon activité (SIMATIS) : HubSpot simulé ---------- */
  const sS = [
    { id: 's1', nom: 'Ateliers Morvan', secteur: 'Chaudronnerie', ville: 'Villefranche-sur-Saône', taille: 45, domaine: 'ateliers-morvan.fr' },
    { id: 's2', nom: 'Lumibat Systèmes', secteur: 'Éclairage industriel', ville: 'Grenoble', taille: 30, domaine: 'lumibat.fr' },
    { id: 's3', nom: 'Transports Gérard & Fils', secteur: 'Transport routier', ville: 'Valence', taille: 70, domaine: 'gerard-transports.fr' },
    { id: 's4', nom: 'Oxalis Conseil', secteur: 'Conseil RH', ville: 'Lyon', taille: 12, domaine: 'oxalis-conseil.fr' },
    { id: 's5', nom: 'Mécanique Bréval', secteur: 'Usinage de précision', ville: 'Annecy', taille: 58, domaine: 'breval-meca.fr' },
    { id: 's6', nom: 'Vitrage Rhodanien', secteur: 'Miroiterie', ville: 'Vienne', taille: 25, domaine: 'vitrage-rhodanien.fr' },
    { id: 's7', nom: 'Bio Sillon', secteur: 'Agroalimentaire', ville: 'Bourg-en-Bresse', taille: 40, domaine: 'biosillon.fr' },
    { id: 's8', nom: 'Kéramos Industrie', secteur: 'Céramique technique', ville: 'Limoges', taille: 85, domaine: 'keramos-industrie.fr' },
    { id: 's9', nom: 'Tôlerie Achard', secteur: 'Tôlerie fine', ville: 'Roanne', taille: 36, domaine: 'tolerie-achard.fr' },
    { id: 's10', nom: 'Distillerie Vauclair', secteur: 'Boissons', ville: 'Die', taille: 28, domaine: 'distillerie-vauclair.fr' },
    { id: 's11', nom: 'Plasturgie Mornand', secteur: 'Plasturgie', ville: 'Oyonnax', taille: 64, domaine: 'mornand-plasturgie.fr' },
    { id: 's12', nom: 'Électro-Savoie Services', secteur: 'Maintenance électrique', ville: 'Chambéry', taille: 42, domaine: 'electro-savoie.fr' }
  ];
  const cS = [
    { id: 'c1', soc: 's1', nom: 'Hélène Morvan', fonction: 'Dirigeante', email: 'h.morvan@ateliers-morvan.fr', role: 'Décideur' },
    { id: 'c2', soc: 's2', nom: 'Julien Roux', fonction: 'Gérant', email: 'j.roux@lumibat.fr', role: 'Décideur' },
    { id: 'c3', soc: 's3', nom: 'Sandrine Gérard', fonction: 'Directrice générale', email: 's.gerard@gerard-transports.fr', role: 'Décideur' },
    { id: 'c4', soc: 's4', nom: 'Thomas Weber', fonction: 'Associé fondateur', email: 't.weber@oxalis-conseil.fr', role: 'Décideur' },
    { id: 'c5', soc: 's5', nom: 'Pierre Bréval', fonction: 'Président', email: 'p.breval@breval-meca.fr', role: 'Décideur' },
    { id: 'c6', soc: 's6', nom: 'Nadia Benali', fonction: 'Directrice administrative', email: 'n.benali@vitrage-rhodanien.fr', role: 'Prescriptrice' },
    { id: 'c7', soc: 's7', nom: 'François Lacroix', fonction: 'Dirigeant', email: 'f.lacroix@biosillon.fr', role: 'Décideur' },
    { id: 'c8', soc: 's8', nom: 'Claire Dumas', fonction: 'Directrice commerciale adjointe', email: 'c.dumas@keramos-industrie.fr', role: 'Influenceuse' },
    { id: 'c9', soc: 's9', nom: 'Didier Achard', fonction: 'Gérant', email: 'd.achard@tolerie-achard.fr', role: 'Décideur' },
    { id: 'c10', soc: 's10', nom: 'Agnès Vauclair', fonction: 'Présidente', email: 'a.vauclair@distillerie-vauclair.fr', role: 'Décideur' },
    { id: 'c11', soc: 's11', nom: 'Karim Haddad', fonction: 'Directeur général', email: 'k.haddad@mornand-plasturgie.fr', role: 'Décideur' },
    { id: 'c12', soc: 's12', nom: 'Élodie Brun', fonction: 'Directrice', email: 'e.brun@electro-savoie.fr', role: 'Décideur' }
  ];
  const sc = (b, d, bu, t, e) => ({ besoin: b, decideur: d, budget: bu, timing: t, engagement: e });
  const oS = [
    { id: 'o1', soc: 's1', contact: 'c1', titre: 'Direction commerciale partagée', etape: 'proposition', montant: 24000, score: sc(3, 3, 2, 3, 3), potentiel: 'eleve', faisab: 'forte', source: 'Diagnostic', echeance: dp(2), prochaine: 'Relancer la proposition envoyée', maj: dp(-6) },
    { id: 'o2', soc: 's2', contact: 'c2', titre: 'Diagnostic puis plan d\'action', etape: 'qualification', montant: 9000, score: sc(2, 3, 1, 2, 2), potentiel: 'eleve', faisab: 'faible', source: 'Salon', echeance: dp(0), prochaine: 'Rendez-vous de diagnostic', maj: dp(-2) },
    { id: 'o3', soc: 's3', contact: 'c3', titre: 'Structuration de l\'équipe commerciale', etape: 'negociation', montant: 32000, score: sc(3, 3, 3, 2, 3), potentiel: 'eleve', faisab: 'forte', source: 'Recommandation', echeance: dp(5), prochaine: 'Point sur les conditions', maj: dp(-1) },
    { id: 'o4', soc: 's4', contact: 'c4', titre: 'Accompagnement prospection', etape: 'prospection', montant: 6000, score: sc(1, 3, 1, 1, 1), potentiel: 'limite', faisab: 'forte', source: 'LinkedIn', echeance: dp(-3), prochaine: 'Deuxième relance', maj: dp(-12) },
    { id: 'o5', soc: 's5', contact: 'c5', titre: 'Diagnostic d\'Endurance Commerciale', etape: 'qualification', montant: 18000, score: sc(2, 3, 2, 1, 2), potentiel: 'eleve', faisab: 'faible', source: 'Réseau', echeance: dp(4), prochaine: 'Restitution du diagnostic', maj: dp(-4) },
    { id: 'o6', soc: 's6', contact: 'c6', titre: 'Premier contact', etape: 'detection', montant: 0, score: sc(1, 1, 0, 1, 0), potentiel: 'limite', faisab: 'faible', source: 'Signal : recrutement', echeance: dp(7), prochaine: 'Identifier le dirigeant', maj: dp(-1) },
    { id: 'o7', soc: 's7', contact: 'c7', titre: 'Mise en place d\'un CRM et de rituels', etape: 'prospection', montant: 12000, score: sc(2, 3, 1, 2, 1), potentiel: 'limite', faisab: 'forte', source: 'Email', echeance: dp(1), prochaine: 'Proposer un diagnostic offert', maj: dp(-8) },
    { id: 'o8', soc: 's8', contact: 'c8', titre: 'Direction commerciale partagée', etape: 'detection', montant: 0, score: sc(2, 1, 1, 1, 0), potentiel: 'eleve', faisab: 'faible', source: 'Signal : nouveau site', echeance: dp(10), prochaine: 'Trouver un accès au dirigeant', maj: dp(-3) },
    { id: 'o9', soc: 's9', contact: 'c9', titre: 'Direction commerciale partagée', etape: 'negociation', clos: 'gagne', montant: 21000, score: sc(3, 3, 3, 3, 3), potentiel: 'eleve', faisab: 'forte', source: 'Réseau', echeance: dp(-20), prochaine: 'Démarrage de la mission', maj: dp(-20) },
    { id: 'o10', soc: 's10', contact: 'c10', titre: 'Diagnostic d\'Endurance Commerciale', etape: 'proposition', clos: 'perdu', motif: 'Budget reporté', montant: 7500, score: sc(2, 3, 1, 1, 2), potentiel: 'limite', faisab: 'forte', source: 'Salon', echeance: dp(-35), prochaine: 'Recontacter au prochain exercice', maj: dp(-35) },
    { id: 'o11', soc: 's11', contact: 'c11', titre: 'Structuration de l\'équipe commerciale', etape: 'qualification', clos: 'perdu', motif: 'Recrutement en interne', montant: 15000, score: sc(2, 2, 1, 1, 1), potentiel: 'eleve', faisab: 'faible', source: 'LinkedIn', echeance: dp(-50), prochaine: 'Aucune', maj: dp(-50) },
    { id: 'o12', soc: 's12', contact: 'c12', titre: 'Diagnostic puis plan d\'action', etape: 'negociation', clos: 'gagne', montant: 11000, score: sc(3, 3, 2, 3, 3), potentiel: 'eleve', faisab: 'forte', source: 'Recommandation', echeance: dp(-12), prochaine: 'Restitution du diagnostic', maj: dp(-12) }
  ];
  const vS = [
    { id: 'v1', type: 'email', niv: 'L1', titre: 'Relance de la proposition', soc: 's1', contact: 'c1', origine: 'Routine quotidienne', objet: 'Votre proposition de direction commerciale partagée',
      corps: email('Madame Morvan', '', ['Je reviens vers vous au sujet de la proposition transmise la semaine dernière pour Ateliers Morvan.', 'Je vous propose d\'en parler 30 minutes pour répondre à vos questions et ajuster le calendrier de démarrage si besoin.'], creneaux(0)),
      controles: ['Historique Gmail : 4 échanges, dernier il y a 6 jours', 'HubSpot : proposition envoyée, pas de réponse', 'Créneaux vérifiés dans votre agenda'], source: 'HubSpot + Gmail', confiance: 'élevée' },
    { id: 'v2', type: 'email', niv: 'L1', titre: 'Deuxième relance', soc: 's4', contact: 'c4', origine: 'Routine quotidienne', objet: 'Votre organisation commerciale',
      corps: email('Monsieur Weber', '', ['Nous avions échangé sur LinkedIn en septembre au sujet du développement commercial d\'Oxalis Conseil.', 'Le Diagnostic d\'Endurance Commerciale permet de situer en une heure trente la solidité de votre système de vente. Je vous le propose sans engagement.'], creneaux(1)),
      controles: ['Historique Gmail : 2 messages sans réponse', 'Escalade : deuxième relance (la suivante sera la porte de sortie)', 'Créneaux vérifiés dans votre agenda'], source: 'HubSpot + Gmail', confiance: 'élevée' },
    { id: 'v3', type: 'tache', niv: 'L2', titre: 'Créer une tâche de suivi', soc: 's5', contact: 'c5', origine: 'Routine quotidienne',
      detail: 'Restitution du diagnostic prévue : créer une tâche « Préparer la restitution » pour la veille du rendez-vous.', echeance: dp(3), source: 'Agenda', confiance: 'élevée' },
    { id: 'v4', type: 'note', niv: 'L2', titre: 'Note proposée pour le second cerveau', origine: 'Boucle d\'apprentissage',
      detail: 'Affaire perdue chez un prospect du transport : le dirigeant a préféré recruter un directeur commercial salarié. Enseignement proposé : poser dès le premier rendez-vous la question « recrutement ou temps partagé ? ».', destination: 'Méthodes > Démarrer un mandat', source: 'Clôture d\'affaire', confiance: 'moyenne' },
    { id: 'v5', type: 'tache', niv: 'L2', titre: 'Relance à planifier', soc: 's7', contact: 'c7', origine: 'Second cerveau : suivi des relances',
      detail: 'Dernier échange il y a 8 jours sans suite. Le suivi des relances prévoit un appel avant la troisième relance écrite : créer la tâche « Appeler Bio Sillon ».', echeance: dp(1), source: 'Second cerveau + Gmail', confiance: 'élevée' },
    { id: 'v6', type: 'tache', niv: 'L2', titre: 'Relance à planifier', soc: 's8', contact: 'c8', origine: 'Second cerveau : suivi des relances',
      detail: 'Signal repéré (ouverture d\'un second site), contact identifié mais pas encore sollicité. Créer la tâche « Premier message à Claire Dumas » sous une semaine.', echeance: dp(5), source: 'Second cerveau + Détection', confiance: 'moyenne' }
  ];
  data.simatis = seedInstance({
    societes: sS, contacts: cS, opps: oS, validations: vS,
    taches: [
      { id: 't1', titre: 'Relancer Ateliers Morvan', opp: 'o1', echeance: dp(-1), canal: 'email', fait: false },
      { id: 't2', titre: 'Deuxième relance Oxalis Conseil', opp: 'o4', echeance: dp(-3), canal: 'email', fait: false },
      { id: 't3', titre: 'Appeler Bio Sillon', opp: 'o7', echeance: dp(0), canal: 'appel', fait: false },
      { id: 't4', titre: 'Préparer la restitution Bréval', opp: 'o5', echeance: dp(3), canal: 'tâche', fait: false },
      { id: 't5', titre: 'Confirmer le rendez-vous de conditions', opp: 'o3', echeance: dp(0), canal: 'email', fait: false },
      { id: 't6', titre: 'Appeler Kéramos Industrie', opp: 'o8', echeance: dp(0), canal: 'appel', fait: false },
      { id: 't7', titre: 'Envoyer le compte rendu de diagnostic', opp: 'o2', echeance: dp(0), canal: 'tâche', fait: false }
    ],
    rdv: [
      { id: 'r1', opp: 'o2', titre: 'Diagnostic Lumibat Systèmes', date: dp(0), heure: '14h00', lieu: 'Visio', binome: null },
      { id: 'r2', opp: 'o3', titre: 'Conditions de démarrage, Gérard & Fils', date: dp(5), heure: '10h00', lieu: 'Valence', binome: null },
      { id: 'r3', opp: 'o5', titre: 'Restitution du diagnostic Bréval', date: dp(4), heure: '9h30', lieu: 'Annecy', binome: null }
    ],
    devis: [
      { id: 'd1', opp: 'o1', num: 'DEV-2026-014', statut: 'transmis', envoye: dp(-6), validite: dp(24), lignes: [{ l: 'Direction commerciale partagée, 1 jour par semaine (6 mois)', q: 1, pu: 24000 }] },
      { id: 'd2', opp: 'o3', num: 'DEV-2026-015', statut: 'brouillon', lignes: [{ l: 'Structuration de l\'équipe commerciale', q: 1, pu: null }, { l: 'Atelier de rituels commerciaux', q: 2, pu: null }] }
    ],
    signaux: [
      { id: 'g1', soc: 'Vitrage Rhodanien', type: 'Recrutement', txt: 'Offre d\'emploi « commercial sédentaire » publiée il y a 5 jours', date: dp(-5), source: 'Site emploi public', force: 'faible' },
      { id: 'g2', soc: 'Kéramos Industrie', type: 'Organisation', txt: 'Ouverture d\'un second site de production annoncée', date: dp(-3), source: 'Presse régionale', force: 'fort' },
      { id: 'g3', soc: 'Fromagerie des Combes', type: 'Personnes', txt: 'Nouveau directeur général nommé', date: dp(-2), source: 'LinkedIn', force: 'fort' },
      { id: 'g4', soc: 'Peintures Alpines', type: 'Cycle', txt: 'Fin d\'exercice fiscal dans 6 semaines', date: dp(-1), source: 'Registre public', force: 'faible' }
    ],
    diagnostics: [
      { id: 'dg1', soc: 's5', date: dp(-4), statut: 'Rapport à rédiger', dims: { outils: 7.2, strategie: 4.8, polyvalence: 3.5 } },
      { id: 'dg2', soc: 's1', date: dp(-30), statut: 'Restitué', dims: { outils: 5.1, strategie: 3.9, polyvalence: 2.2 } }
    ],
    bases: [
      { id: 'b1', nom: 'Prospects dirigeants PME', emplacement: 'Google Drive : Bases/prospects-dirigeants.xlsx', lignes: 412, onglets: ['Salon 2024', 'Réseau', 'LinkedIn', 'Synthèse'],
        statuts: { 'Non contacté': 241, 'Pas de réponse': 96, 'Réponse positive': 18, 'Réponse négative': 31, 'Invalide': 26 }, maj: dp(-1),
        cible: [['Secteurs', 'Industrie, BTP, services aux entreprises'], ['Taille', '20 à 100 salariés'], ['Zone', 'Auvergne-Rhône-Alpes'], ['Fonction visée', 'Dirigeant, président ou directeur général'], ['Repère temporel', 'Obligatoire : salon, réseau ou échange daté']], horsCible: 0.1 }
    ],
    journal: [
      { date: dp(-1), par: 'os', action: 'Journal de statuts écrit : 12 contacts passés en « Déjà contacté »', niv: 'L3' },
      { date: dp(-1), par: 'pilote', action: 'Brouillon validé : relance Bio Sillon', niv: 'L1' },
      { date: dp(-2), par: 'os', action: 'Lecture du pipeline et de l\'agenda pour le brief', niv: 'L3' }
    ],
    routines: routinesStd({
      quot: { fait: ['2 brouillons de relance préparés', '1 tâche de suivi proposée', 'Brief du jour produit'], attente: ['4 éléments à valider'], echec: [] },
      hebdo: { fait: ['Revue du pipeline par score', '1 note proposée pour le second cerveau'], attente: ['Devis Gérard & Fils : prix à fixer'], echec: [] }
    }, 'HubSpot'),
    plan: [
      { b: 'Cible', txt: 'PME industrielles BtoB de 20 à 100 salariés, Auvergne-Rhône-Alpes, sans directeur commercial. Persona : dirigeant fondateur.', ok: true },
      { b: 'Types d\'affaires visés', txt: 'Nouveaux clients d\'abord, puis recommandations du réseau.', ok: true },
      { b: 'Information et outillage', txt: 'HubSpot SIMATIS, base de prospects dirigeants, veille des signaux de recrutement commercial.', ok: true },
      { b: 'Message', txt: 'Enjeu : un système de vente qui tient dans la durée. Leviers dominants : Sécurité, Argent.', ok: true },
      { b: 'Règles de qualification', txt: 'Grille sur 15 ; au-dessus de 12, rendez-vous de cadrage ; entre 8 et 11, nourrir.', ok: true },
      { b: 'Plan de canaux', txt: 'Email et LinkedIn en séquence courte, diagnostic offert comme porte d\'entrée, réseau pour sécuriser.', ok: false },
      { b: 'Pilotage', txt: 'Taux de réponse, rendez-vous obtenus, opportunités qualifiées, pipeline par score.', ok: false }
    ],
    funnel: { leads: 60, l2p: 30, p2d: 45, d2c: 35, panier: 16000, objectif: 150000 },
    temps: 6, rythme: 0.7
  });

  /* ---------- Helioval (mandat fictif, CRM HubSpot simulé) ---------- */
  const sH = [
    { id: 'h1', nom: 'Fonderies du Gier', secteur: 'Fonderie', ville: 'Rive-de-Gier', taille: 120, domaine: 'fonderies-gier.fr' },
    { id: 'h2', nom: 'Laiterie Saint-Rambert', secteur: 'Agroalimentaire', ville: 'Saint-Rambert', taille: 90, domaine: 'laiterie-strambert.fr' },
    { id: 'h3', nom: 'Polytherm', secteur: 'Plasturgie', ville: 'Oyonnax', taille: 150, domaine: 'polytherm.fr' },
    { id: 'h4', nom: 'Clinique des Monts', secteur: 'Santé privée', ville: 'Chambéry', taille: 210, domaine: 'clinique-monts.fr' },
    { id: 'h5', nom: 'Imprimerie Vercors', secteur: 'Imprimerie', ville: 'Romans', taille: 48, domaine: 'imprimerie-vercors.fr' },
    { id: 'h6', nom: 'Scierie Bellecombe', secteur: 'Bois', ville: 'Albertville', taille: 35, domaine: 'scierie-bellecombe.fr' }
  ];
  const cH = [
    { id: 'hc1', soc: 'h1', nom: 'Marc-Antoine Ferrand', fonction: 'Directeur industriel', email: 'ma.ferrand@fonderies-gier.fr', role: 'Décideur' },
    { id: 'hc2', soc: 'h2', nom: 'Isabelle Chomel', fonction: 'Responsable QSE', email: 'i.chomel@laiterie-strambert.fr', role: 'Prescriptrice' },
    { id: 'hc3', soc: 'h3', nom: 'Rémi Garnier', fonction: 'Directeur de site', email: 'r.garnier@polytherm.fr', role: 'Décideur' },
    { id: 'hc4', soc: 'h4', nom: 'Sophie Martel', fonction: 'Directrice des services techniques', email: 's.martel@clinique-monts.fr', role: 'Décideur' },
    { id: 'hc5', soc: 'h5', nom: 'Yann Le Goff', fonction: 'Gérant', email: 'y.legoff@imprimerie-vercors.fr', role: 'Décideur' },
    { id: 'hc6', soc: 'h6', nom: 'Olivier Bellecombe', fonction: 'Dirigeant', email: 'o.bellecombe@scierie-bellecombe.fr', role: 'Décideur' }
  ];
  const oH = [
    { id: 'ho1', soc: 'h1', contact: 'hc1', titre: 'Audit des utilités', etape: 'proposition', montant: 14500, score: sc(3, 3, 2, 2, 2), potentiel: 'eleve', faisab: 'forte', source: 'Salon', echeance: dp(1), prochaine: 'Relancer le devis', maj: dp(-11) },
    { id: 'ho2', soc: 'h2', contact: 'hc2', titre: 'Étude de récupération de chaleur', etape: 'qualification', montant: 22000, score: sc(3, 1, 2, 2, 2), potentiel: 'eleve', faisab: 'faible', source: 'Base de prospection', echeance: dp(3), prochaine: 'Rendez-vous en binôme avec un chef de projet', maj: dp(-5) },
    { id: 'ho3', soc: 'h3', contact: 'hc3', titre: 'Accompagnement certification', etape: 'negociation', montant: 31000, score: sc(3, 3, 3, 3, 3), potentiel: 'eleve', faisab: 'forte', source: 'Client existant', echeance: dp(6), prochaine: 'Réponse sur la remise demandée', maj: dp(-2) },
    { id: 'ho4', soc: 'h4', contact: 'hc4', titre: 'Plan pluriannuel de travaux', etape: 'prospection', montant: 40000, score: sc(2, 2, 1, 1, 1), potentiel: 'eleve', faisab: 'faible', source: 'Base de prospection', echeance: dp(-2), prochaine: 'Première relance', maj: dp(-15) },
    { id: 'ho5', soc: 'h5', contact: 'hc5', titre: 'Audit réglementaire', etape: 'prospection', montant: 6800, score: sc(2, 3, 1, 2, 1), potentiel: 'limite', faisab: 'forte', source: 'Base de prospection', echeance: dp(2), prochaine: 'Appel de qualification', maj: dp(-6) },
    { id: 'ho6', soc: 'h6', contact: 'hc6', titre: 'Étude de faisabilité', etape: 'detection', montant: 0, score: sc(1, 3, 0, 1, 0), potentiel: 'limite', faisab: 'faible', source: 'Signal : agrandissement', echeance: dp(9), prochaine: 'Qualifier le projet', maj: dp(-1) },
    { id: 'ho7', soc: 'h4', contact: 'hc4', titre: 'Audit énergétique réglementaire', etape: 'negociation', clos: 'gagne', montant: 18000, score: sc(3, 3, 3, 3, 3), potentiel: 'eleve', faisab: 'forte', source: 'Client existant', echeance: dp(-25), prochaine: 'Mission en cours', maj: dp(-25) },
    { id: 'ho8', soc: 'h6', contact: 'hc6', titre: 'Étude de chaufferie bois', etape: 'proposition', clos: 'perdu', motif: 'Choix d\'un concurrent', montant: 9500, score: sc(2, 3, 2, 1, 1), potentiel: 'limite', faisab: 'forte', source: 'Base de prospection', echeance: dp(-40), prochaine: 'Aucune', maj: dp(-40) }
  ];
  const vH = [
    { id: 'hv1', type: 'email', niv: 'L1', titre: 'Relance du devis envoyé', soc: 'h1', contact: 'hc1', origine: 'Routine quotidienne', objet: 'Audit des utilités : votre devis',
      corps: email('Monsieur Ferrand', '', ['Je me permets de revenir vers vous au sujet du devis d\'audit des utilités transmis il y a dix jours.', 'Je vous propose un court échange pour revoir ensemble le périmètre et le calendrier.'], creneaux(2)),
      controles: ['HubSpot : devis envoyé, tâche de relance échue hier', 'Gmail du mandat : pas de réponse au dernier message', 'Créneaux vérifiés dans l\'agenda du mandat'], source: 'HubSpot + Gmail du mandat', confiance: 'élevée' },
    { id: 'hv2', type: 'base', niv: 'L2', titre: 'Mettre 14 contacts en « Invalide »', origine: 'Routine quotidienne',
      detail: '14 adresses ont rebondi définitivement lors de la dernière campagne. Simulation faite, instantané prêt.', source: 'Retours Gmail du mandat', confiance: 'élevée',
      diff: [['Responsable maintenance, Cartonnerie du Pilat', 'Pas de réponse', 'Invalide'], ['Directeur technique, Vernis Duclos', 'Non contacté', 'Invalide'], ['Gérante, Tissages de la Loire', 'Pas de réponse', 'Invalide']] },
    { id: 'hv3', type: 'tache', niv: 'L2', titre: 'Recréer une tâche de suivi', soc: 'h5', contact: 'hc5', origine: 'Routine quotidienne',
      detail: 'Relance envoyée hier avec trois créneaux proposés : suivi sur le même canal sous 21 jours.', echeance: dp(21), source: 'Gmail du mandat (envoi réel constaté)', confiance: 'élevée' },
    { id: 'hv4', type: 'accord', niv: 'L2', titre: 'Accord préalable d\'un expert', soc: 'h2', contact: 'hc2', origine: 'Règle du mandat',
      detail: 'Laiterie Saint-Rambert est suivie par une cheffe de projet. Avant tout contact, son accord est requis. Message interne préparé.', source: 'HubSpot : propriétaire du compte', confiance: 'élevée' }
  ];
  data.helioval = seedInstance({
    societes: sH, contacts: cH, opps: oH, validations: vH,
    taches: [
      { id: 'ht1', titre: 'Relancer le devis Fonderies du Gier', opp: 'ho1', echeance: dp(-1), canal: 'email', fait: false },
      { id: 'ht2', titre: 'Première relance Clinique des Monts', opp: 'ho4', echeance: dp(-2), canal: 'email', fait: false },
      { id: 'ht3', titre: 'Appeler Imprimerie Vercors', opp: 'ho5', echeance: dp(0), canal: 'appel', fait: false },
      { id: 'ht4', titre: 'Appeler Scierie Bellecombe', opp: 'ho6', echeance: dp(0), canal: 'appel', fait: false },
      { id: 'ht5', titre: 'Relancer Polytherm sur la remise', opp: 'ho3', echeance: dp(0), canal: 'email', fait: false },
      { id: 'ht6', titre: 'Caler le binôme Laiterie Saint-Rambert', opp: 'ho2', echeance: dp(0), canal: 'tâche', fait: false }
    ],
    rdv: [
      { id: 'hr1', opp: 'ho2', titre: 'Découverte Laiterie Saint-Rambert', date: dp(3), heure: '10h30', lieu: 'Sur site', binome: 'Cheffe de projet efficacité (fictive)' },
      { id: 'hr2', opp: 'ho3', titre: 'Négociation Polytherm', date: dp(0), heure: '16h00', lieu: 'Visio', binome: null }
    ],
    devis: [
      { id: 'hd1', opp: 'ho1', num: 'HV-2026-088', statut: 'transmis', envoye: dp(-11), validite: dp(19), lignes: [{ l: 'Audit des utilités, 3 jours sur site', q: 1, pu: 11000 }, { l: 'Rapport et restitution', q: 1, pu: 3500 }] },
      { id: 'hd2', opp: 'ho3', num: 'HV-2026-091', statut: 'transmis', envoye: dp(-4), validite: dp(26), lignes: [{ l: 'Accompagnement certification', q: 1, pu: 31000 }] }
    ],
    signaux: [
      { id: 'hg1', soc: 'Scierie Bellecombe', type: 'Organisation', txt: 'Permis de construire déposé pour un nouveau bâtiment', date: dp(-4), source: 'Registre public', force: 'fort' },
      { id: 'hg2', soc: 'Polytherm', type: 'Base installée', txt: 'Sujet repéré en mission : remplacement du compresseur évoqué par le client', date: dp(-2), source: 'Point mensuel chef de projet', force: 'fort' }
    ],
    bases: [
      { id: 'hb1', nom: 'Base prospects maître', emplacement: 'Drive du mandat : Base de données/base-maitre.xlsx', lignes: 1240, onglets: ['Salon 2023', 'Anciens prospects', 'Contacts réseau', 'Sales Navigator', 'Suivi Gmail', 'Synthèse'],
        statuts: { 'Non contacté': 702, 'Pas de réponse': 318, 'Réponse positive': 41, 'Réponse négative': 77, 'Invalide': 102 }, maj: dp(0), concurrent: true,
        cible: [['Secteurs', 'Industrie, agroalimentaire, santé privée'], ['Taille', 'Plus de 50 salariés'], ['Zone', 'Rhône-Alpes'], ['Fonction visée', 'Directeur technique, de site ou de maintenance'], ['Repère temporel', 'Obligatoire : salon, ancien échange ou réseau']], horsCible: 0.12 }
    ],
    campagnes: [
      { id: 'cp1', date: dp(-7), selection: 30, brouillons: 30, reponses: 3, rdv: 1, fichier: 'Statuts_exceptions_part7.csv' },
      { id: 'cp2', date: dp(-14), selection: 30, brouillons: 28, reponses: 4, rdv: 2, fichier: 'Statuts_exceptions_part6.csv' }
    ],
    relais: [
      { nom: 'Cheffe de projet A (fictive)', confies: 8, taches: 3, nonTraites: 2, prochain: dp(6) },
      { nom: 'Chef de projet B (fictif)', confies: 5, taches: 1, nonTraites: 0, prochain: dp(13) }
    ],
    journal: [
      { date: dp(-1), par: 'os', action: 'Tâche clôturée : relance réellement envoyée à Imprimerie Vercors', niv: 'L3' },
      { date: dp(-7), par: 'os', action: 'Journal de statuts écrit : Statuts_exceptions_part7.csv (30 lignes, ajout seul)', niv: 'L3' },
      { date: dp(-7), par: 'pilote', action: '30 brouillons de prospection validés', niv: 'L1' }
    ],
    routines: routinesStd({
      quot: { fait: ['1 tâche clôturée (envoi réel constaté)', '1 brouillon de relance de devis', 'Planning d\'appels : 2 appels'], attente: ['4 éléments à valider'], echec: ['Lecture HubSpot : 1 tentative reprise après limite de débit'] },
      hebdo: { fait: ['Revue du pipeline par score', 'Devis Polytherm : relance à prévoir'], attente: [], echec: [] }
    }, 'HubSpot'),
    plan: [
      { b: 'Cible', txt: 'Industriels et établissements de santé privés de plus de 50 salariés, consommateurs d\'énergie.', ok: true },
      { b: 'Types d\'affaires visés', txt: 'Clients existants (rebond d\'une offre à l\'autre), puis nouveaux clients issus de la base.', ok: true },
      { b: 'Information et outillage', txt: 'HubSpot du mandat, base prospects maître, points mensuels avec les chefs de projet.', ok: true },
      { b: 'Message', txt: 'Réduire la facture et sécuriser la conformité. Leviers : Argent, Sécurité.', ok: true },
      { b: 'Règles de qualification', txt: 'Grille sur 15 dans HubSpot, seuils standards.', ok: true },
      { b: 'Plan de canaux', txt: 'Email en campagnes de 30, appels de qualification, rendez-vous en binôme avec un expert.', ok: true },
      { b: 'Pilotage', txt: 'Bilan mensuel au dirigeant : rendez-vous, pipeline, conversions.', ok: true }
    ],
    funnel: { leads: 90, l2p: 20, p2d: 60, d2c: 40, panier: 15000, objectif: 400000 },
    temps: 14, rythme: 1.3
  });

  /* ---------- Aquaterra (mandat fictif, système à créer) ---------- */
  data.aquaterra = seedInstance({
    societes: [
      { id: 'a1', nom: 'GAEC des Trois Sources', secteur: 'Exploitation agricole', ville: 'Bourg-en-Bresse', taille: 6, domaine: 'gaec-troissources.fr' },
      { id: 'a2', nom: 'Pépinières Valmont', secteur: 'Horticulture', ville: 'Montélimar', taille: 22, domaine: 'pepinieres-valmont.fr' },
      { id: 'a3', nom: 'Golf du Lac Bleu', secteur: 'Loisirs', ville: 'Annecy', taille: 15, domaine: 'golf-lacbleu.fr' }
    ],
    contacts: [
      { id: 'ac1', soc: 'a1', nom: 'Bernard Guichard', fonction: 'Associé gérant', email: 'b.guichard@gaec-troissources.fr', role: 'Décideur' },
      { id: 'ac2', soc: 'a2', nom: 'Léa Valmont', fonction: 'Dirigeante', email: 'l.valmont@pepinieres-valmont.fr', role: 'Décideur' },
      { id: 'ac3', soc: 'a3', nom: 'Hugo Carrel', fonction: 'Directeur', email: 'h.carrel@golf-lacbleu.fr', role: 'Décideur' }
    ],
    opps: [
      { id: 'ao1', soc: 'a1', contact: 'ac1', titre: 'Client pilote testeur', etape: 'qualification', montant: 8500, score: sc(3, 3, 1, 2, 3), potentiel: 'eleve', faisab: 'forte', source: 'Prescripteur', echeance: dp(4), prochaine: 'Vérifier l\'aide mobilisable', maj: dp(-3) },
      { id: 'ao2', soc: 'a2', contact: 'ac2', titre: 'Équipement de deux serres', etape: 'prospection', montant: 15000, score: sc(2, 3, 1, 1, 1), potentiel: 'eleve', faisab: 'faible', source: 'Salon régional', echeance: dp(8), prochaine: 'Premier appel', maj: dp(-6) },
      { id: 'ao3', soc: 'a3', contact: 'ac3', titre: 'Arrosage du parcours', etape: 'detection', montant: 0, score: sc(1, 1, 1, 0, 0), potentiel: 'limite', faisab: 'faible', source: 'Signal : appel à projets', echeance: dp(15), prochaine: 'Qualifier le besoin', maj: dp(-2) }
    ],
    validations: [
      { id: 'av1', type: 'note', niv: 'L2', titre: 'Socle commercial à valider', origine: 'Démarrer un mandat',
        detail: 'Proposition de socle : offre (deux gammes), cas client pilote, dispositifs d\'aide à vérifier, critères de qualification adaptés aux petits exploitants.', destination: 'Fiche d\'instance Aquaterra', source: 'Entretien de démarrage', confiance: 'à confirmer' }
    ],
    taches: [
      { id: 'at1', titre: 'Valider le socle commercial', opp: null, echeance: dp(1), canal: 'tâche', fait: false },
      { id: 'at2', titre: 'Lister les prescripteurs institutionnels', opp: null, echeance: dp(5), canal: 'tâche', fait: false }
    ],
    routines: routinesStd({ quot: { fait: ['Brief du jour produit'], attente: ['1 élément à valider'], echec: [] }, hebdo: { fait: ['Revue du pipeline'], attente: [], echec: [] } }).map((r, i) => i === 0 ? r : { ...r, actif: i === 1 }),
    plan: [
      { b: 'Cible', txt: 'Petits exploitants et PME régionales, puis national. Persona : chef d\'exploitation.', ok: true },
      { b: 'Types d\'affaires visés', txt: 'Clients pilotes testeurs d\'abord, puis nouveaux clients.', ok: true },
      { b: 'Information et outillage', txt: 'Pipeline natif à créer avec le client, liste de prescripteurs.', ok: false },
      { b: 'Message', txt: '', ok: false },
      { b: 'Règles de qualification', txt: '', ok: false },
      { b: 'Plan de canaux', txt: '', ok: false },
      { b: 'Pilotage', txt: '', ok: false }
    ],
    funnel: { leads: 25, l2p: 35, p2d: 50, d2c: 40, panier: 9000, objectif: 120000 },
    temps: 4, rythme: 0.4
  });

  /* ---------- Démonstration : Dupont Industrie ---------- */
  data.demo = seedInstance({
    societes: [
      { id: 'd1', nom: 'Métallerie Roche', secteur: 'Métallerie', ville: 'Lyon', taille: 38, domaine: 'metallerie-roche.fr' },
      { id: 'd2', nom: 'Agro Delta', secteur: 'Agroalimentaire', ville: 'Mâcon', taille: 64, domaine: 'agrodelta.fr' },
      { id: 'd3', nom: 'Cartonnages Rival', secteur: 'Emballage', ville: 'Saint-Étienne', taille: 52, domaine: 'cartonnages-rival.fr' }
    ],
    contacts: [
      { id: 'dc1', soc: 'd1', nom: 'Laurent Roche', fonction: 'Gérant', email: 'l.roche@metallerie-roche.fr', role: 'Décideur' },
      { id: 'dc2', soc: 'd2', nom: 'Camille Faure', fonction: 'Directrice des achats', email: 'c.faure@agrodelta.fr', role: 'Décideur' },
      { id: 'dc3', soc: 'd3', nom: 'Antoine Rival', fonction: 'Président', email: 'a.rival@cartonnages-rival.fr', role: 'Décideur' }
    ],
    opps: [
      { id: 'do1', soc: 'd1', contact: 'dc1', titre: 'Pièces sur mesure', etape: 'qualification', montant: 18000, score: sc(3, 3, 2, 2, 1), potentiel: 'eleve', faisab: 'forte', source: 'Lead entrant', echeance: dp(2), prochaine: 'Préparer le devis', maj: dp(-1) },
      { id: 'do2', soc: 'd2', contact: 'dc2', titre: 'Contrat annuel', etape: 'proposition', montant: 42000, score: sc(3, 3, 3, 2, 2), potentiel: 'eleve', faisab: 'forte', source: 'Prospection', echeance: dp(3), prochaine: 'Relancer le devis', maj: dp(-9) },
      { id: 'do3', soc: 'd3', contact: 'dc3', titre: 'Renouvellement', etape: 'prospection', montant: 12000, score: sc(2, 3, 1, 1, 1), potentiel: 'limite', faisab: 'forte', source: 'Client existant', echeance: dp(6), prochaine: 'Proposer un point annuel', maj: dp(-4) }
    ],
    validations: [
      { id: 'dv1', type: 'email', niv: 'L1', titre: 'Relance du devis', soc: 'd2', contact: 'dc2', origine: 'Routine quotidienne', objet: 'Votre contrat annuel',
        corps: email('Madame Faure', '', ['Je reviens vers vous au sujet de notre proposition de contrat annuel.', 'Je vous propose de faire le point sur vos volumes prévisionnels.'], creneaux(3)),
        controles: ['CRM : devis envoyé il y a 9 jours', 'Messagerie : pas de réponse', 'Créneaux vérifiés dans l\'agenda'], source: 'Données fictives', confiance: 'élevée' }
    ],
    devis: [{ id: 'dd1', opp: 'do2', num: 'DEMO-001', statut: 'transmis', envoye: dp(-9), validite: dp(21), lignes: [{ l: 'Contrat annuel de fabrication', q: 1, pu: 42000 }] }],
    diagnostics: [{ id: 'ddg', soc: 'd1', date: dp(-2), statut: 'Exemple', dims: { outils: 6.5, strategie: 6.2, polyvalence: 3.1 } }],
    routines: routinesStd({ quot: { fait: ['Brief du jour produit', '1 brouillon de relance'], attente: ['1 élément à valider'], echec: [] }, hebdo: { fait: ['Revue du pipeline'], attente: [], echec: [] } }),
    plan: [
      { b: 'Cible', txt: 'Industriels de la région, 30 à 150 salariés.', ok: true },
      { b: 'Types d\'affaires visés', txt: 'Clients existants puis nouveaux clients.', ok: true },
      { b: 'Information et outillage', txt: 'CRM existant, base de prospects.', ok: true },
      { b: 'Message', txt: 'Fiabilité des délais. Leviers : Sécurité, Confort.', ok: true },
      { b: 'Règles de qualification', txt: 'Grille sur 15.', ok: true },
      { b: 'Plan de canaux', txt: 'Email, téléphone, visites.', ok: true },
      { b: 'Pilotage', txt: 'Revue hebdomadaire.', ok: true }
    ],
    funnel: { leads: 40, l2p: 30, p2d: 50, d2c: 35, panier: 20000, objectif: 250000 },
    signaux: [{ id: 'dg1', soc: 'Agro Delta', type: 'Projet', txt: 'Appel d\'offres annoncé pour le premier trimestre', date: dp(-2), source: 'Site public', force: 'fort' }],
    temps: 0
  });

  return data;
};

const DEMO_SCENARIO = [
  { v: 'diagnostic', t: 'Diagnostic', d: 'Le profil de l\'entreprise sur trois dimensions.' },
  { v: 'plan', t: 'Plan d\'action', d: 'La trame en sept blocs qui découle du diagnostic.' },
  { v: 'detection', t: 'Détection', d: 'Les signaux repérés sans contact.' },
  { v: 'prospection', t: 'Prospection', d: 'Sélection de contacts et brouillons, sans envoi.' },
  { v: 'pipeline', t: 'Lead qualifié', d: 'Score sur 15 et décision explicite.' },
  { v: 'validations', t: 'Relance', d: 'Le brouillon attend la décision du pilote.' },
  { v: 'brief', t: 'Brief et revue', d: 'Ce que le pilote voit chaque matin.' }
];
