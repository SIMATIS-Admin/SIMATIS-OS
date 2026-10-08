# Plan de développement — SIMATIS OS

> Rien de confidentiel ici : les mandats, sociétés et personnes cités sont fictifs.

## Objectif

Un OS commercial pour la direction commerciale à temps partagé : l'IA prépare, le pilote décide.
SIMATIS a son propre espace, et chaque mandat a le sien, avec ses accès aux outils du client.
N'importe quel agent IA peut interroger l'OS et proposer des actions, sous les règles de l'OS.
La maquette `maquettes/os-commercial/` sert de référence fonctionnelle.

## Comment on avance

Le plan est découpé en parties. Pour chacune :

1. Marc la relit et fait ses remarques à l'agent.
2. L'agent ajuste la partie, puis écrit son plan technique détaillé dans `docs/plans/`.
3. Implémentation sur une branche, PR, revue, merge.
4. L'agent explique à Marc, étape par étape, comment tester.

Statuts possibles : à relire, validée, en cours, livrée.

## Principes

### Instances

- **SIMATIS** : l'instance propre, unique, branchée sur les outils de Marc.
- **Un mandat = une instance**, branchée sur les outils du client (son HubSpot, son Gmail, son agenda…).
- **Démonstration** : des données fictives.

Chaque instance a sa configuration et ses accès. Aucune ne lit les données d'une autre, SIMATIS compris. Seul le portefeuille croise les instances, et uniquement par des compteurs.

### Données : une copie de travail

- Les données d'un mandat vivent dans les outils du client. L'OS en garde une **copie de travail** pour que les agents puissent s'en servir ; l'outil du client fait foi en cas d'écart.
- L'OS ajoute ses propres données : propositions, journal, préparations et comptes rendus de rendez-vous, plans d'action.
- **Fin de mandat** : archivage, puis purge de la copie. Rien à exporter : le client a déjà tout dans ses outils.

### Écritures vers les outils réels

- Un agent ne modifie rien directement : il propose, Marc valide (sauf niveau d'autonomie qui l'autorise).
- Simulation par défaut ; le mode réel exige un double verrou (variable serveur + interrupteur admin).
- Aucun repli d'un mandat vers un autre : si un mandat n'a pas de Gmail configuré, rien ne part, et surtout pas depuis la boîte SIMATIS.

### Secrets

- Un fichier par instance : `secrets/instances/<instance>.env` (dossier ignoré par git, droits restreints, monté en lecture seule dans le conteneur).
- Les secrets ne sortent jamais du module des connexions : ni API, ni MCP, ni journal, ni logs.
- Ils sont inclus dans la sauvegarde chiffrée.
- Un coffre chiffré en base n'est pas nécessaire avec quelques mandats ; à reconsidérer au-delà d'une dizaine.

## Décisions techniques

### Architecture

```
Postgres ← cœur SimatisOS (services métier, règles, journal d'audit)
              ├─ API HTTP    → interface web
              └─ serveur MCP → agents IA (Claude, ChatGPT, Cursor…)
```

