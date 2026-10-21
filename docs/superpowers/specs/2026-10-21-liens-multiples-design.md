# Liens multiples entre fiches (Personnes, Affaires, Organisations)

Date : 2026-10-21 · Statut : à relire

## Objectif

Depuis une fiche de l'OS, ajouter des personnes et des affaires comme on ajoute des organisations, et les lier entre elles comme dans HubSpot : plusieurs personnes par affaire, plusieurs organisations par affaire, plusieurs organisations par personne. Les affaires créées ou liées apparaissent dans le pipeline. À terme, l'OS peut se substituer à HubSpot.

La règle est la même pour l'OS et pour HubSpot : un lien posé dans l'OS est écrit dans HubSpot (sous le double verrou existant), un lien posé dans HubSpot arrive dans l'OS à la synchronisation.

## Ce qui existe déjà

- Création d'une personne (page Contacts), d'une affaire (page Pipeline) et d'une organisation (page Entreprises), avec écriture HubSpot en simulation par défaut.
- Un seul lien par relation : `opportunites.contact_id`, `opportunites.entreprise_id`, `contacts.entreprise_id`. Ces colonnes sont lues par le pipeline, les tâches, les fiches et la synchronisation.
- Opérations d'écriture HubSpot : `deal.create`, `deal.associer`, `contact.update`.
- Le pipeline liste déjà toutes les affaires de l'instance.

## Décisions

- **Liens multiples comme HubSpot** (décidé par Marc).
- **Le lien existant devient le lien principal** : les colonnes actuelles restent, pour ne pas toucher au reste du code. Les nouveaux liens vivent dans des tables de liaison.
- Hors périmètre : synchronisation inversée complète et migration des données pour quitter HubSpot.

## Design

### 1. Données

Trois tables de liaison, chacune avec `instance_id` et la politique d'isolation des autres tables métier :

- `affaire_contacts` (affaire, personne, `principal`)
- `affaire_entreprises` (affaire, organisation, `principal`)
- `contact_entreprises` (personne, organisation, `principal`)

Unicité par paire dans une instance. Une seule ligne `principal` par fiche source. La suppression d'une fiche supprime ses liens. Une migration reprend les liens uniques existants comme liens principaux.

### 2. Service de liens (règle commune)

Un seul service (`src/crm/liens.ts`) pour lier, délier et désigner le principal. Pour chaque appel :

1. Vérifier que les deux fiches appartiennent à l'instance.
2. Si l'instance a un CRM HubSpot en lecture/écriture : écrire d'abord dans HubSpot (`deal.associer`, nouvelles opérations de dissociation et de lien principal), dans le respect du dry-run et du double verrou ; en simulation ou en échec, rien n'est écrit dans l'OS.
3. Écrire le lien dans la table de liaison et mettre à jour la colonne principale (délier le principal promeut un autre lien, ou vide la colonne).
4. Journaliser l'action.

Sans HubSpot (instances natives et démo), seule l'OS est écrite.

### 3. Synchronisation HubSpot vers l'OS

Elle lit **toutes** les associations des affaires et des personnes (et non la première), remplit les tables de liaison et fixe le principal selon HubSpot. Un lien en simulation locale n'est jamais écrasé. Les liens disparus côté HubSpot sont retirés.

### 4. Interface

- Sur chaque fiche, les cartes Personnes, Affaires et Organisations ont un bouton **+ Ajouter** : « Créer » (formulaire existant, fiche déjà liée) ou « Lier une fiche existante » (recherche).
- Chaque ligne a une croix (délier) et une étoile (principal). Le texte et les boutons sont lisibles (leçon du menu « Nouveau » blanc sur blanc).
- Création d'une affaire depuis une fiche : titre et étape, comme « Nouvelle affaire » du pipeline.

### 5. Pipeline

Aucun changement de requête : une affaire créée ou liée depuis une fiche apparaît dans la colonne de son étape. La carte affiche l'organisation et la personne principales.

### 6. Tests et vérification

- Service de liens : lier, délier, principal, doublon, isolation par instance, simulation, échec HubSpot (rien d'écrit dans l'OS).
- Synchronisation : plusieurs associations par affaire et par personne, retrait d'un lien, lien local préservé.
- Interface : ajout (créer et lier), suppression, principal, sur les trois types de fiche.
- Données fictives uniquement. `npm run verify` avant chaque commit, puis vérification dans le navigateur.

## Points ouverts

- Le lien principal d'une fiche HubSpot se choisit dans HubSpot : l'OS ne sait pas encore écrire les types d'association « primaire » (à confirmer dans l'API, sans écriture réelle). L'étoile est donc masquée sur ces fiches, et le principal d'un lien entre fiches HubSpot revient de la synchronisation.
