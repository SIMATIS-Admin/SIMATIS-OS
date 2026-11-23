<!-- coding.md:start (dernière synchro : 2026-10-08 ; adapté au projet : sans staging, sans VPS, git autonome) -->
# SIMATIS OS — consignes pour les agents

Système d'exploitation interne de SIMATIS (direction commerciale en mode partagé). Vue d'ensemble et démarrage : `README.md`. Plan de développement : `docs/plan.md`.

Ce fichier est la source de vérité des consignes du dépôt. En cas de divergence avec d'autres consignes du projet, il prévaut.

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
- Après chaque push : relancer les tests en local et suivre la CI jusqu'au vert.
- Jamais de merge avec des tests rouges ou une CI non verte.

## Confidentialité (règle absolue)

Ce dépôt est **public** sur GitHub. Ne jamais y écrire, committer ni pousser :

- noms de clients, prospects, contacts, mandats réels, ni montants, tarifs ou marges réels ;
- données extraites de HubSpot, Gmail, Google Agenda ou tout autre outil réel ;
- identifiants, mots de passe, clés d'API, jetons, fichiers `.env` ;
- méthodes ou contenus propriétaires (questionnaires, grilles de scoring, trames de rapport) ;
- contenu du second cerveau, en tout ou partie.

Les exemples, tests et démonstrations utilisent **uniquement des données fictives**.
Un secret poussé une fois reste récupérable dans l'historique : en cas de doute, ne pas committer, demander à Marc.

## Second cerveau

Le second cerveau est privé et contient toute l'information confidentielle et métier. Ce dépôt peut le **référencer par concept** (« voir le second cerveau, fiche mandat »), jamais en copier le contenu.
**Référence : le dépôt GitHub privé `SIMATIS-Admin/second-cerveau`** (plus le Drive), cloné sur le poste de Marc dans `~/Second Cerveau` (`SECOND_CERVEAU_DIR`). Toute écriture dans le second cerveau, par l'agent ou par l'OS (routines, éditeur de notes), se termine par : `git pull --rebase`, `git add` des fichiers modifiés (jamais `-A`), commit, `git push` sur `main`. En fin de travail, ne jamais laisser de modification non poussée dans ce clone. Le dépôt est privé : y mettre du contenu métier est permis, mais il ne doit jamais être copié dans le présent dépôt public.
La configuration locale (chemins, URL, jetons) passe par des variables d'environnement ou des fichiers ignorés par git.

## Branches et sessions parallèles (worktree dédié)

- Toujours vérifier `git branch --show-current` avant de travailler et dans la même commande que chaque `git commit`.
- **Règle permanente : une session parallèle = un worktree dédié, sans exception.** Dès qu'une autre session travaille dans le dossier principal (modifications non commitées qui ne sont pas les miennes, branche autre que celle attendue, session « busy » sur ce dépôt), ou que Marc demande un travail en parallèle d'une autre session, l'agent crée son propre worktree et n'y touche jamais au dossier principal.
- Création : `git fetch` puis `git worktree add -b feature/nom-court "$HOME/Simatis-OS-worktrees/nom-court" origin/main`. Les worktrees vivent dans `~/Simatis-OS-worktrees/`, jamais dans `/tmp` (nettoyé au redémarrage) ni dans le dépôt.
- Dans un worktree : `.env`, `node_modules` et `secrets/` n'y sont pas (ignorés par git). Les lier ou les installer (`npm ci`) avant `npm run verify` ; ne jamais copier un secret dans un fichier suivi par git.
- Ressources partagées entre worktrees, donc à ne pas se disputer : la base locale, les ports (serveurs de dev) et le conteneur Docker. Un seul worktree à la fois reconstruit ou relance le conteneur, et seulement après merge, depuis `origin/main` à jour (voir « Livraison »). Les migrations Drizzle (`drizzle/NNNN_*.sql`) : avant de merger, rebaser sur `origin/main` et renuméroter si un autre merge a pris le même numéro.
- Chaque branche part de `main` à jour et n'est ouverte que dans un seul worktree (git l'impose). Jamais de travail ni de commit direct sur `main`.
- Dossier principal : si des modifications non commitées que l'agent n'a pas faites y sont présentes, ne pas y travailler ni y changer de branche ; passer en worktree et prévenir Marc.
- Fin de feature (après merge) : supprimer le worktree (`git worktree remove <chemin>`) et la branche locale, puis `git worktree prune`. Ne jamais supprimer un worktree qui contient des modifications non commitées.

