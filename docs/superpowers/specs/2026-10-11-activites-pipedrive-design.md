# Activités à la Pipedrive — design

Date : 11 octobre 2026. Validé en conversation avec Marc.

## Objectif

La rubrique Tâches fonctionne comme les activités de Pipedrive : un objet unique (l'activité),
des types choisis d'un clic, une heure facultative, la proposition systématique de l'étape
suivante, une liste filtrable par type et par période, un compteur dans le menu, et un pipeline
qui signale les opportunités sans prochaine activité ou inactives. HubSpot reste la référence
pour ce qu'il connaît.

## Ce que Marc a dit

- « Je veux que ma rubrique tâches fonctionne exactement comme sur Pipedrive. »
- Calendrier : les deux vues, au choix (grille horaire Jour / Semaine, et la vue actuelle par
  jours et par type).
- Types : choix manuel d'un clic, pré-sélectionné d'après l'intitulé.
- Design présenté en conversation (trois livraisons) : accepté.

## Contraintes

- Une tâche HubSpot ne connaît que intitulé, notes, date et heure (`hs_timestamp`), type
  (`CALL`, `EMAIL`, `TODO`) et statut. Durée, occupé / libre et le type exact (Réunion,
  Échéance, Déjeuner) restent dans l'OS.
- Écritures HubSpot : double verrou existant et sens « Dans les deux sens ».
- Le champ `taches.canal` (`email` / `appel` / `tache`) reste : Brief, routines, MCP et
  propositions s'en servent. Le nouveau type le détermine.

## Modèle

- `taches.type` (texte, non nul) : `appel | email | tache | reunion | echeance | dejeuner`.
  Migration : `type = canal` pour les lignes existantes (`tache` reste `tache`).
- `canal` dérivé du type : `appel → appel`, `email → email`, autres `→ tache`.
- `taches.avec_heure` (booléen, défaut faux) : l'activité a une heure précise. Copie HubSpot :
  faux à la création ; une fois mis à vrai dans l'OS, la synchronisation ne le remet pas à faux.
- `taches.duree_minutes` (entier, nullable) et `taches.occupe` (booléen, défaut faux) : OS seul.
- Type d'une tâche HubSpot à la copie : `typeTache(titre, hs_task_type)` comme aujourd'hui pour la
  création ; un type choisi dans l'OS (`type_choisi` booléen, défaut faux) n'est plus écrasé par
  la synchronisation.
- Vers HubSpot : `hs_task_type` = `CALL` (appel), `EMAIL` (email), `TODO` (autres).
- `opportunites.derniere_activite` (timestamptz, nullable) : propriété HubSpot
  `notes_last_updated` (« date de dernière activité ») à la copie ; mise à `now()` quand une
  activité liée est marquée faite dans l'OS.
- `preferences.options` (jsonb, défaut `{}`) : `{ ensuite: boolean }` (défaut vrai).
- Réglage d'instance `inactiviteJours` (défaut 14) dans les réglages de pipeline.

## Livraison 1 — Activités, « Et ensuite ? », liste, pastille

- Fenêtre d'activité : intitulé ; rangée d'icônes de type (6) pré-sélectionnée d'après
  l'intitulé tant que Marc n'a pas cliqué un type ; date ; case « Heure précise » qui montre
  heure, durée (15 min à 8 h) et occupé / libre ; notes ; faite ; liens contact et opportunité
  (recherche) ; « Créer aussi dans HubSpot » (création seulement, décochée par défaut).
- « Et ensuite ? » : après « faite » (case de la liste, bouton de la fenêtre, colonne En retard),
  fenêtre pré-remplie (même type, même contact et opportunité, intitulé vide, date dans 7 jours,
  sans heure) ; boutons Planifier / Pas maintenant ; case « Ne plus me proposer » (enregistre
  `ensuite: false`). Rien n'est proposé quand l'opportunité liée est close.
- Liste : boutons-icônes par type (actif / inactif, « Tous ») ; périodes En retard, Aujourd'hui,
  Demain, Cette semaine, Semaine prochaine, Plage (du / au) ; À faire / Faites ; origine.
  La période est indépendante de la semaine affichée en vue calendrier.
- Pastille rouge sur « Tâches » dans le menu : activités non faites en retard ou du jour
  (heure de Paris), rafraîchie à chaque chargement d'écran et toutes les 5 minutes.
- Brief : compteurs Email / Téléphone / Action inchangés (Réunion, Échéance, Déjeuner → Action).

## Livraison 2 — Vue Calendrier en grille horaire

- Bascule : Jour · Semaine (grille) · Par jour (vue actuelle) · Liste.
- Grille de 7 h à 21 h, créneaux de 30 minutes ; activités `avec_heure` sur leur durée (30 min
  par défaut), côte à côte quand elles se chevauchent ; rendez-vous Google en fond.
- Bande « Journée » en haut de chaque jour : nombre d'activités sans heure (« 12 activités »),
  qui s'ouvre en liste au clic.
- Glisser une activité sur un créneau : heure précise, `avec_heure` vrai ; sur la bande Journée :
  sans heure (l'heure HubSpot est conservée, `avec_heure` faux).
- Barre de semaine, navigation clavier et colonne En retard : inchangées.

## Livraison 3 — Pipeline

- Icône d'état sur chaque carte d'opportunité ouverte : prochaine activité planifiée (verte,
  avec sa date), en retard (rouge), aucune activité prévue (alerte jaune).
- Inactivité : jours depuis `derniere_activite` (à défaut, création de l'opportunité dans
  l'OS) ; au-delà de `inactiviteJours`, carte bordée de rouge avec « 18 j sans activité ».
- Paramètres : réglage « Opportunité inactive après N jours » (1 à 90).

## Tests

- Migration : `type` repris de `canal` ; `avec_heure` faux.
- `typeTache` étendu : déjeuner, réunion, échéance reconnus (« Déjeuner avec… », « RDV »,
  « Réunion », « Échéance », « Date limite ») ; type choisi conservé par la synchronisation.
- Écriture HubSpot : `hs_task_type` selon le type ; durée et occupé jamais envoyés.
- « Et ensuite ? » : proposé après faite, pré-rempli, non proposé si `ensuite` faux ou
  opportunité close ; « Ne plus me proposer » enregistré.
- Liste : filtres type et périodes (dont Demain et Semaine prochaine à cheval sur deux mois).
- Pastille : compte retard + aujourd'hui, pas les faites ni demain.
- Grille : placement et chevauchement, bande Journée, glisser vers créneau et vers Journée.
- Pipeline : trois états d'icône ; inactivité selon le réglage ; `derniere_activite` mise à
  jour par une activité faite.

## Hors périmètre

- Créer ou modifier un rendez-vous Google depuis l'OS (une Réunion reste dans l'OS).
- Invités, types personnalisables, objectifs d'activité, rappels et notifications.
