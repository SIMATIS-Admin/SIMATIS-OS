# Atelier stratégique dans « Outils et diagnostics » (bêta)

Date : 2026-10-28. Statut : maquette validée dans la conversation (prototype `maquettes/atelier-strategie.html`).
Spec à relire avant tout code. Les données de la maquette sont fictives.

## Objectif

Intégrer à l'OS l'atelier stratégique construit en page unique pour la séance du 27 octobre 2026. Il sert,
au démarrage d'un mandat, à définir une stratégie commerciale, un modèle économique (ponctuel et
abonnement), des objectifs annuels, des ICP et des personas, et à produire une feuille de route.

Critères de réussite :

- l'atelier est un troisième bloc de la fiche entreprise dans « Outils et diagnostics », à côté du
  diagnostic et des tests VMA, avec la pastille « Bêta » ;
- on lance, reprend, duplique et supprime un atelier depuis cet écran, avec la même interface que le
  diagnostic et les tests (bouton « + Nouveau », ligne dépliable) ;
- l'atelier déjà réalisé pour Alpes IA est repris tel quel par import de sa sauvegarde ;
- le mode « écran partagé » est conservé : les informations privées restent masquées à l'écran ;
- l'état est enregistré dans la base de l'OS, plus dans le navigateur ;
- aucune donnée réelle dans le dépôt (noms, chiffres, offres, textes de méthode).

## Décisions prises (validées dans la conversation et la maquette)

| Question | Décision |
| --- | --- |
| Une page ou plusieurs | Une seule : « Outils et diagnostics ». Pas de nouvelle entrée de menu. |
| Rattachement | À une entreprise de l'instance « Mon activité » uniquement. Les autres instances viendront plus tard. |
| Structure | Une entreprise = une carte ; l'atelier est un troisième bloc, sur toute la largeur. Une entreprise peut avoir plusieurs ateliers (lancement, revue de mi-année). |
| Statut | Pastille « Bêta » à côté du titre du bloc, de la colonne de la ligne, et des entrées du menu « + Nouveau ». |
| Création | « + Nouveau » : « Nouvel atelier stratégique » et « Importer un atelier ». Le bloc a aussi son bouton « + Nouvel atelier » ; une entreprise sans atelier a « Lancer un atelier ». |
| Point de départ | Atelier vide, ou copie d'un atelier existant de la même entreprise. |
| Alpes IA | Reprise par « Importer un atelier » depuis le fichier de sauvegarde exporté par la page actuelle. |
| Lecture par le client | Hors périmètre. Le bouton « Partager avec le client » est affiché grisé ; les champs privés sont déjà marqués pour permettre le filtre plus tard. |

## Structure de l'écran

**Ligne d'entreprise (fermée)** : une quatrième colonne « Atelier stratégique · Bêta » : « Étape x sur 6 »
(étape la plus avancée du dernier atelier modifié) ou « Pas encore lancé ».

**Bloc dans le détail** : titre, pastille, bouton « + Nouvel atelier », phrase de présentation, puis une
ligne par atelier : nom, date de modification, nombre d'actions, pastille d'avancement (« Étape x sur 6 »
ou « Brouillon »), « Ouvrir l'atelier », « Partager avec le client » (grisé). La suppression passe par
une icône avec confirmation, comme le diagnostic.

**Atelier ouvert** (remplace la liste, comme le diagnostic ouvert) : bouton de retour, titre et pastille,
interrupteur « écran partagé », parcours en six étapes cliquables (Cadrage, Diagnostic, Modèle,
Objectifs, Ciblage, Feuille de route), contenu de l'étape, boutons précédent et suivant, exports.

**Étapes** : elles reprennent le contenu de l'atelier actuel (page unique, validée en séance) : faits
sourcés avec leur nature (fait sourcé, déclaration, hypothèse, question ouverte), forces et faiblesses,
scénarios de chiffre d'affaires, moteur d'offre, grille de modèle, objectifs et entonnoir, ICP et
personas, pistes de ciblage, actions par trimestre. Seule l'étape Objectifs est dessinée dans la maquette ;
les autres se portent à l'identique, dans le style de l'OS.

