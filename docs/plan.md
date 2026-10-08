# Plan de développement — SIMATIS OS

> Brouillon à itérer. Rien de confidentiel ici.

## Objectif

Un OS commercial pour la direction commerciale à temps partagé : l'IA prépare, le pilote décide.
Les données opérationnelles vivent dans une base ; n'importe quel agent IA peut l'interroger et proposer des actions, sous les règles de l'OS. La maquette `maquettes/os-commercial/` sert de référence fonctionnelle.

## Décisions techniques

### Architecture

```
Postgres ← cœur SimatisOS (services métier, règles, journal d'audit)
              ├─ API HTTP    → interface web
              └─ serveur MCP → agents IA (Claude, ChatGPT, Cursor…)
```

- **Le MCP passe par le cœur, jamais directement par la base.** Les règles (niveaux d'autonomie, cloisonnement des instances, garde-fous, mode simulation, journal) n'existent qu'à un seul endroit, partagé par l'interface et les agents.
- **Outils MCP en langage métier** (`pipeline_instance`, `fiche_entreprise`, `proposer_brouillon`…) plutôt que du SQL libre. Un outil `requete_lecture` permet des questions imprévues : SQL en lecture seule, sur des vues choisies, limité à l'instance active, journalisé.
- **Écritures des agents = propositions** dans la file « À valider ». Elles ne s'appliquent directement que si le niveau d'autonomie de l'action le permet.
- **Cloisonnement** : chaque ligne porte son instance ; Postgres l'impose aussi par Row-Level Security, en plus du cœur.
- **Journal d'audit en ajout seul**, imposé par la base (ni modification ni suppression).

### Pile

| Brique | Choix |
| --- | --- |
| Langage | TypeScript, Node.js LTS |
| Base | PostgreSQL 18 |
| Accès base | Drizzle ORM, migrations versionnées (drizzle-kit) |
| HTTP | Fastify |
| MCP | SDK officiel TypeScript, transport Streamable HTTP sur `/mcp` |
| Validation | Zod (partagé entre API et MCP) |
| Tests | Vitest, sur une base Postgres de test |
| CI | GitHub Actions : lint, typage, tests |

Un seul processus Node sert l'API et le MCP. Les agents qui ne parlent que stdio passent par un pont (`mcp-remote`).
Authentification : un jeton par agent, rattaché à une instance et à un plafond d'autonomie. Les secrets restent dans `.env` (ignoré par git) ; seul `.env.example` est versionné.

### Déploiement

Docker Compose, en local dans un premier temps :

| Service | Rôle |
| --- | --- |
| `db` | PostgreSQL, volume Docker nommé (jamais dans un dossier synchronisé iCloud ou Drive) |
| `app` | Cœur + API + MCP |
| `backup` | Sauvegardes (voir ci-dessous) |

Ports exposés sur `127.0.0.1` uniquement. Le même fichier Compose servira pour un futur serveur.

### Sauvegarde

- **`pg_dump` + restic**, dans le conteneur `backup`.
- **Rattrapage plutôt qu'horaire fixe** : toutes les heures, le conteneur vérifie l'âge de la dernière sauvegarde réussie et en lance une si elle a plus de 24 h. Un portable en veille ne rate donc aucune sauvegarde.
- **Chiffrement côté client** par restic, avant envoi.
- **Destination externe compatible S3**, hébergée en UE ou en Suisse (Infomaniak Swiss Backup, Scaleway, Backblaze EU…). Changer de fournisseur ne demande que de modifier `.env`.
- **Rétention** : 7 quotidiennes, 4 hebdomadaires, 12 mensuelles.
- **Test de restauration hebdomadaire automatique** dans une base jetable, avec contrôle de quelques comptages.
- La restauration à un instant précis (archivage WAL) est reportée au passage sur serveur.

### Second cerveau

- Les agents lisent les données opérationnelles **en direct via le MCP**, sans copie.
- **Synchro à sens unique** base → second cerveau, limitée au contenu narratif : comptes rendus de rendez-vous, décisions et leurs raisons, fiche de synthèse hebdomadaire par instance. Les fiches arrivent en brouillon dans l'inbox du second cerveau, puis suivent la procédure Mémoriser.
- Jamais de contacts ni de pipeline dans le second cerveau. Rien ne remonte du second cerveau vers la base.

## Découpage (proposition)

Un lot = une branche, une PR, testable de bout en bout.

| Lot | Contenu | Comment le tester |
| --- | --- | --- |
| 0. Socle | Projet TypeScript, Compose (`db` + `app`), migrations, route de santé, CI | `docker compose up`, la page de santé répond |
| 1. Sauvegarde | Conteneur `backup`, restic, rattrapage, rétention, test de restauration | Une sauvegarde apparaît sur le stockage externe ; restauration vérifiée |
| 2. Cœur v0 | Schéma (instances, entreprises, contacts, opportunités, activités), cloisonnement RLS, journal d'audit, données fictives de la maquette | Tests : une instance ne voit jamais les données d'une autre |
| 3. MCP lecture | Jetons, outils de lecture (instances, pipeline, fiche entreprise, activités, brief du jour), `requete_lecture` | Brancher Claude sur le MCP et lui poser des questions sur les données fictives |
| 4. Propositions | File « À valider », outils MCP `proposer_*`, niveaux d'autonomie, validation ou rejet | Un agent propose, le pilote valide, le journal trace |
| 5. Interface web | API HTTP + premiers écrans : À valider, Pipeline, Journal | Parcours complet dans le navigateur |
| 6. Import | Reprise des données existantes depuis un dossier local ignoré par git | Comptages avant et après import |
| 7. Synchro second cerveau | Génération des fiches de synthèse vers l'inbox | Une fiche brouillon apparaît après une séance |

Plus tard : routines de nuit, connecteurs (HubSpot, Gmail, Agenda), prospection, devis, hébergement sur serveur.

## Questions ouvertes

- Périmètre exact de la première version (quels lots avant la mise en usage réel)
- Outils à connecter et dans quel ordre (HubSpot, Gmail, Agenda)
- Hébergement définitif (serveur, accès à distance pour les agents)
- Interface définitive
