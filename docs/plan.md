# Plan de développement — SIMATIS OS

> Rien de confidentiel ici : les mandats, sociétés et personnes cités sont fictifs.
>
> Découpage et décisions techniques validés le 8 octobre 2026. Les parties métier restent à détailler avec Marc.

## Objectif

Un OS commercial pour la direction commerciale à temps partagé : l'IA prépare, le pilote décide.
SIMATIS a son propre espace, et chaque mandat a le sien, avec ses accès aux outils du client.
N'importe quel agent IA peut interroger l'OS et proposer des actions, sous les règles de l'OS.
La maquette `maquettes/os-commercial/` sert de référence fonctionnelle.

## Comment on avance

Le plan a deux blocs, menés en parallèle :

| Bloc | Qui décide | Déroulé |
| --- | --- | --- |
| **Socle technique** | L'agent | Posé tout de suite, sur ce poste. Ne dépend d'aucun choix métier. Plan détaillé dans `docs/plans/`, puis implémentation, partie par partie. |
| **Parties métier** | Marc | Marc les détaille avec l'agent, en partant de la maquette. Une partie validée reçoit son plan détaillé, puis elle est construite sur le socle. |

Chaque partie avance par branche, PR, revue et merge. À la fin de chacune, l'agent explique à Marc comment tester.

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

- Un agent ne modifie rien directement : il propose, Marc valide, sauf si le niveau d'autonomie de l'action l'autorise.
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
- **Les parties métier se branchent sur le socle** : chacune ajoute ses tables, ses services, ses outils MCP, ses types de propositions et ses écrans, sans toucher aux règles du socle.

### Pile

| Brique | Choix |
| --- | --- |
| Langage | TypeScript, Node.js 24 LTS |
| Base | PostgreSQL 18 |
| Accès base | Drizzle ORM, migrations versionnées (drizzle-kit) |
| HTTP | Fastify |
| MCP | SDK officiel TypeScript, Streamable HTTP sur `/mcp` |
| Validation | Zod (partagé entre API et MCP) |
| Interface | React + Vite, servie par `app` |
| Tests | Vitest, sur une base Postgres de test |
| CI | GitHub Actions : `npm run verify` |

Un seul processus Node sert l'API, le MCP, l'interface et les synchronisations.

### Déploiement

Docker Compose, sur ce poste dans un premier temps. Ports exposés sur `127.0.0.1` uniquement. Le même fichier servira sur l'ordinateur de Marc ou sur un serveur : on y déménage en restaurant une sauvegarde.

| Service | Rôle |
| --- | --- |
| `db` | PostgreSQL, volume Docker nommé (jamais dans un dossier synchronisé iCloud ou Drive) |
| `app` | Cœur, API, MCP, interface, synchronisations |
| `backup` | Sauvegardes |

---

## Bloc 1 — Socle technique

Posé maintenant, sur ce poste. **Fin du socle** : l'OS démarre en une commande et se sauvegarde. L'instance de démonstration et deux mandats fictifs sont cloisonnés. Un agent branché sur le MCP voit son instance et le journal, et l'interface affiche le cockpit, encore vide.

### S1 — Projet et conteneurs

Statut : à faire

- Projet TypeScript ; `npm run verify` (lint, types, tests, build).
- Docker Compose : `db` et `app`.
- Migrations de base versionnées, appliquées au démarrage.
- Page de santé `/health` : base joignable, version, date de la dernière sauvegarde.
- `.env.example` documenté ; CI qui rejoue `npm run verify` sur chaque PR.

**Tester** : `docker compose up -d`, puis ouvrir `http://localhost:<port>/health`.

### S2 — Sauvegarde et exploitation

Statut : à faire

