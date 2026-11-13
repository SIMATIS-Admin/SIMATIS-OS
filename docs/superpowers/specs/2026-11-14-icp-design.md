# Écran ICP — design (chantier 3 sur 3)

Suite de `2026-11-14-detecter-design.md`. Même direction graphique : charte actuelle, icônes sobres, aucun emoji.

## Décisions de Marc

- Alpes IA est une instance à part (un mandat), comme SIMATIS : le sélecteur d'instance du menu suffit à choisir. L'écran ICP ne montre que les ICP de l'instance courante, jamais ceux des autres.
- Constat à l'essai : les ateliers d'une instance peuvent porter sur plusieurs entreprises (l'instance SIMATIS porte aussi ceux d'Alpes IA). L'écran propose donc, quand il y en a plusieurs, un choix de l'entreprise en haut (une seule entreprise affichée à la fois) ; l'instance Alpes IA, elle, montre les siens directement.
- Lecture seule : les ICP se créent et se modifient dans l'Atelier stratégique.

## Contenu

Écran `icp` (entrée « ICP » de Détecter, deuxième après Recherches). Une carte compacte par ICP, lue par `fetchCiblages` : code et nom, offre (trois lignes), puis « Cible et persona » replié (champs vides masqués). Deux actions par carte : « Chercher selon cet ICP » ouvre Recherches avec cet ICP présélectionné (`recherches/ouvrir/<atelierId>~<code>`), « Modifier dans l'Atelier » ouvre l'atelier (`atelier/ouvrir/<atelierId>`). Sans ICP ou sans module Atelier : message et lien vers l'Atelier.

## Non-objectifs

Pas d'édition d'ICP ici, pas de lecture multi-instances, pas de nouvelle route serveur.