- **Le MCP passe par le cœur, jamais directement par la base** : les règles (autonomie, cloisonnement, garde-fous, simulation, journal) n'existent qu'à un seul endroit.
- **Outils MCP en langage métier** plutôt que du SQL libre, plus un outil `requete_lecture` en lecture seule sur des vues choisies, limité à l'instance du jeton.
- **Cloisonnement imposé deux fois** : par le cœur (contexte d'instance obligatoire) et par Postgres (Row-Level Security).
- **Une seule base partagée** : pas d'export de fin de mandat, donc pas besoin d'une base par mandat.

### Pile

| Brique | Choix |
| --- | --- |
| Langage | TypeScript, Node.js 24 LTS |
| Base | PostgreSQL 18 |
| Accès base | Drizzle ORM, migrations versionnées (drizzle-kit) |
| HTTP | Fastify |
| MCP | SDK officiel TypeScript, Streamable HTTP sur `/mcp` |
| Validation | Zod (partagé entre API et MCP) |
| Tests | Vitest, sur une base Postgres de test |
| CI | GitHub Actions : `npm run verify` |

Un seul processus Node sert l'API, le MCP et les synchronisations.

### Déploiement

Docker Compose, en local dans un premier temps. Ports exposés sur `127.0.0.1` uniquement. Le même fichier servira pour un futur serveur.

| Service | Rôle |
| --- | --- |
| `db` | PostgreSQL, volume Docker nommé (jamais dans un dossier synchronisé iCloud ou Drive) |
| `app` | Cœur, API, MCP, synchronisations |
| `backup` | Sauvegardes (partie 2) |

## Parties

### Partie 1 — Socle technique

Statut : à relire

**Ce que Marc obtient** : l'OS démarre sur son ordinateur en une commande, encore vide.

- Projet TypeScript ; `npm run verify` (lint, types, tests, build).
- Docker Compose : `db` et `app`.
- Migrations de base versionnées, appliquées au démarrage.
- Page de santé `/health` : base joignable, version, et date de dernière sauvegarde dès la partie 2.
- `.env.example` documenté ; CI qui rejoue `npm run verify` sur chaque PR.

**Tester** : `docker compose up -d`, puis ouvrir `http://localhost:<port>/health`.

**Questions pour Marc**

- Sur quel ordinateur l'OS tournera-t-il (Mac, Windows) ? Est-il allumé toute la journée ?
- Docker Desktop est-il installé ?

### Partie 2 — Sauvegarde

Statut : à relire

**Ce que Marc obtient** : chaque jour, une copie chiffrée de la base et des secrets, hors de son ordinateur, vérifiée chaque semaine.

- Conteneur `backup` : `pg_dump` + restic, pour la base et le dossier `secrets/`.
- Rattrapage plutôt qu'horaire fixe : toutes les heures, une sauvegarde est lancée si la dernière réussie a plus de 24 h. Un portable en veille ne rate rien.
- Chiffrement avant envoi ; destination compatible S3 hébergée en UE ou en Suisse (Infomaniak Swiss Backup, Scaleway, Backblaze EU…).
- Rétention : 7 quotidiennes, 4 hebdomadaires, 12 mensuelles.
- Test de restauration automatique chaque semaine dans une base jetable ; résultat visible sur `/health`.
- Procédure de restauration écrite dans `docs/EXPLOITATION.md`.

**Tester** : lancer une sauvegarde à la main, la voir sur le stockage, restaurer dans une base jetable.

**Limite connue** : une donnée purgée en fin de mandat reste dans les sauvegardes jusqu'à expiration de la rétention, douze mois au plus.

**Questions pour Marc**

- Quel fournisseur de stockage, avec un compte au nom de SIMATIS ?
- Où ranger le mot de passe des sauvegardes (gestionnaire de mots de passe) ? Sans lui, elles sont illisibles.

### Partie 3 — Instances, configuration et cloisonnement

Statut : à relire

**Ce que Marc obtient** : un espace SIMATIS et un espace par mandat, chacun avec ses réglages et ses accès, sans fuite de l'un à l'autre.

- Instances `propre`, `mandat`, `demo` ; statuts actif ou archivé.
- Configuration non secrète par instance, en base : étapes du pipeline, niveaux d'autonomie, garde-fous, signature, connexions activées.
- Secrets chargés depuis `secrets/instances/<instance>.env`. Le démarrage échoue avec un message clair s'il manque un secret pour une connexion activée.
- Cloisonnement par le cœur et par Row-Level Security.
- Journal d'audit en ajout seul, imposé par la base.
- Commandes d'administration, lancées par l'agent : créer, archiver, purger une instance.
- Instances fictives de la maquette pour la démonstration.

**Tester** : les tests prouvent qu'une instance ne lit jamais les données d'une autre ; créer un mandat fictif et consulter sa fiche.

**Questions pour Marc**

- Au-delà des accès, qu'est-ce qui change d'un mandat à l'autre (étapes du pipeline, signature, rythme des routines, objectifs…) ?
- Quels niveaux d'autonomie par défaut pour un nouveau mandat ?

### Partie 4 — Modèle commercial

Statut : à relire

**Ce que Marc obtient** : les objets qu'il manipule chaque jour, rangés de la même façon dans toutes les instances.

- Entreprises, contacts, opportunités (étape, montant, échéance), activités (email, rendez-vous, appel, note), tâches.
- Chaque objet copié garde sa source (`hubspot`, `gmail`, `agenda`, ou `os` s'il est créé dans l'OS) et son identifiant d'origine.
- Données propres à l'OS : préparations et comptes rendus de rendez-vous, qualification, plan d'action.
- La grille de scoring détaillée est une méthode propriétaire : elle vit dans la configuration privée de l'instance, jamais dans le dépôt.

**Tester** : les données fictives de la maquette, chargées dans l'instance de démonstration.

**Questions pour Marc**

- Ces objets suffisent-ils pour une première version ? Lesquels manquent ?
- Pour l'instance SIMATIS : existe-t-il un HubSpot SIMATIS, ou l'OS est-il lui-même le CRM de SIMATIS ?

### Partie 5 — MCP en lecture

Statut : à relire

**Ce que Marc obtient** : il ouvre son IA, choisit l'instance, et lui pose des questions sur son activité.

- Serveur MCP sur `/mcp` ; pont `mcp-remote` pour les agents qui ne parlent que stdio.
- Jetons : un par agent et par instance, plus un jeton « portefeuille » limité aux compteurs. Créés par commande, stockés hachés.
- Outils : `brief_du_jour`, `pipeline`, `fiche_entreprise`, `fiche_contact`, `activites_recentes`, `rechercher`, `requete_lecture`.
- Chaque appel est journalisé.

**Tester** : brancher Claude sur l'instance de démonstration et lui demander, par exemple, quelles opportunités sont bloquées.

**Questions pour Marc**

- Quelles IA utilisez-vous (Claude Desktop, ChatGPT, autre) ?
- Les dix questions que vous aimeriez poser à l'OS : elles définissent les outils.

### Partie 6 — Propositions et autonomie

Statut : à relire

**Ce que Marc obtient** : l'IA prépare emails, tâches et mises à jour ; Marc valide d'un clic.

- File « À valider » : brouillon d'email, tâche, modification d'un objet, note.
- Outils MCP `proposer_*`. Un agent ne peut jamais valider ses propres propositions.
- Niveaux L0 à L3 par action et par instance, avec les limites verrouillées de la maquette.
- Mode simulation sur toute écriture.
- Une première page web : la file « À valider », avec Valider, Modifier, Écarter.
- Les propositions touchant un outil externe (email, HubSpot) restent en attente d'application jusqu'aux parties 7 et 8.

**Tester** : demander à l'IA de préparer une tâche de relance, la retrouver dans la page, la valider, la voir au journal.

**Questions pour Marc**

- Quelles actions l'IA peut-elle faire seule, et lesquelles doivent toujours passer par vous ?

### Partie 7 — Connexions SIMATIS (Gmail et agenda de Marc)

Statut : à relire

**Ce que Marc obtient** : l'OS connaît ses emails et son agenda ; un email validé arrive en brouillon dans Gmail.

- Autorisation Google donnée une fois, par une commande qui écrit le jeton dans le fichier de secrets de l'instance.
- Synchronisation en lecture, toutes les 15 minutes et à la demande : emails (expéditeur, destinataires, objet, date, extrait) et rendez-vous, rattachés aux contacts connus.
- Un email validé devient un **brouillon Gmail** ; Marc l'envoie lui-même. L'envoi direct viendra plus tard, sous double verrou.
- Création de rendez-vous : proposition, puis validation.
- Point Google : avec Google Workspace, une application interne évite la vérification de Google ; avec un compte gmail.com, l'écran « application non vérifiée » s'affichera à l'autorisation.

**Tester** : demander à l'IA « qu'ai-je demain ? » ; valider un email et le retrouver dans les brouillons Gmail.

**Questions pour Marc**

- Votre boîte est-elle sur Google Workspace ou gmail.com ?
- Combien d'historique récupérer (3 mois, 12 mois) ?
- Corps complet des emails, ou extraits seulement ?

### Partie 8 — Connexions de mandat (HubSpot, Gmail et agenda du client)

Statut : à relire

**Ce que Marc obtient** : pour chaque mandat, l'OS travaille avec les outils du client, et seulement eux.

- HubSpot : jeton d'application privée par compte client ; synchronisation des entreprises, contacts, transactions et notes. HubSpot fait foi en cas d'écart.
- Écritures vers HubSpot uniquement par propositions validées, en simulation par défaut, mode réel sous double verrou.
- Gmail et agenda du client : même mécanisme qu'en partie 7, avec un identifiant Google propre au Workspace du client.
- Procédure d'ouverture de mandat : ce que l'administrateur du client doit créer, ce qui va dans le fichier de secrets.
- Procédure de fin de mandat : archivage, purge de la copie, suppression du fichier de secrets.

**Tester** : un compte HubSpot de test gratuit, rempli de données fictives.

**Questions pour Marc**

- Quels objets HubSpot vous servent (entreprises, contacts, transactions, tâches, notes, autres) ?
- Chez les clients, qui peut créer les accès (administrateur HubSpot, administrateur Google) ?

### Partie 9 — Interface web

Statut : à relire

**Ce que Marc obtient** : le cockpit de la maquette, branché sur les vraies données.

- Sélecteur d'instance, Brief du jour, À valider (reprise de la partie 6), Pipeline, Fiche entreprise, Journal, Fiche d'instance sans secret.
- Accessible seulement depuis l'ordinateur de Marc tant que l'OS est local.
- Reprise du style de la maquette ; technologie choisie dans le plan détaillé de la partie.
- Les autres écrans de la maquette ensuite, par ordre de priorité.

**Tester** : parcours complet dans le navigateur sur l'instance de démonstration.

**Questions pour Marc**

- Quels écrans vous servent en premier ?

### Partie 10 — Synchro vers le second cerveau

Statut : à relire

**Ce que Marc obtient** : son second cerveau se nourrit de l'activité, sans recopier de données brutes.

- Sens unique, OS → second cerveau : fiche de synthèse hebdomadaire par instance, comptes rendus de rendez-vous, décisions et leurs raisons.
- Fiches déposées en brouillon dans l'inbox du second cerveau (chemin dans `.env`), rattachées au bon mandat, puis traitées par la procédure Mémoriser.
- Jamais de contacts ni de pipeline.

**Tester** : après une séance sur l'instance de démonstration, une fiche brouillon apparaît dans l'inbox.

**Questions pour Marc**

- Où se trouve votre second cerveau sur l'ordinateur ?
- À quel rythme voulez-vous ces fiches ?

## Plus tard

- Routines de nuit et brief du jour rédigé par IA (demande une clé d'API et un budget).
- Détection de signaux faibles, prospection, devis, diagnostic, relais internes.
- Envoi direct d'emails, sous double verrou.
- Hébergement sur serveur, avec accès à distance pour les agents.
