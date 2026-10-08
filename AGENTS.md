<!-- coding.md:start (dernière synchro : 2026-10-08 ; adapté au projet : sans staging, sans worktrees, sans VPS, git autonome) -->
# SIMATIS OS — consignes pour les agents

Système d'exploitation interne de SIMATIS (direction commerciale en mode partagé). Vue d'ensemble et démarrage : `README.md`. Plan de développement : `docs/plan.md`.

## Vérifier son travail

    npm run verify      # format, lint, types, tests, build

Committer seulement un changement vérifié. La CI rejoue ces commandes sur chaque PR. Un changement d'interface se vérifie aussi dans le navigateur, pas seulement par les tests.

## Processus longs

- Serveurs de dev, mocks, watchers : lancés en tâche de fond suivie par l'outil de
  l'agent, jamais avec `&` ni sortie redirigée vers un fichier temporaire.
- En fin de travail : les arrêter, ou dire lesquels tournent encore (commande,
  dossier, port).

## Conventions

- Changements minimaux : ce qui est demandé, rien de plus. Pas de refactoring
  spontané, pas de fichier `.md` non demandé.
- Respecter le style du fichier (indentation, nommage, patterns).
- Commenter le **pourquoi** quand il n'est pas évident, jamais le quoi.
- Si une demande est ambiguë : poser la question plutôt que deviner.
- Jamais de `--no-verify`, de `push --force` ni de `reset --hard` sans demande
  explicite.

## Secrets et données

- Secrets uniquement dans `.env`, jamais commités, jamais dans l'image Docker. Toute
  nouvelle variable va aussi dans `.env.example`, sans valeur.
- Documents du client (présentations, exports, briefs) : jamais dans git. Ce qui a été
  poussé une fois reste sur GitHub même après réécriture d'historique.
- Écritures vers un système tiers : dry-run par défaut ; le mode réel exige un double
  verrou (variable serveur + interrupteur admin). Ne jamais lancer une écriture réelle
  sans demande explicite.

## Base de données

- Jamais `docker compose down -v` : le `-v` supprime la base et les sauvegardes.
<!-- coding.md:end -->

## Tests (règle permanente)

- Chaque nouvelle fonctionnalité arrive avec ses tests, écrits avant ou avec le code, et lancés (`npm run verify`) avant chaque commit.
- Après chaque push sur une PR : relancer les tests en local et suivre la CI jusqu'au vert.
- Jamais de merge avec des tests rouges ou une CI non verte.

## Confidentialité (règle absolue)

Ce dépôt est **public** sur GitHub. Ne jamais y écrire, committer ni pousser :

- noms de clients, prospects, contacts, mandats réels, ni montants, tarifs ou marges réels ;
- données extraites de HubSpot, Gmail, Google Agenda ou tout autre outil réel ;
- identifiants, mots de passe, clés d'API, jetons, fichiers `.env` ;
- méthodes ou contenus propriétaires (questionnaires, grilles de scoring détaillées, trames de rapport) ;
- contenu du second cerveau, en tout ou partie.

Les exemples, tests et démonstrations utilisent **uniquement des données fictives**.
Un secret poussé une fois reste récupérable dans l'historique : en cas de doute, ne pas committer, demander.

## Second cerveau

Le second cerveau est privé et contient toute l'information confidentielle et métier. Ce dépôt peut le **référencer par concept** (« voir le second cerveau, fiche mandat »), jamais en copier le contenu.
La configuration locale (chemins, URL, jetons) passe par des variables d'environnement ou des fichiers ignorés par git.

## Branches (pas de worktree)

- Toujours vérifier `git branch --show-current` avant de travailler.
- **Pas de worktree** : on travaille toujours dans le dossier principal du dépôt, en changeant de branche. Un seul agent travaille à la fois dans ce dépôt.
- Chaque branche part de `main` à jour : `git fetch` puis `git switch -c feature/nom-court origin/main`.
- Jamais de travail ni de commit direct sur `main`.
- Avant de changer de branche, l'arbre de travail doit être propre : committer plutôt que stasher.

## Gestion de git (autonome)

Marc n'est pas développeur : l'agent gère tout git seul, sans demander de confirmation.

- **Commit et push au fur et à mesure**, sans confirmation.
- **Une nouvelle branche par feature** (`feature/nom-court`).
- **Feature terminée** : l'agent ouvre une PR, fait lui-même la revue de code (corrige ce qu'il trouve), vérifie que la CI est verte, puis merge dans `main`. Marc n'a pas à relire.
- **Marc est débutant** : à chaque fin de feature, expliquer simplement, étape par étape, comment tester l'app. L'agent s'occupe de tout le reste.

### Garde-fou confidentialité (avant chaque commit, non négociable)

1. Relire `git diff --staged` en cherchant toute donnée réelle ou secret (voir liste ci-dessus).
2. Ne jamais utiliser `git add -A` à l'aveugle : ajouter les fichiers explicitement.
3. En cas de doute sur une donnée, ne pas committer et demander à Marc : c'est la seule exception à l'autonomie.

## Langue

Documentation et interface en français. Code et identifiants techniques en anglais ou français, de façon cohérente.