**Objectifs et abonnement** : chiffre d'affaires visé, part en abonnement, panier ponctuel, abonnement
mensuel, mois facturés par abonné, taux de conversion. Résultats : ventes ponctuelles, nouveaux abonnés,
revenu récurrent mensuel en fin d'année, rendez-vous, contacts. Carte privée « Pour Marc » : commission
sur douze mois et commission annuelle sur les abonnements en cours (même taux sur le récurrent, tant
que l'affaire court). Le calcul est celui de l'outil actuel : le test d'unité reprend ses valeurs
(24 ventes, 27 abonnés, 8 100 €, 204 rendez-vous, 1 360 contacts) avec des chiffres fictifs.

## Écran partagé et informations privées

Chaque ligne ou carte peut porter un indicateur `prive`. Avec l'écran partagé actif (valeur par défaut à
l'ouverture), ces éléments ne sont pas affichés, et ils sont exclus des exports. L'indicateur est stocké
avec les données pour qu'une vue en lecture seule destinée au client applique la même règle plus tard.

## Données

Nouvelle table `ateliers_strategie` (migration additive : aucune table existante n'est modifiée) :

| Colonne | Rôle |
| --- | --- |
| `id` | Identifiant. |
| colonnes d'instance (`metierColumns`) | Cloisonnement par instance, comme `vma_tests`. |
| `entreprise_id` | Entreprise rattachée (obligatoire). |
| `titre` | Nom de l'atelier. |
| `etape_max` | Étape la plus avancée (1 à 6), pour le résumé de la ligne. |
| `etat` (jsonb) | Tout le contenu de l'atelier (voir ci-dessous). |
| dates | Création et modification. |

Le contenu est un seul bloc `etat` versionné (`v: 1`) : cela suit la forme de la sauvegarde actuelle, donc
l'import ne transforme rien. La validation côté serveur (zod) vérifie la forme, la taille maximale et le
numéro de version ; un état invalide est refusé.

**Isolation** : la table reçoit la même politique d'isolation par instance que `vma_tests`
(`instanceIsolation`), et un test d'isolation vérifie qu'une autre instance ne voit pas ces lignes.

## Contenu de méthode et confidentialité

Le dépôt est public (règle de `AGENTS.md`). Le code et les tests contiennent :

- un squelette neutre : titres des six étapes, libellés génériques des champs, champs vides ;
- des données d'exemple fictives pour les tests et la démonstration.

Le code ne contient pas : les données d'Alpes IA (chiffres, offre, noms, personas), ni les textes détaillés
de méthode de la page actuelle (questions de la grille SAVE, descriptions des sept pistes, consignes
ICP). Un nouvel atelier démarre donc avec des champs vides et des titres génériques. Si Marc veut ces
textes préremplis, ils viendront d'un fichier local ignoré par git (variable d'environnement), à décider
dans une livraison ultérieure. Le contenu de l'atelier d'Alpes IA n'entre dans la base que par l'import
de sa sauvegarde.

## Import de l'atelier Alpes IA

Bouton « Importer un atelier » : l'utilisateur choisit l'entreprise et un fichier `.json`. Le fichier est
la sauvegarde exportée par la page actuelle (format `{ v: 1, steps_state }`).

1. Le serveur valide la forme et la taille ; un fichier invalide est refusé avec un message clair.
2. Il crée un atelier rattaché à l'entreprise choisie, avec le nom proposé (modifiable) ; rien n'est écrasé.
3. Le fichier n'est ni stocké tel quel ni envoyé ailleurs.
4. Les exemples et tests utilisent des fichiers fictifs.

Marc exporte d'abord la sauvegarde depuis la page actuelle, qui garde son état dans le navigateur.

## API

Dans le style des routes existantes, sous `/api/i/:slug/` :

- `GET ateliers-strategie` : liste (sans l'état complet), `GET ateliers-strategie/:id` : un atelier ;
- `POST ateliers-strategie` : création (vide ou copie) ; `POST ateliers-strategie/import` : import ;
- `PUT ateliers-strategie/:id` : enregistrement de l'état (appelé après chaque modification, avec un délai
  d'attente pour regrouper les frappes) ; `DELETE ateliers-strategie/:id`.

L'accès suit la règle du module « diagnostic » de l'instance (l'atelier est une partie de cet écran).

## Exports

Les deux exports de l'outil actuel sont conservés : feuille de route en JSON (schéma
`simatis-os/plan-action-brouillon`, pour le futur module Plan d'action) et fiche de cadrage en Markdown.
Avec l'écran partagé actif, la commission et les notes privées n'y figurent pas. Aucun envoi vers l'Inbox
dans cette livraison.

## Hors périmètre

- Vue en lecture seule pour le client dans son espace.
- Autres instances que « Mon activité ».
- Envoi de la feuille de route vers l'Inbox ou le module Plan d'action.
- Préremplissage des textes de méthode (fichier local).
- Liaison automatique avec les résultats du diagnostic et du test VMA de l'entreprise.

## Vérification prévue

- Tests unitaires : calcul des objectifs et de l'abonnement (valeurs ci-dessus), validation de l'état et de
  la taille, filtre des champs privés à l'export, import d'une sauvegarde fictive valide et invalide.
- Tests d'API : création, copie, liste, enregistrement, suppression, import ; isolation entre instances.
- Tests d'interface : colonne et bloc avec la pastille Bêta, menu « + Nouveau », ouverture et reprise d'un
  atelier, interrupteur d'écran partagé.
- `npm run verify` avant chaque commit ; vérification dans le navigateur sur l'instance de démonstration ;
  avant chaque commit, relecture de `git diff --staged` pour écarter toute donnée réelle.
