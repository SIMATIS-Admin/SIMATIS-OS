# Relais SIMATIS : piloter les CRM clients depuis SIMATIS OS

Date : 28 novembre 2026. État : **cadrage à valider**, rien n'est construit.

## Intention

Travailler pour un client sans se connecter à son CRM : une instance SIMATIS OS par client est la
fenêtre sur ce client. Les CRM des clients reprennent le modèle de données de la partie CRM de
SIMATIS OS, et la mécanique se recopie d'une mission à l'autre.

Trois usages : suivre les affaires à deux, se confier des tâches, échanger messages et documents.

## Approches

| Approche | Principe | Pour | Contre |
| --- | --- | --- | --- |
| **A. Tout par un relais (retenue)** | OS et CRM client déposent et relèvent chez un relais SIMATIS | un seul mécanisme pour les trois usages ; le CRM client n'ouvre aucun accès entrant ; la synchro dans les deux sens existe côté OS | brique à écrire côté client ; un relais à exploiter |
| B. Branchement direct | l'OS appelle l'API du CRM client (connecteur `crm-os`, lecture seule) | le plus court | CRM client à exposer en ligne ; tâches et messages à refaire à part |
| C. Les deux | direct pour le CRM, relais pour le reste | démarrage rapide | deux mécanismes à entretenir chez chaque client |

Choix de Marc : A.

## Architecture

    SIMATIS OS (une instance par client)  ──▶  relais SIMATIS  ◀──  CRM du client A
                                          ──▶                  ◀──  CRM du client B
    instance du partenaire existant       ──▶  relais existant (inchangé)

- L'OS et les CRM clients appellent le relais, jamais l'inverse.
- Chaque instance a sa propre identité sur le relais (un « nœud ») et **une seule** connexion
  cliente. Un nœud ne relève que sa propre boîte.
- Le protocole reste celui du kit `os-agents-relay` (profil `crm/1`, messages, missions, états),
  utilisé tel quel des deux côtés.

## Règles décidées

1. **Les données vivent chez le client.** L'instance SIMATIS OS en garde une copie de travail ; les
   modifications faites dans l'OS repartent chez le client.
2. **Cloisonnement** : aucun client ne voit les données d'un autre. C'est une contrainte de départ.
3. **Le partenaire existant garde son relais** : l'adresse du relais se règle par instance.

## Mes choix (à corriger si besoin)

- **Hébergement** : Cloudflare (Worker et base D1), offre gratuite au départ. Adresse
  `relais.simatis.fr` si le domaine peut être géré chez Cloudflare, sinon l'adresse fournie par
  Cloudflare. Aucun réglage du domaine n'est touché sans l'accord de Marc.
- **Code du relais** : dépôt privé séparé, copie de la partie serveur d'`os-agents-relay`. Le kit
  n'est pas modifié.
- **Invitations** : seul un nœud inscrit avec la clé d'inscription peut inviter. Aujourd'hui, tout
  nœud inscrit le peut, donc un client pourrait relier des tiers.
- **Sens de l'invitation** : SIMATIS OS invite, le client colle le lien. La clé d'inscription ne
  quitte jamais SIMATIS OS.
- **Deux types de connexion** : « partenaire » (comportement actuel, inchangé) et « client ».
- **Conflits** : si la même donnée change des deux côtés, la plus récente gagne et l'OS le signale
  dans l'Inbox (règle actuelle du kit).
- **Suppressions** : jamais automatiques. L'autre côté est interrogé.
- **Étapes du pipeline** : en connexion « client », celles du client s'appliquent dans l'instance
  (aujourd'hui, l'OS ignore les étapes reçues).
- **Premier branchement** : l'instance doit être vide de fiches CRM, ou Marc confirme la liste de ce
  qui partira chez le client. La qualification des affaires n'est pas partagée par défaut.
- **Un seul chemin par instance** : une instance reliée par le relais n'a pas aussi un CRM branché
  (`crm-os`, HubSpot), pour éviter les doublons.
- **Écritures** : double verrou habituel (`REAL_WRITES` et interrupteur de l'instance).
- **Tâches confiées** : d'abord de Marc vers le client ; les demandes du client vers Marc viendront
  ensuite. Les messages vont dans les deux sens.

## Lots, dans l'ordre

Chaque lot a ensuite son plan, ses tests et sa livraison.

| Lot | Contenu | Fini quand |
| --- | --- | --- |
| 1. Le relais | dépôt, droit d'inviter restreint, déploiement, test de cloisonnement | deux nœuds de test clients ne peuvent ni se lire, ni s'écrire, ni inviter |
| 2. L'OS | adresse et clé du relais par instance, type de connexion « client », étapes du client, contrôle du premier branchement | une instance fictive se relie au nouveau relais, et la liaison existante fonctionne comme avant |
| 3. La brique client | module recopiable dans un CRM client : connexion par lien, envoi et relève, synchro CRM | avec des données fictives, une affaire modifiée d'un côté apparaît de l'autre, et inversement |
| 4. Tâches et messages | côté client : écran des demandes reçues (accepter, préciser, terminer, refuser) et fil de messages ; côté OS : réutilisation de l'existant | une demande envoyée depuis l'OS revient « faite » |
| 5. Documents | un espace de fichiers partagé par client (le relais ne transporte que de petits messages) | cadrage à part |

La brique client est écrite d'abord pour un premier CRM existant, dans un dossier autonome, puis
recopiée. Elle lit et écrit les fiches dans les champs `crm/1`.

## Hors périmètre

- Prendre la main sur les écrans ou les réglages du CRM d'un client.
- Synchroniser ce que `crm/1` ne contient pas (devis, factures, champs propres à un métier).
- Construire le CRM d'un client.
- Chiffrer les messages de bout en bout.
- Déplacer la liaison du partenaire existant.

À éviter absolument : une donnée d'un client visible ailleurs ; un envoi réel sans le double
verrou ; une fiche effacée sans confirmation ; la liaison existante interrompue.

## Contraintes et préalables

- **Accord écrit de l'auteur d'`os-agents-relay`** avant de copier son code : le dépôt est public
  mais sans licence. L'accord doit couvrir l'usage chez des clients (serveur et kit). À défaut, le
  relais est réécrit à partir du comportement attendu, et la question du kit reste à régler.
- Un compte Cloudflare au nom de Simatis, créé par Marc.
- Le relais lit le contenu des messages et garde ceux qui ne sont pas relevés (30 jours au plus).
  Simatis devient donc intermédiaire de données des clients : à prévoir dans les contrats.
- Un CRM client doit tourner en continu pour relever sa boîte : son hébergement se décide par
  client.
- SIMATIS OS tourne sur le poste de Marc : éteint, rien n'est relevé ; tout est repris au retour
  dans la limite des 30 jours.
- Dépôt public : aucun nom de client, aucune donnée réelle, aucune clé.

## Points de départ dans le code

- `src/partenaires/` : connexions, invitations, missions, synchro (`synchro.ts`,
  `crm-profil.ts`), relève toutes les 60 s (`releve.ts`).
- `src/partenaires/service.ts` : `clientPour` prend aujourd'hui une adresse unique (`RELAIS_URL`).
- `src/partenaires/echanges.ts` : `instanceDuRelais` choisit le partenaire d'après son nom ; à
  vérifier quand plusieurs mandats ont une connexion.
- `src/crm/pipeline.ts` : étapes propres à une instance (`config.pipeline.etapes`).

## Laissé à la réalisation

Forme des réglages par instance, migrations, écrans, découpage des plans de chaque lot.
