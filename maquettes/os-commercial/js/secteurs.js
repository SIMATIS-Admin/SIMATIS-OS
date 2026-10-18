/* Diagnostic : modèles fictifs par activité, choix du modèle et de l'effort des assistants.
   Vocabulaire et rôles inspirés de sources publiques (offres d'emploi, salons, annonces) ; aucun chiffre réel,
   aucune entreprise réelle. Tous les noms sont inventés. */

const SECTEURS = [
  {
    id: 'usinage', nom: 'Usinage et chaudronnerie',
    societes: [
      { nom: 'Forge Démo Lyon', secteur: 'Forge et estampage', ville: 'Lyon', taille: 48 },
      { nom: 'Chaudronnerie Exemple Alpes', secteur: 'Chaudronnerie soudée', ville: 'Annecy', taille: 35 },
      { nom: 'Mécanique Test Rhône', secteur: 'Usinage de précision', ville: 'Villeurbanne', taille: 62 },
      { nom: 'Tôlerie Modèle Savoie', secteur: 'Tôlerie fine', ville: 'Chambéry', taille: 27 },
      { nom: 'Atelier Fictif Dauphiné', secteur: 'Décolletage', ville: 'Grenoble', taille: 110 },
      { nom: 'Ferrage Démo Jura', secteur: 'Pièces mécaniques', ville: 'Oyonnax', taille: 41 },
      { nom: 'Usinage Exemple Bresse', secteur: 'Usinage sur plan', ville: 'Bourg-en-Bresse', taille: 19 },
      { nom: 'Soudure Modèle Ain', secteur: 'Soudage et assemblage', ville: 'Belley', taille: 33 }
    ],
    offres: ['Sous-traitance de pièces en série', 'Usinage de précision sur plan', 'Chaudronnerie soudée, petites séries', 'Maintenance industrielle annuelle', 'Pièce test puis commande récurrente', 'Pièces de rechange sur stock'],
    plan: [
      'PME industrielles de 20 à 150 salariés qui sous-traitent déjà un usinage ou une chaudronnerie.',
      'Donneurs d\'ordre réguliers, nouvelles pièces, pièces de rechange.',
      'Annuaires industriels, salons régionaux, offres « méthodes » ou « achats » qui signalent un besoin.',
      'Capacités, délais et certifications en un dossier technique court, adressé au responsable méthodes.',
      'Grille sur 15 : faisabilité, volume, délai, certification, décideur. Au-dessus de 12 : pièce test.',
      'Appel au responsable méthodes, puis dossier technique, puis visite de l\'atelier.',
      'Pièces tests lancées, délais de réponse, commandes récurrentes.'
    ]
  },
  {
    id: 'services', nom: 'Conseil et services aux PME',
    societes: [
      { nom: 'Cabinet Démo Annecy', secteur: 'Conseil en gestion', ville: 'Annecy', taille: 12 },
      { nom: 'Services Exemple Grenoble', secteur: 'Services aux entreprises', ville: 'Grenoble', taille: 28 },
      { nom: 'Conseil Fictif Chambéry', secteur: 'Conseil RH et gestion', ville: 'Chambéry', taille: 9 },
      { nom: 'Agence Modèle Valence', secteur: 'Agence de communication', ville: 'Valence', taille: 16 },
      { nom: 'Réseau Test Lyon', secteur: 'Réseau d\'artisans', ville: 'Lyon', taille: 55 },
      { nom: 'Cabinet Exemple Bourg', secteur: 'Expertise comptable', ville: 'Bourg-en-Bresse', taille: 21 },
      { nom: 'Services Démo Vienne', secteur: 'Services informatiques', ville: 'Vienne', taille: 14 },
      { nom: 'Conseil Fictif Mâcon', secteur: 'Accompagnement de dirigeants', ville: 'Mâcon', taille: 7 }
    ],
    offres: ['Accompagnement commercial à temps partagé', 'Diagnostic offert puis plan d\'action', 'Formation des équipes de vente', 'Mise en place d\'un CRM et de rituels', 'Audit de l\'organisation commerciale', 'Recrutement d\'un commercial'],
    plan: [
      'Dirigeants de PME de 5 à 50 salariés, sans direction commerciale dédiée.',
      'Nouveaux clients, puis clients existants pour un accompagnement continu.',
      'Réseau du dirigeant, LinkedIn, signaux de recrutement et de changement de dirigeant.',
      'Un enjeu chiffré et un diagnostic offert, sans engagement.',
      'Grille sur 15 : besoin, décideur, budget, timing, engagement. Au-dessus de 12 : rendez-vous.',
      'Recommandation et réseau d\'abord, courriel court ensuite, appel en dernier recours.',
      'Diagnostics réalisés, passages en proposition, durée moyenne de signature.'
    ]
  },
  {
    id: 'batiment', nom: 'Artisanat et bâtiment',
    societes: [
      { nom: 'Rénovation Démo Oyonnax', secteur: 'Rénovation globale', ville: 'Oyonnax', taille: 8 },
      { nom: 'Menuiserie Exemple Bourg', secteur: 'Menuiserie', ville: 'Bourg-en-Bresse', taille: 6 },
      { nom: 'Couverture Modèle Thonon', secteur: 'Couverture et zinguerie', ville: 'Thonon-les-Bains', taille: 11 },
      { nom: 'Plomberie Fictive Aix', secteur: 'Plomberie chauffage', ville: 'Aix-les-Bains', taille: 9 },
      { nom: 'Isolation Test Chambéry', secteur: 'Isolation thermique', ville: 'Chambéry', taille: 14 },
      { nom: 'Électricité Démo Annecy', secteur: 'Électricité', ville: 'Annecy', taille: 7 },
      { nom: 'Peinture Exemple Vienne', secteur: 'Peinture et finitions', ville: 'Vienne', taille: 5 },
      { nom: 'Carrelage Modèle Valence', secteur: 'Carrelage', ville: 'Valence', taille: 4 }
    ],
    offres: ['Rénovation énergétique d\'une maison', 'Extension et aménagement de combles', 'Contrat d\'entretien annuel', 'Remplacement de menuiseries', 'Chantier pilote puis programme par phases', 'Dépannage et petits travaux'],
    plan: [
      'Propriétaires de maisons de plus de quinze ans, dans un rayon de trente kilomètres.',
      'Travaux ponctuels, programmes par phases, contrats d\'entretien.',
      'Demandes entrantes du site, abords des chantiers en cours, prescripteurs (architectes, syndics).',
      'Un devis clair et une visite rapide, avec une réalisation de référence du quartier.',
      'Statut du contact, budget approximatif, urgence, décision. Au-dessus de 12 : visite technique.',
      'Rappel rapide des demandes entrantes, puis phoning ciblé, puis parrainage des clients.',
      'Délai de rappel, devis envoyés, taux de signature.'
    ]
  },
  {
    id: 'autre', nom: 'Autre activité',
    societes: [
      { nom: 'Entreprise Démo A', secteur: 'Activité à préciser', ville: 'Lyon', taille: 15 },
      { nom: 'Entreprise Exemple B', secteur: 'Activité à préciser', ville: 'Annecy', taille: 22 },
      { nom: 'Entreprise Modèle C', secteur: 'Activité à préciser', ville: 'Grenoble', taille: 10 },
      { nom: 'Entreprise Test D', secteur: 'Activité à préciser', ville: 'Valence', taille: 18 }
    ],
    offres: ['Offre de départ', 'Projet pilote', 'Contrat annuel'],
    plan: [
      'PME de la région, à préciser avec le dirigeant.',
      'Clients existants, puis nouveaux clients.',
      'Réseau, annuaires professionnels, signaux publics.',
      'Un enjeu chiffré et une première proposition sans engagement.',
      'Grille sur 15 : besoin, décideur, budget, timing, engagement.',
      'Réseau d\'abord, courriel ensuite, appel en dernier recours.',
      'Rendez-vous obtenus, propositions envoyées, signatures.'
    ]
  }
];