- Conteneur `backup` : `pg_dump` + restic, pour la base et le dossier `secrets/`.
- Rattrapage plutôt qu'horaire fixe : toutes les heures, une sauvegarde est lancée si la dernière réussie a plus de 24 h. Un portable en veille ne rate rien.
- Chiffrement avant envoi ; destination compatible S3 hébergée en UE ou en Suisse.
- Rétention : 7 quotidiennes, 4 hebdomadaires, 12 mensuelles.
- Test de restauration automatique chaque semaine dans une base jetable ; résultat visible sur `/health`.
- `docs/EXPLOITATION.md` : démarrer, arrêter, mettre à jour, restaurer, déménager sur une autre machine.

En attendant le choix du fournisseur, le développement se fait sur un dépôt de sauvegarde local de test ; basculer vers le vrai stockage ne demande que de modifier `.env`.

**Limite connue** : une donnée purgée en fin de mandat reste dans les sauvegardes jusqu'à expiration de la rétention, douze mois au plus.

**Deux points pour Marc** (ils ne bloquent pas le développement) :

- Quel fournisseur de stockage (Infomaniak Swiss Backup, Scaleway, Backblaze EU…), avec un compte au nom de SIMATIS ?
- Où ranger le mot de passe des sauvegardes (gestionnaire de mots de passe) ? Sans lui, elles sont illisibles.

### S3 — Instances, cloisonnement et journal

Statut : à faire

- Instances `propre`, `mandat`, `demo` ; statuts actif ou archivé.
- Configuration non secrète par instance, en base, validée par un schéma. Chaque partie métier y déclare ses propres réglages.
- Secrets chargés depuis `secrets/instances/<instance>.env`. Le démarrage échoue avec un message clair s'il manque un secret pour une connexion activée.
- Conventions imposées à toute table métier : identifiant d'instance, source et identifiant d'origine pour les données copiées, Row-Level Security, dates de création et de mise à jour.
- Journal d'audit en ajout seul, imposé par la base.
- Commandes d'administration, lancées par l'agent : créer, archiver, purger une instance.
- Instances fictives de la maquette pour la démonstration.

**Tester** : les tests prouvent qu'une instance ne lit jamais les données d'une autre, même par une requête SQL écrite à la main.

### S4 — Moteur de propositions et d'autonomie

Statut : à faire

- Une proposition a un type, un contenu, une instance, un auteur et un statut (proposée, validée, modifiée, écartée, appliquée, en échec).
- Les types (email, tâche, mise à jour HubSpot…) sont déclarés par les parties métier ; le moteur les traite tous de la même façon.
- Niveaux L0 à L3 par action et par instance, avec des limites verrouillées.
- Mode simulation sur toute écriture ; double verrou pour toute écriture réelle vers un outil externe.
- Un agent ne peut jamais valider ses propres propositions.
- Chaque étape est tracée au journal.

**Tester** : avec un type de proposition de test, vérifier qu'un niveau L0 bloque, qu'un L1 attend la validation, et qu'une limite verrouillée ne se dépasse pas.

### S5 — Serveur MCP

Statut : à faire

- Transport Streamable HTTP sur `/mcp` ; pont `mcp-remote` pour les agents qui ne parlent que stdio.
- Jetons : un par agent et par instance, plus un jeton « portefeuille » limité aux compteurs. Créés par commande, stockés hachés.
- Registre d'outils : chaque partie métier y ajoute les siens.
- Outils de base : `instance_courante`, `journal_recent`, `propositions_en_attente`, `requete_lecture`.
- Chaque appel est journalisé.

**Tester** : brancher Claude sur l'instance de démonstration, lui demander sur quelle instance il travaille et ce que dit le journal ; vérifier qu'un jeton de mandat ne voit rien d'un autre mandat.

### S6 — Cadre des connexions

Statut : à faire

- Interface commune à tous les connecteurs : lecture, synchronisation, écriture en simulation ou en réel.
- Une connexion appartient à une seule instance et n'utilise que les secrets de cette instance. Pas de repli.
- Planificateur de synchronisation avec rattrapage, plus une synchronisation à la demande.
- Copie de travail : l'outil d'origine fait foi, ses données écrasent la copie en cas d'écart.
- Un connecteur factice sert aux tests ; les vrais connecteurs arrivent avec la partie métier M8.

