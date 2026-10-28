# Section « Atelier stratégique » (bêta)

Date : 2026-10-28. Statut : maquette validée dans la conversation (prototype `maquettes/atelier-strategie.html`),
spec corrigée le même jour : l'atelier est une section à part et non un bloc d'« Outils et diagnostics ».
Spec à relire avant tout code. Les données de la maquette sont fictives.

## Objectif

Intégrer à l'OS l'atelier stratégique construit en page unique pour la séance du 27 octobre 2026. Il sert,
au démarrage d'un mandat, à définir une stratégie commerciale, un modèle économique (ponctuel et
abonnement), des objectifs annuels, des ICP et des personas, et à produire une feuille de route, sur la base
du diagnostic et du test VMA de l'entreprise.

Critères de réussite :

- une nouvelle entrée « Atelier stratégique » avec la pastille « Bêta » dans la rubrique Stratégie du menu ;
- un écran d'accueil qui reprend le principe d'accès d'« Outils et diagnostics » : une ligne par entreprise,
  avec l'état de son diagnostic, de ses tests VMA et de ses ateliers ;
- un atelier se déroule étape par étape et s'enregistre comme le diagnostic d'endurance commerciale ;
- l'atelier déjà réalisé pour le premier mandat est repris par import ; c'est la seule donnée de départ ;
- un bouton « Atelier : module d'essai » ouvre un atelier d'essai, comme le Test VMA a le sien ;
- l'écran partagé masque les informations privées ;
- les fiches entreprise et contact renvoient vers les ateliers de l'entreprise ;
- aucune donnée réelle dans le dépôt (noms, chiffres, offres, textes de méthode).

## Décisions prises (validées dans la conversation et la maquette)

| Question | Décision |
| --- | --- |
| Où | Section à part, rubrique Stratégie, entrée « Atelier stratégique » + pastille « Bêta ». Rien n'est ajouté à « Outils et diagnostics », qui reste tel quel. |
| Accueil | Même principe qu'« Outils et diagnostics » : une ligne par entreprise, « Détail ▾ », « + Nouveau », recherche, pagination. |
| Rattachement | À une entreprise de l'instance « Mon activité » uniquement. Les autres instances viendront plus tard. |
| Données de départ | Uniquement l'historique du premier mandat, repris par import. Rien d'autre n'est créé ni migré. |
| Déroulement | Étape par étape, avec étape en cours et étape la plus avancée, enregistré après chaque modification, comme le diagnostic. |
| Module d'essai | Bouton « Atelier : module d'essai » : un atelier vide, hors base, pour s'entraîner ; comme le bouton d'essai du Test VMA. |
| Liens | Les fiches entreprise et contact listent les ateliers de l'entreprise et y renvoient ; l'atelier renvoie vers la fiche entreprise et le contact. |
| Lecture par le client | Hors périmètre. Le bouton « Partager avec le client » est affiché grisé ; les champs privés sont déjà marqués pour permettre le filtre plus tard. |

## Structure de l'écran d'accueil

**En-tête** : titre et pastille, « Atelier : module d'essai », « + Nouveau » (« Nouvel atelier stratégique »,
« Importer un atelier »), recherche.

**Ligne d'entreprise (fermée)** : nom, diagnostic (« Étape x sur 5 » ou « Pas encore lancé »), tests VMA
(nombre et nombre reçu), ateliers (nombre et avancement du dernier modifié, « Étape x sur 6 »).

**Détail (ouvert)** :

- deux blocs « Diagnostic d'endurance commerciale » et « Tests VMA » : état en lecture seule, présentés
  comme les points de départ de l'atelier, avec un lien « Ouvrir dans Outils et diagnostics » vers l'écran
  existant ;