const MODELES = [['haiku', 'Haiku 5.5'], ['sonnet', 'Sonnet 5.5'], ['opus', 'Opus 5.5'], ['fable', 'Fable 5.1']];
const EFFORTS = [['faible', 'Faible'], ['moyen', 'Moyen'], ['eleve', 'Élevé'], ['max', 'Max']];
/* Valeurs de départ par étape : préparation en Sonnet effort moyen, rapport en Opus effort max. */
const CHAT_DEFAUT = {
  1: { modele: 'sonnet', effort: 'moyen' },
  2: { modele: 'sonnet', effort: 'moyen' },
  3: { modele: 'opus', effort: 'max' }
};

/* Adapte un mandat prospect de démonstration à une activité : noms, offres, plan, et diagnostic d'origine. */
function adaptMandat(data, activite, diag) {
  const tous = activite.societes, n = tous.length;
  const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  data.societes = data.societes.map((s, i) => {
    const t = tous[i % n], rang = Math.floor(i / n);
    const nom = rang ? `${t.nom} ${rang + 1}` : t.nom;
    return { ...s, nom, secteur: t.secteur, ville: t.ville, taille: t.taille, domaine: `${slug(nom)}.exemple` };
  });
  data.opps = data.opps.map((o, i) => ({ ...o, titre: activite.offres[i % activite.offres.length] }));
  data.plan = data.plan.map((b, i) => ({ ...b, txt: activite.plan[i] ?? b.txt }));
  if (diag) data.diagnostics = [{ id: uid('dg'), soc: data.societes[0].id, date: diag.date, statut: 'Restitué', dims: { ...diag.dims } }];
  return data;
}
