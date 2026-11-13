# Rendez-vous : tri automatique — design

Même direction graphique que les chantiers précédents : charte actuelle, icônes sobres, aucun emoji.

## Intention (Marc)

Le rendez-vous est un objet central du CRM : lié à un contact, une organisation et une affaire, il porte son compte rendu et touche au cycle de vente et à la conversion. L'agenda mêle de vrais rendez-vous et des blocs d'organisation. Aujourd'hui le tri est manuel, un par un, dans une rubrique à part, et une partie seulement de l'agenda est de vrais rendez-vous. Il veut un tri automatique, n'avoir à confirmer que le doute, et lier facilement un compte rendu fait avec Wispr Flow.

## Approche retenue (A)

Tri automatique à chaque synchro de l'agenda ; l'humain ne tranche que le doute, en masse. La rubrique Rendez-vous reste le registre de l'objet (contacts, organisation, affaire, compte rendu) mais n'est plus un lieu de tri obligatoire. Écartées : garder le tri manuel avec seulement le tri en masse (B), supprimer la rubrique (C : plus de vue des rendez-vous sans compte rendu).

## Règles de classement (proposées, à valider)

Appliquées à un événement non encore tranché, dans cet ordre :
1. Journée entière → Organisation.
2. Événement récurrent (série Google) → Organisation (on ne rédige pas un compte rendu à chaque occurrence).
3. Ni invité ni lien de visio → Organisation (bloc de travail personnel).
4. Au moins un invité (hors Marc), non récurrent, durée de 15 min à 2 h : Rendez-vous si un invité est un contact connu du CRM ou si l'événement a un lien de visio ; sinon À confirmer.
5. Tout le reste → À confirmer.

## Décisions de Marc jamais écrasées

Une colonne `tri` (aucun, auto ou manuel ; migration 0091) distingue le classement automatique du choix de Marc. Le robot ne touche qu'aux lignes encore « à trier » ou déjà classées par lui (et peut les reclasser si l'événement change). Tout choix manuel, y compris remettre « à confirmer », met `tri` à manuel et fait foi. Les lignes existantes déjà triées ou documentées restent manuelles.

## Interface

- Rubrique Rendez-vous : onglets « À confirmer (n) », « À venir », « Sans compte rendu », « Rendez-vous », « Organisation » (ex « Ignorés »). Sur « À confirmer » : cases à cocher, « Tout sélectionner », actions de masse « Ce sont des rendez-vous » et « C'est de l'organisation ». Une ligne classée automatiquement le dit (« Classé automatiquement ») et se corrige d'un clic.
- Cockpit : une tuile « À confirmer » quand n > 0, qui ouvre cet onglet. Le compteur du menu reste.
- Agenda : les blocs d'organisation s'affichent atténués, les rendez-vous en valeur (lot 2).

## Livraisons

1. Règles de classement, colonne `tri_auto` (migration), tri en masse et nouveaux onglets.
2. Tuile du Cockpit et distinction visuelle dans l'Agenda.
3. Compte rendu Wispr Flow : l'OS propose le rendez-vous correspondant (date, heure, participants), Marc valide d'un clic ; le lien reste attaché au contact, à l'organisation et à l'affaire. Deux sens, une seule règle de rapprochement (`src/conversion/reunion-rdv.ts`) : dans l'Inbox, l'entrée de la réunion reprend le résumé Wispr Flow dans le compte rendu et présélectionne le rendez-vous (un événement à moins de 3 h ; s'il y en a plusieurs, celui qui partage un invité) ; dans la rubrique Rendez-vous, un rendez-vous passé sans compte rendu affiche « Compte rendu Wispr Flow disponible » avec un bouton qui le reprend. Les deux passent par l'enregistrement existant d'un compte rendu depuis une entrée (même lien au contact, à l'organisation et à l'affaire, entrée traitée).

## Non-objectifs

Pas de lecture du contenu des comptes rendus pour classer. Pas de règle réglable par l'utilisateur dans cette première version.

## À la charge du constructeur

Lecture de `recurringEventId` et du lien de visio dans la réponse Google (`src/connecteurs/google/google.ts`, type `Evenement`), seuils exacts de durée, textes d'aide, tests des règles avec des événements fictifs.