### Éviter les conflits et les problèmes de versions

- Avant de commencer : `git worktree list`, puis `git diff --stat origin/main` dans chaque worktree ouvert. Si deux sessions toucheraient les mêmes fichiers, prévenir Marc et les faire l'une après l'autre.
- Fichiers « chauds » (`drizzle/meta/_journal.json`, `src/db/metier-tables.ts`, `package.json`, `package-lock.json`) : une seule session à la fois y touche.
- Branches courtes : découper en petites livraisons mergées vite.
- Avant d'ouvrir la PR, et à nouveau avant de merger si un autre merge a eu lieu : `git fetch` puis `git rebase origin/main`, puis `npm run verify`. Un conflit non compris avec certitude : s'arrêter et prévenir Marc, ne pas deviner.
- Migrations Drizzle : en cas de numéro déjà pris sur `main`, supprimer sa migration et son snapshot, rebaser, puis relancer `npm run db:generate`. Le contrôle `src/db/migrations-check.ts` (lancé par `npm test` et donc par la CI) refuse les numéros en double, les fichiers hors journal et les snapshots manquants.
- Dépendances : ne pas lancer `npm update` ni changer le verrou sans demande de Marc. Conflit sur `package-lock.json` : le régénérer avec `npm install` après le rebase, jamais à la main.
- Node : `.nvmrc` fait foi, pas d'autre version.
- Merge seulement si la branche est à jour avec `main` et la CI verte sur ce résultat.

## Gestion de git (autonome)

Marc n'est pas développeur : l'agent gère tout git seul, sans demander de confirmation.

- **Commit et push au fur et à mesure**, sans confirmation.
- **Une nouvelle branche par feature** (`feature/nom-court`).
- **Feature terminée** : l'agent ouvre une PR, fait lui-même la revue de code (corrige ce qu'il trouve), vérifie que la CI est verte, puis merge dans `main`. Marc n'a pas à relire.
- **Marc est débutant** : à chaque fin de feature, expliquer simplement, étape par étape, comment tester l'app. L'agent s'occupe de tout le reste.
- **Second cerveau à jour** : en fin de feature, mettre à jour dans le second cerveau `brain/outils/simatis-os-organigramme.md` (**le schéma de l'OS** : ajouter ou modifier la fonction livrée au bon endroit, avec son état `en service`, `à essayer` ou `partiel`, en respectant le format décrit dans la note, car l'écran Feuille de route la lit), `brain/outils/simatis-os-feuille-de-route.md` (retirer l'étape faite, ajouter les nouvelles) et `brain/outils/simatis-os-structure.md` (journal détaillé de la livraison). Écrire dans le clone local du second cerveau (`SECOND_CERVEAU_DIR`), noter la modification dans `log.md`, puis la committer et la pousser sur le dépôt privé (voir « Second cerveau ») ; ne rien en copier dans ce dépôt.

### Garde-fou confidentialité (avant chaque commit, non négociable)

1. Relire `git diff --staged` en cherchant toute donnée réelle ou secret (voir liste ci-dessus).
2. Ne jamais utiliser `git add -A` : ajouter les fichiers explicitement.
3. En cas de doute sur une donnée, ne pas committer et demander à Marc : c'est la seule exception à l'autonomie.

## Langue

Documentation et interface en français. Code et identifiants techniques en anglais ou français, de façon cohérente.

## Livraison

- Toutes les fonctionnalités terminées doivent être intégrées à `main` après vérification et CI verte. Un déploiement local seul ne clôt pas une livraison.
- Après un merge : reconstruire l'application et relancer le conteneur depuis `origin/main` à jour.
- Avant de remplacer le conteneur actif, vérifier que les sources et l'image active n'ont pas changé pendant la construction.
