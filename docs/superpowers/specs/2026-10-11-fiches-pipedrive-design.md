# Fiches détaillées à la Pipedrive (chantier 1) — design

Date : 11 octobre 2026. Chantier 1 de la proposition « Pipedrive » acceptée par Marc (« fais les
chantiers dans l'ordre »).

## Objectif

Affaires, contacts et entreprises s'ouvrent sur une page complète à la Pipedrive : résumé et champs
modifiables à gauche ; zone de saisie Note / Activité et historique à droite. Une affaire montre
en plus la barre d'étapes (jours passés dans chacune) et les boutons Gagnée / Perdue. Tout ce qui
existe dans HubSpot y est écrit (double verrou inchangé).

## Décisions

- Responsable (avatar, filtre) : hors chantier 1, faute de réponse de Marc et du droit
  `crm.objects.owners.read` sur la clé.
- Notes HubSpot : droits contacts déjà présents sur la clé (`crm.objects.contacts.read/write`).
- Graphisme : disposition et densité de Pipedrive, couleurs et identité SIMATIS.
- Les panneaux latéraux actuels (`Fiches.tsx`) sont remplacés par la page.

## Données

- `activites` (historique) : ajout de `opportunite_id`, `entreprise_id` (nullable, références),
  `titre` (texte). Types : `note`, `appel`, `email`, `reunion`. Une note de l'OS est `source natif`
  ou, écrite dans HubSpot, `source hubspot`.
- Copie HubSpot : notes (`hs_note_body`, `hs_timestamp`), appels (`hs_call_title`,
  `hs_call_body`, `hs_timestamp`), emails (`hs_email_subject`, `hs_timestamp`), réunions
  (`hs_meeting_title`, `hs_meeting_start_time`) avec leurs liens vers contact, entreprise et
  affaire (première association). Corps tronqué à 2 000 caractères, HTML retiré.
- `opportunites.etapes_dates` (jsonb `{ [etapeId]: iso }`) : propriétés HubSpot
  `hs_date_entered_<etapeId>` de chaque étape connue ; affaires de l'OS : date de création pour
  l'étape courante, puis chaque changement d'étape fait dans l'OS.
- `Etape.probabilite` (0–100) lue dans les métadonnées des étapes HubSpot.

## Écritures HubSpot

- `deal.update { opportuniteId, titre?, montant?, echeance? }` → `dealname`, `amount`,
  `closedate` (champs exclus jamais envoyés).
- `deal.associer { opportuniteId, contactId?, entrepriseId? }` → association v4 par défaut
  (remplace le lien principal).
- `company.update { entrepriseId, nom?, ville?, domaine?, taille? }` → `name`, `city`, `domain`,
  `numberofemployees`.
- `contact.update` : ajout de `nom` (`firstname`/`lastname`) et `entrepriseId` (association).
- `note.create { corps, contactId?, entrepriseId?, opportuniteId? }` → `POST /crm/v3/objects/notes`
  avec `hs_note_body`, `hs_timestamp` et les associations (note → contact 202, → entreprise 190,
  → affaire 214).

## API

- `GET /api/i/:slug/fiches/:kind/:id` (`kind` = `affaire` | `contact` | `entreprise`) →
  `{ fiche, liens, aVenir: TacheVue[], historique: Evenement[], etapes?, ecrit }`.
  `Evenement = { id, type: 'note'|'appel'|'email'|'reunion'|'activite'|'etape', titre, texte, at,
  origine }` (activités faites et changements d'étape du journal inclus), trié du plus récent.
- `PATCH /api/i/:slug/fiches/:kind/:id` : champs modifiables du type de fiche.
- `POST /api/i/:slug/fiches/:kind/:id/notes { corps, hubspot? }` (case « Aussi dans HubSpot »
  cochée par défaut quand la fiche vient de HubSpot).
- Changement d'étape, Gagnée / Perdue : routes existantes (`changeOpportunite`).

## Écran `web/src/pages/Fiche.tsx`

- Route `#/<slug>/fiche/<kind>/<id>` ; ouverte depuis Pipeline, Entreprises, Contacts, Tâches
  (contact et affaire d'une activité). Bouton retour.
- En-tête : titre ; affaire : valeur, entreprise · contact, boutons Gagnée / Perdue (motif
  demandé pour Perdue) ; barre d'étapes cliquable avec « N j » sous chaque étape franchie.
- Colonne gauche : blocs Résumé, Détails (crayon par champ, Entrée enregistre, Échap annule),
  Personne / Organisation liées (avec changement par recherche), Affaires liées (contact,
  entreprise), Contacts (entreprise).
- Colonne droite : onglets Note | Activité (Activité ouvre la fenêtre d'activité pré-liée) ;
  « À venir » (activités ouvertes) ; « Historique » avec filtres Tout / Notes / Activités /
  Appels / Emails.
- Simulation : message habituel, rien ne change.

## Tests

- Copie HubSpot : notes, appels, emails, réunions et leurs liens ; corps tronqué sans HTML ;
  `etapes_dates` ; probabilité des étapes.
- Écritures : `deal.update`, `company.update`, `contact.update` (nom, entreprise),
  `deal.associer`, `note.create` (propriétés et associations exactes) ; simulation sans requête.
- Service : fiche d'affaire (à venir, historique trié, jours par étape), validation, cloisonnement.
- Écran : modification sur place, note OS et HubSpot, barre d'étapes, Gagnée / Perdue,
  ouverture depuis le Pipeline.

## Hors périmètre (chantiers suivants)

Valeur pondérée et création d'affaire (chantier 2), listes tableur (3), liste d'activités en
tableau (4), recherche globale (5), modification ou suppression de notes, pièces jointes.
