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
2. Dans `.env`, renseigner `POSTGRES_PASSWORD` avec un mot de passe sans caractère spécial : `openssl rand -hex 24`.
3. Lancer : `docker compose up -d --build`.
4. Vérifier : ouvrir http://localhost:4300/health, qui doit afficher `"status":"ok"`.

Arrêter : `docker compose stop`. Relancer : `docker compose start`.

**Ne jamais lancer `docker compose down -v`** : le `-v` efface la base.

Si un port est déjà pris, changer `APP_PORT` ou `DB_PORT` dans `.env`.

## Développer

Prérequis : Node.js 24 (voir `.nvmrc`) et Docker Desktop lancé (les tests démarrent un Postgres jetable).

- `npm ci` : installer les dépendances.
- `npm run verify` : format, lint, types, tests et build, comme en CI.
- `npm run dev` : lancer l'app hors Docker, sur la base du conteneur `db` (`DATABASE_URL` dans `.env`).
