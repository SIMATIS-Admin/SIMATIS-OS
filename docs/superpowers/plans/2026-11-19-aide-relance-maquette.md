# Maquette de l'aide à la relance : plan

> Plan court : la livraison est un seul fichier de maquette statique, sans code applicatif ni test unitaire. La vérification se fait dans le navigateur.

**Goal :** valider l'écran « À faire maintenant » du Cockpit avec Marc.

**Spec :** `docs/superpowers/specs/2026-11-19-aide-relance-design.md`

## Contraintes globales

- Données fictives uniquement (dépôt public) ; rien n'est envoyé ni enregistré, hors le choix du nombre d'actions (navigateur).
- Même feuille de style et même coquille que `maquettes/devis.html`.
- Français ; salutation au prénom seul ; 3 créneaux dans chaque mail.

## Tâche unique : `maquettes/aide-relance.html`

- [ ] Coquille (menu, bandeau « Maquette », Cockpit actif) et données fictives (une quinzaine d'actions, sources `retard`, `radar`, `dormante`, dont une entreprise à plusieurs raisons).
- [ ] File triée : retard, puis affaire dormante la plus avancée, puis signal Radar le plus récent ; fusion par entreprise.
- [ ] Sélecteur 5 / 10 / 15 / Tout (retenu dans le navigateur), compteur « faites », filtre par source, ligne « N autres en attente ».
- [ ] Volet d'action : mail (objet, texte modifiable, 3 créneaux choisis) ou fiche d'appel (contexte, dernier échange, objectif, ouverture, résultat).
- [ ] Boutons Brouillon Gmail / Fait / Plus tard / Pas pertinent ; après « Fait », suite proposée ; la ligne disparaît et la liste se complète.
- [ ] Vérifier dans le navigateur (sélecteur, un mail, un appel, liste vide, mobile) puis commit.