**Tester** : le connecteur factice se synchronise dans une instance, sans jamais écrire dans une autre.

### S7 — Socle de l'interface web

Statut : à faire

- Application React servie par `app`, accessible seulement depuis ce poste.
- Coquille de la maquette : menu par groupes, sélecteur d'instance, portefeuille, styles.
- Deux premiers écrans, qui relèvent du socle : Journal d'audit et Fiche d'instance (sans secret).
- Les écrans métier viennent s'y ajouter au fil des parties métier.

**Tester** : ouvrir l'interface, changer d'instance, consulter le journal et la fiche d'instance.

Ordre : S1 → S2 → S3, puis S4, S5, S6 et S7, qui dépendent de S3 mais pas les unes des autres.

---

## Bloc 2 — Parties métier (à détailler avec Marc)

Point de départ : la maquette. Pour chaque partie, Marc dit ce qu'il garde, ce qu'il change, ce qui manque, et ce qui vient en premier.

### M1 — Objets commerciaux

Statut : à relire

- **Décidé** : l'instance SIMATIS a son HubSpot. Chaque mandat garde le CRM choisi par le client ; quand il en a un, entreprises, contacts et pipeline de l'OS en sont le miroir exact (le CRM fait foi). Sans CRM, l'OS tient lui-même le pipeline.

- **Proposé** : entreprises, contacts, opportunités (étape, montant, échéance), activités (email, rendez-vous, appel, note), tâches.
- **À trancher** : ces objets suffisent-ils ? Lesquels manquent ? Pour l'instance SIMATIS, existe-t-il un HubSpot SIMATIS, ou l'OS est-il lui-même le CRM de SIMATIS ?
- La grille de scoring détaillée est une méthode propriétaire : elle vivra dans la configuration privée de l'instance, jamais dans le dépôt.

### M2 — Pilotage : Brief du jour, À valider, Tableau de bord

Statut : validée (retours de Marc sur la maquette, 8 octobre 2026)

- **Décidé** : Brief du jour allégé : plus de signaux, de rapport de routine ni de pipeline par score. Il affiche les tâches réalisées hier, sur 7 jours et sur 30 jours, avec le détail emails et appels. Tableau de bord gardé tel quel. À valider regroupe les relances à planifier et les brouillons à envoyer. Brouillons Gmail toujours créés sans signature.
- **Transverse** : favoris par utilisateur en haut du menu (par défaut Pipeline, Brief du jour, Prospection) ; pas de sous-titre sous les titres, une infobulle quand un élément n'est pas évident.

- **Dans la maquette** : ce qui attend Marc le matin, la file des propositions à valider, l'entonnoir lead → prospect → devis → commande avec simulation de l'objectif annuel.
- **À trancher** : contenu du brief, types de propositions utiles en premier, indicateurs et seuils de l'entonnoir.

### M3 — Stratégie : Plan d'action, Démarrage du mandat, Diagnostic

Statut : reportée

- **Plan d'action** : à redéfinir comme une liste d'actions élémentaires à court, moyen et long terme, pas une déclinaison de la stratégie.
- **Diagnostic** : parcours en trois étapes (préparer la présentation, exécuter, analyser et produire le rapport). Un mandant ne voit que son propre diagnostic et son dernier test.

- **Dans la maquette** : la trame en sept blocs, les trois situations de départ d'un mandat, le profil d'entreprise sur trois dimensions.
- **À trancher** : ce qui sert dès la première version ; ce qui relève d'une méthode propriétaire et doit rester dans la configuration privée.

### M4 — Générer la demande : Détection, Prospection, Bases vivantes

Statut : à relire (Prospection et Bases vivantes prioritaires, Détection reportée)