- un bloc « Ateliers stratégiques », sur toute la largeur : contact et liens vers les fiches, puis une ligne
  par atelier (nom, date de modification, nombre d'actions, avancement) avec « Reprendre l'atelier » et
  « Partager avec le client » (grisé). Bouton « + Nouvel atelier ». La suppression passe par une icône avec
  confirmation, comme le diagnostic.

## Déroulement et enregistrement d'un atelier

Comme le diagnostic d'endurance commerciale :

- six étapes cliquables : Cadrage, Diagnostic, Modèle, Objectifs, Ciblage, Feuille de route ;
- l'étape en cours et l'étape la plus avancée sont enregistrées (revenir relire ne fait pas reculer
  l'atelier) ;
- chaque modification est enregistrée dans la base après un court délai, sans bouton « Enregistrer » ;
- l'atelier ouvert remplace l'accueil, avec un bouton de retour ; le titre de l'en-tête de l'application est
  celui de l'atelier.

Le diagnostic propose en plus une conversation avec Claude par étape : elle n'est pas reprise ici (hors
périmètre).

**Étapes** : elles reprennent le contenu de l'atelier actuel : faits sourcés avec leur nature (fait sourcé,
déclaration, hypothèse, question ouverte), forces et faiblesses, scénarios de chiffre d'affaires, moteur
d'offre, grille de modèle, objectifs et entonnoir, ICP et personas, pistes de ciblage, actions par
trimestre. Seule l'étape Objectifs est dessinée dans la maquette ; les autres se portent à l'identique,
dans le style de l'OS.

