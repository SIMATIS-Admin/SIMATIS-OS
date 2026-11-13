# Section Détecter — design (chantier 2 sur 3)

Suite de `2026-11-13-menu-cockpit-design.md`. Même direction graphique : charte actuelle, icônes sobres du jeu existant, aucun emoji. Aucune fonction réécrite : les écrans existants sont réorganisés.

## Intention

Marc trouve que la page Radar empile tout (recherche selon l'ICP, réglage de séquence, boutons, pipe) sans logique d'usage. Le Radar doit redevenir le pipeline de détection ; la recherche, les campagnes et la base ont chacune leur rubrique.

## Organisation décidée par Marc

Détecter, dans cet ordre : **Radar, Recherches, ICP, Campagnes, Base des suspects**.

- **Radar** : le suivi seul, du suspect au rendez-vous (cinq étapes), un bandeau de chiffres, un lien « Voir la base ». Il perd la recherche selon l'ICP et le réglage de séquence.
- **Recherches** (nouvel écran `recherches`) : trois entrées à icônes — Selon mon ICP (le panneau existant, déplacé du Radar), Recherche libre (annuaire des entreprises, recherche de contacts, recherche quotidienne), Importer une liste. Les trois derniers ouvrent les fenêtres existantes de la base (`bases/ouvrir/entreprises|recherche|routine-recherche|import`). Lien « Voir la base ».
- **ICP** : inchangé (« Bientôt », chantier 3).
- **Campagnes** : l'écran Prospection, avec en plus le réglage de la séquence de relance (déplacé du Radar). Lien « Voir la base ».
- **Base des suspects** : l'écran Bases vivantes, entrée à part en bas de Détecter ; la table complète des entreprises et contacts. Elle ne garde plus les deux panneaux « Trouver de nouveaux prospects » et « Importer vos contacts » (devenus Recherches). Accessible depuis Radar, Recherches et Campagnes.

## Non-objectifs

Pas d'écran ICP ni de choix d'instance ici (chantier 3). Pas de changement des adresses existantes (`bases`, `prospection`, `radar`).

## Approche

Réorganiser en déplaçant les composants existants (RechercheStrategie, SequenceReglage) et en ouvrant les fenêtres de la base par l'adresse. Écarté : réécrire la base en composants neufs (risque de régression sur 1 000 lignes, hors demande).

## À la charge du constructeur

Détails visuels des trois cartes, textes d'aide, tests adaptés (les tests de la base qui cliquaient sur les deux panneaux ouvrent désormais les fenêtres par l'adresse).