- **Décidé** : les règles de sélection s'affichent explicitement (base utilisée, ciblage, exclusions). Les bases vivantes seront branchées sur une base de données commune, en conception avec un partenaire (détails dans le second cerveau).
- **Prospection** : Marc doit l'essayer avant de trancher ; le fonctionnement actuel ne le convainc pas encore.
- **Détection** : reportée, à repenser (d'où vient la donnée, ce qu'un clic doit produire).

- **Dans la maquette** : signaux faibles, règles de sélection et lots de brouillons, bases importées et enrichies.
- **À trancher** : sources des signaux, outils de prospection à brancher, formats d'import.

### M5 — Convertir : Pipeline, Rendez-vous, Devis, Relais internes

Statut : à relire (Pipeline indispensable)

- **Décidé** : taux de conversion entre chaque étape du pipeline, colonnes Gagnées et Perdues. Pour un mandat sous HubSpot, le pipeline de l'OS est le reflet exact du pipeline HubSpot : HubSpot fait foi, les changements faits dans l'OS y sont écrits. Objectif : que Marc n'ait plus à ouvrir HubSpot. Le Devis est une brique propre à l'instance SIMATIS, jamais exposée aux mandats.

- **Dans la maquette** : pipeline en colonnes ou en matrice, préparation et compte rendu de rendez-vous, devis préparé par l'OS, points mensuels avec les experts du mandat.
- **À trancher** : étapes du pipeline par défaut et par mandat, trame de préparation de rendez-vous, place du devis (dans l'OS ou dans HubSpot).

### M6 — Instruments de bord : Routines, Autonomie, Second cerveau

Statut : à relire (Routines Claude prioritaires)

- **Décidé** : les Routines Claude sont en tête du menu. Ce sont les skills Claude que Marc utilise chaque jour (relance quotidienne, nettoyage des tâches) ; il veut les lancer depuis l'OS, instance par instance, avec les connexions de l'instance (CRM, Gmail, agenda) et aucune autre. Les paramètres de chaque routine (heure, jours, tâches traitées, nombre de brouillons, créneaux) se règlent depuis l'OS, par instance.
- Autonomie, Journal d'audit et vue du second cerveau : pas prioritaires.

- **Dans la maquette** : rythmes automatiques, réglage des niveaux L0 à L3, fiche second cerveau.
- **À trancher** : routines utiles et leur rythme ; niveaux d'autonomie par défaut d'un nouveau mandat ; synchro vers le second cerveau (emplacement, rythme, contenu : fiches de synthèse, comptes rendus, décisions, jamais de contacts ni de pipeline).

### M7 — L'IA au quotidien

Statut : à relire

- **Proposé** : des outils MCP métier (`brief_du_jour`, `pipeline`, `fiche_entreprise`, `fiche_contact`, `activites_recentes`, `rechercher`) et des outils `proposer_*`.
- **À trancher** : quelles IA Marc utilise ; les dix questions qu'il veut poser à l'OS ; les actions qu'il veut déléguer.

### M8 — Connexions

Statut : à relire (prioritaire : connexions du premier mandat sous HubSpot)

- **Décidé** : connexions établies par mandat (HubSpot, Gmail et agenda du mandat), utilisées par les Routines Claude et par le pipeline miroir.

- **SIMATIS** : Gmail et agenda de Marc. Un email validé devient un brouillon Gmail, que Marc envoie lui-même.
- **Mandats** : HubSpot (jeton d'application privée par compte client), Gmail et agenda du client (identifiant Google propre au Workspace du client). Procédures d'ouverture et de fin de mandat.
- **À trancher** : Google Workspace ou gmail.com pour SIMATIS ; profondeur d'historique ; corps complet des emails ou extraits ; objets HubSpot utiles ; qui crée les accès chez les clients.
- Point Google : avec Google Workspace, une application interne évite la vérification de Google ; avec un compte gmail.com, l'écran « application non vérifiée » s'affichera à l'autorisation.

## Plus tard

- Brief et routines rédigés par IA côté serveur (demande une clé d'API et un budget).
- Envoi direct d'emails, sous double verrou.
- Hébergement sur serveur, avec accès à distance pour les agents.
