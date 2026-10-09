# Tâches, type reconnu, Brief et Pipeline — design

Date : 9 octobre 2026. Validé en conversation avec Marc.

## Objectif

Marc gère toutes ses tâches depuis l'OS, sans ouvrir HubSpot : celles de HubSpot et celles qu'il
crée pour lui seul. Il les voit sur sa semaine, à côté de ses rendez-vous, et en liste. Le Brief
du jour lui rappelle ses rendez-vous et le nombre de tâches par type.

## Ce que Marc a dit

- Le Pipeline doit fonctionner en glisser-déposer pour changer l'étape des opportunités.
- Une rubrique Tâches, avec une vue calendrier de la semaine et une vue liste.
- Deux sortes de tâches : celles de HubSpot, et celles créées dans l'OS.
- Les tâches de l'OS ne sont pas envoyées à HubSpot, sauf si Marc le demande à la création
  (case « Créer aussi dans HubSpot », décochée par défaut).
- Sur une tâche HubSpot, Marc modifie depuis l'OS : faite / à faire, échéance, intitulé, notes.
  Ces modifications sont écrites dans HubSpot.
- Le Brief du jour rappelle les rendez-vous du jour et le nombre de tâches Email / Téléphone /
  Action.
- Le type (Email / Téléphone / Action) est reconnu d'après l'intitulé.
- Le calendrier montre les tâches et, en fond, les rendez-vous Google Agenda.

## Hypothèses (à corriger si fausses)

- Le type n'est pas modifiable à la main : il découle de l'intitulé (et du type HubSpot à défaut).
- Les écritures vers HubSpot gardent le double verrou existant (`REAL_WRITES=on` et
  `instance:ecritures --on`) et le sens « Dans les deux sens ». Verrou fermé : la modification
  d'une tâche HubSpot est simulée, notée au journal, et la copie locale ne change pas (HubSpot
  fait foi). Les tâches de l'OS se modifient toujours librement.
- Semaine affichée : lundi → vendredi, plus une colonne « Week-end » réduite.

## Ce qui existe déjà

- Pipeline : le glisser-déposer est codé (`web/src/pages/Pipeline.tsx`) mais désactivé quand la
  connexion CRM est en lecture seule (`ecrit = sens === 'deux_sens'`, `src/crm/pipeline.ts`).
- Brief : rendez-vous du jour lus dans Google Agenda (`src/pilotage/brief.ts`) quand l'agenda
  est branché ; compteurs par canal `email`, `appel`, `tache` (« Autres »).
- Écritures HubSpot : `task.create` et `task.complete` (`src/connecteurs/hubspot/write.ts`).
- Table `taches` : `titre`, `canal`, `echeance`, `faitAt`, `contactId`, `opportuniteId`,
  `source` (`natif` ou `hubspot`).

## Livraison 1 — Pipeline et Brief (petite)

- Pipeline en lecture seule : un bandeau explique que les cartes ne se déplacent pas tant que
  la synchronisation HubSpot est en lecture seule, avec un lien vers Paramètres > Connexions.
- Brief : le libellé « Autres » devient « Action » ; « Appels » devient « Téléphone » (compteurs,
  filtres, infobulle).
- Tests : bandeau affiché si `ecrit` est faux, absent sinon ; libellés du Brief.

## Livraison 2 — Type reconnu et rubrique Tâches

### Type reconnu d'après l'intitulé

- Nouveau module `src/crm/type-tache.ts` : `typeTache(titre, typeHubspot?) → 'email' | 'appel' | 'tache'`.
  - L'intitulé prime quand il contient un mot reconnu, sans tenir compte des accents ni de la
    casse, en mot entier :
    - Téléphone : appeler, rappeler, appel, tel, tél, téléphone, téléphoner, call ;
    - Email : mail, email, e-mail, courriel, envoyer, envoi.
  - Sinon le type HubSpot (`EMAIL` → email, `CALL` → appel).
  - Sinon `tache` (affiché « Action »).
  - Si l'intitulé contient des mots des deux familles, Téléphone l'emporte (« Appeler pour
    envoyer le devis » est un appel).
- Utilisé par `mapTask` (copie HubSpot) et à chaque création ou modification d'intitulé dans
  l'OS. Le type est stocké dans `taches.canal` : Brief et filtres n'ont rien à recalculer.
- Une première synchronisation complète après la mise à jour reclasse les tâches existantes
  (la migration remet `derniere_synchro` à vide pour les connexions CRM HubSpot).

### Données

- Migration : colonne `taches.notes text` (nullable).
- Copie HubSpot : `hs_task_body` lu et rangé dans `notes`.

### Écritures HubSpot