**Objectifs et abonnement** : chiffre d'affaires visé, part en abonnement, panier ponctuel, abonnement
mensuel, mois facturés par abonné, taux de conversion. Résultats : ventes ponctuelles, nouveaux abonnés,
revenu récurrent mensuel en fin d'année, rendez-vous, contacts. Carte privée « Pour Marc » : commission
sur douze mois et commission annuelle sur les abonnements en cours (même taux sur le récurrent, tant
que l'affaire court). Le calcul est celui de l'outil actuel : le test d'unité reprend ses valeurs
(24 ventes, 27 abonnés, 8 100 €, 204 rendez-vous, 1 360 contacts) avec des chiffres fictifs.

## Module d'essai

Le bouton « Atelier : module d'essai » ouvre un atelier vide, avec un bandeau « Module d'essai : rien n'est
enregistré dans l'OS ». Aucune ligne n'est créée en base, aucune entreprise n'est liée ; l'état reste dans le
navigateur et disparaît au retour. Il sert à s'entraîner et à montrer l'outil. Même principe que « Test VMA :
module d'essai » : on essaie sans rien écrire.

## Écran partagé et informations privées

Chaque ligne ou carte peut porter un indicateur `prive`. Avec l'écran partagé actif (valeur par défaut à
l'ouverture), ces éléments ne sont pas affichés, et ils sont exclus des exports. L'indicateur est stocké
avec les données pour qu'une vue en lecture seule destinée au client applique la même règle plus tard.

## Données

Nouvelle table `ateliers_strategie` (migration additive : aucune table existante n'est modifiée) :

| Colonne | Rôle |
| --- | --- |
| `id` | Identifiant. |
| colonnes d'instance (`metierColumns`) | Cloisonnement par instance, comme `vma_tests` et `diagnostic_projets`. |
| `entreprise_id` | Entreprise rattachée (obligatoire). |
| `titre` | Nom de l'atelier. |
| `etape`, `etape_max` | Étape en cours et étape la plus avancée atteinte (1 à 6), comme `diagnostic_projets`. |
| `etat` (jsonb) | Tout le contenu de l'atelier (voir ci-dessous). |
| dates | Création et modification. |

Le contenu est un seul bloc `etat` versionné (`v: 1`) : il suit la forme de la sauvegarde actuelle, donc
l'import ne transforme rien. La validation côté serveur (zod) vérifie la forme, la taille maximale et le
numéro de version ; un état invalide est refusé.

**Isolation** : la table reçoit la même politique d'isolation par instance que `vma_tests`
(`instanceIsolation`), et un test d'isolation vérifie qu'une autre instance ne voit pas ces lignes.

## Liens avec les fiches entreprise et contact

- La fiche entreprise affiche un bloc « Ateliers stratégiques » : la liste des ateliers de l'entreprise,
  chacun renvoyant vers l'atelier ouvert.
- La fiche contact renvoie vers les ateliers de son entreprise. Le contact n'est pas stocké dans
  l'atelier : il se lit via l'entreprise (une seule source).
- L'atelier ouvert renvoie vers la fiche de l'entreprise et son contact.
- Diagnostic et tests VMA : l'accueil les montre déjà et renvoie vers « Outils et diagnostics ».

## Contenu de méthode et confidentialité

Le dépôt est public (règle de `AGENTS.md`). Le code et les tests contiennent :

- un squelette neutre : titres des six étapes, libellés génériques des champs, champs vides ;
- des données d'exemple fictives pour les tests et la démonstration.

Le code ne contient pas : les données du premier mandat (chiffres, offre, noms, personas), ni les textes
détaillés de méthode de la page actuelle (questions de la grille SAVE, descriptions des sept pistes,
consignes ICP). Un nouvel atelier démarre donc avec des champs vides et des titres génériques. Si Marc veut
ces textes préremplis, ils viendront d'un fichier local ignoré par git (variable d'environnement), à
décider dans une livraison ultérieure. Le contenu de l'atelier du premier mandat n'entre dans la base que
par l'import de sa sauvegarde.

## Import de l'historique du premier mandat

Bouton « Importer un atelier » : l'utilisateur choisit l'entreprise et un fichier `.json`. Le fichier est
la sauvegarde exportée par la page actuelle (format `{ v: 1, steps_state }`).

1. Le serveur valide la forme et la taille ; un fichier invalide est refusé avec un message clair.
2. Il crée un atelier rattaché à l'entreprise choisie, avec le nom proposé (modifiable) ; rien n'est écrasé.
3. Le fichier n'est ni stocké tel quel ni envoyé ailleurs.
4. Les exemples et tests utilisent des fichiers fictifs.

Marc exporte d'abord la sauvegarde depuis la page actuelle, qui garde son état dans le navigateur.

## API

Dans le style des routes du diagnostic, sous `/api/i/:slug/` :

- `GET ateliers-strategie` : liste (sans l'état complet), `GET ateliers-strategie/:id` : un atelier ;
- `POST ateliers-strategie` : création (vide) ; `POST ateliers-strategie/import` : import ;
- `PATCH ateliers-strategie/:id` : enregistrement de l'étape et de l'état, appelé après chaque
  modification avec un court délai ; `DELETE ateliers-strategie/:id`.

L'accueil lit aussi le diagnostic et les tests VMA par leurs routes existantes (aucune modification). Le
module d'essai n'appelle aucune route d'écriture.

Accès : l'entrée de menu est rattachée à un module « atelier » de l'instance, activé pour « Mon activité ».

## Exports

Les deux exports de l'outil actuel sont conservés : feuille de route en JSON (schéma
`simatis-os/plan-action-brouillon`, pour le futur module Plan d'action) et fiche de cadrage en Markdown.
Avec l'écran partagé actif, la commission et les notes privées n'y figurent pas. Aucun envoi vers l'Inbox
dans cette livraison.

## Hors périmètre

- Vue en lecture seule pour le client dans son espace.
- Autres instances que « Mon activité ».
- Conversation avec Claude par étape, comme dans le diagnostic.
- Envoi de la feuille de route vers l'Inbox ou le module Plan d'action.
- Préremplissage des textes de méthode (fichier local).
- Tout atelier créé à la place de l'historique du premier mandat : aucune donnée n'est créée d'avance.

## Vérification prévue

- Tests unitaires : calcul des objectifs et de l'abonnement (valeurs ci-dessus), validation de l'état et de
  la taille, filtre des champs privés à l'export, import d'une sauvegarde fictive valide et invalide.
- Tests d'API : création, liste, enregistrement de l'étape et de l'état, suppression, import ; isolation
  entre instances ; le module d'essai n'écrit rien.
- Tests d'interface : entrée de menu avec la pastille Bêta, accueil à trois colonnes, « + Nouveau »,
  reprise d'un atelier, interrupteur d'écran partagé, bandeau et retour du module d'essai, liens depuis les
  fiches.
- `npm run verify` avant chaque commit ; vérification dans le navigateur sur l'instance de démonstration ;
  avant chaque commit, relecture de `git diff --staged` pour écarter toute donnée réelle.
