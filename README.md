# SIMATIS OS

Système d'exploitation interne de SIMATIS (direction commerciale en mode partagé).

> **Dépôt public.** Il ne contient que du code, de la documentation générique et des données fictives.
> Toute information confidentielle ou métier vit dans le « second cerveau », qui est privé.

## Répartition

| Où | Quoi |
| --- | --- |
| **Ce dépôt (public)** | Code de l'application, architecture, plan de développement, données fictives de démonstration. |
| **Second cerveau (privé)** | Clients, prospects, mandats, tarifs, méthodes propriétaires, décisions, données réelles. |

## Démarrage

Le plan de développement est dans [docs/plan.md](docs/plan.md). Les règles de contribution (dont la confidentialité) sont dans [AGENTS.md](AGENTS.md).

## Démarrer en local

Prérequis : Docker Desktop, lancé.

1. Copier la configuration : `cp .env.example .env`.
2. Dans `.env`, renseigner `POSTGRES_PASSWORD` et `APP_DB_PASSWORD` avec deux mots de passe différents, sans caractère spécial : `openssl rand -hex 24`.
3. Lancer : `docker compose up -d --build`.
4. Ouvrir http://localhost:4300 : l'OS s'affiche, avec les instances fictives de la maquette si la base était vide.

Arrêter : `docker compose stop`. Relancer : `docker compose start`.

**Ne jamais lancer `docker compose down -v`** : le `-v` efface la base.

Si un port est déjà pris, changer `APP_PORT` ou `DB_PORT` dans `.env`.

## Administrer les instances

Dans Docker : `docker compose exec app node dist/admin/main.js <commande>`. Hors Docker : `npm run admin -- <commande>`.

- `instance:list` : toutes les instances, actives et archivées.
- `instance:create --slug <slug> --nom "<nom>" --type propre|mandat|prospect`
- `instance:archive --slug <slug>`
- `instance:purge --slug <slug> --confirmer` : supprime les données métier de l'instance (irréversible), garde son journal et l'archive.
- `demo:seed` : charge les instances fictives, seulement dans une base vide.

Les secrets d'une instance vont dans `secrets/instances/<slug>.env` (jamais commité).

## Développer

Prérequis : Node.js 24 (voir `.nvmrc`) et Docker Desktop lancé (les tests démarrent un Postgres jetable).

- `npm ci` : installer les dépendances.
- `npm run verify` : format, lint, types, tests et build, comme en CI.
- `npm run dev` : lancer l'app hors Docker, sur la base du conteneur `db` (`DATABASE_URL` dans `.env`).