- Nouvelle opération `task.update` : `{ tacheId, titre?, notes?, echeance?, fait? }` →
  `PATCH /crm/v3/objects/tasks/:id` avec `hs_task_subject`, `hs_task_body`, `hs_timestamp`,
  `hs_task_status` (`COMPLETED` / `NOT_STARTED`). Seuls les champs fournis sont envoyés.
- Écriture réelle réussie : la copie locale est mise à jour aussitôt (titre, notes, échéance,
  `faitAt`, type recalculé).
- `task.create` : ajoute `hs_task_body` et `hs_timestamp` s'ils sont fournis.

### Service `src/crm/taches.ts`

- `listTaches(db, instance, { du, au, statut?, canal?, origine? })` : tâches de la période, plus
  les tâches en retard non faites ; avec contact et opportunité liés (id, nom).
- `createTache(db, instance, input, deps)` : `input.hubspot` faux → tâche `natif` ; vrai →
  `task.create` via `writeVia`, puis copie locale (même schéma que `createEntreprise`). Refusé
  si aucun CRM HubSpot n'est branché.
- `updateTache(db, instance, id, patch, deps)` : tâche `natif` → mise à jour directe ; tâche
  `hubspot` → `task.update` via `writeVia` (simulée verrou fermé). Journalisé dans les deux cas.
- Les rendez-vous de la semaine : réutilise `evenements()` de l'agenda de l'instance ; agenda
  absent ou en erreur → liste vide et état renvoyé (comme le Brief).

### API

- `GET /api/i/:slug/taches?du=YYYY-MM-DD&au=YYYY-MM-DD` → `{ taches, enRetard, rdv, rdvEtat, ecrit }`.
- `POST /api/i/:slug/taches` → création (`titre` obligatoire, `notes`, `echeance`, `contactId`,
  `opportuniteId`, `hubspot` booléen).
- `PATCH /api/i/:slug/taches/:id` → modification (`titre`, `notes`, `echeance`, `fait`).
  Réponse `{ simulation: true }` quand l'écriture HubSpot a été simulée.

### Écran Tâches (`web/src/pages/Taches.tsx`)

- Entrée « Tâches » dans le menu, groupe Convertir, après Contacts ; ajoutée à `BUILT`.
- Bascule Semaine / Liste, navigation semaine précédente / suivante / aujourd'hui.
- **Semaine** : colonnes lundi → vendredi + Week-end ; grille de 8 h à 20 h ; tâches placées à
  leur heure (tâche sans heure ou à minuit : en haut de la colonne) ; rendez-vous en blocs gris
  non cliquables ; bloc « En retard » au-dessus. Glisser une tâche sur un autre créneau change
  son échéance (créneaux de 30 minutes).
- **Liste** : triée par échéance ; filtres type, statut (à faire / faites), origine (HubSpot /
  OS) ; case pour marquer faite.
- Pastille de type (Email / Téléphone / Action) et pastille d'origine (HubSpot / OS).
- Clic sur une tâche : panneau d'édition (intitulé, notes, échéance, faite, liens).
- « Nouvelle tâche » : intitulé, notes, échéance, contact ou opportunité, case « Créer aussi
  dans HubSpot » décochée par défaut (masquée sans CRM HubSpot).
- Écriture simulée : message « Simulation : rien n'a été écrit dans HubSpot (écritures réelles
  désactivées) ».

## Tests

- `type-tache` : chaque famille de mots, accents et casse, mot entier (« appellation » n'est pas
  un appel), priorité Téléphone, repli sur le type HubSpot, défaut Action.
- Copie HubSpot : `notes` lues, type recalculé d'après l'intitulé.
- `task.update` avec le faux portail : seuls les champs fournis partent ; statut faite / à faire ;
  copie locale mise à jour après écriture réelle ; aucune requête et copie inchangée en simulation.
- `createTache` : case décochée → tâche `natif`, aucune requête HubSpot ; cochée → `POST` puis
  copie `hubspot` ; cochée sans CRM → refus.
- `updateTache` sur une tâche `natif` : jamais de requête HubSpot.
- API : validation (titre vide refusé, date invalide refusée), cloisonnement par instance.
- Écran : bascule Semaine / Liste, création avec et sans la case, marquer faite, message de
  simulation, glisser une tâche vers un autre jour envoie la nouvelle échéance.

## Hors périmètre

- Modifier le type à la main, tâches récurrentes, rappels et notifications.
- Envoyer les tâches de l'OS vers HubSpot après coup.
- Créer ou déplacer des rendez-vous Google depuis le calendrier.
- Suppression de tâches (aucune suppression n'est écrite dans HubSpot).
