# Emails multiples, création en pop-up, diagnostics liés aux fiches

Date : 2026-10-26. Statut : à relire par Marc.

## Besoin

Trois demandes de Marc, pour l'instance SIMATIS (Mon activité) :

1. Un diagnostic est une activité à part entière : il doit être lié à une organisation et à un contact, et se retrouver dans leurs fiches.
2. Depuis un rendez-vous, « + Ajouter » ne permet que de lier un élément existant. Il faut pouvoir **créer** une organisation ou un contact dans une fenêtre pop-up, sans changer de section.
3. Un contact doit pouvoir avoir **plusieurs adresses email**.

Décisions de Marc : un diagnostic se lie à **un seul** contact (le principal) ; le travail se fait en 3 lots, dans l'ordre ci-dessous.

## État actuel (constaté dans le code)

- `diagnostic_projets.entreprise_id` existe, facultatif (`src/diagnostic/schema.ts`). `createProjet` l'accepte, mais le formulaire « Nouveau projet » (`web/src/pages/Diagnostic.tsx`, `ListeProjets`) n'envoie qu'un nom libre. Aucun contact n'est lié. Les fiches organisation et contact ne montrent pas les diagnostics.
- Fiche RDV (`web/src/pages/FicheRdv.tsx`) : le bouton « + Ajouter » ouvre `LierExistant` (recherche d'un élément existant).
- L'API de création existe déjà : `createContact` et `createEntreprise` (`src/crm/service.ts`, `web/src/api.ts`), avec le paramètre `lierA`. Elle passe par `createInCrm` (dry-run par défaut, double verrou pour une écriture réelle vers un CRM tiers) : le pop-up réutilise cette voie et n'en crée pas une seconde.
- `contacts.email` : une seule adresse, lue à une dizaine d'endroits (`crm/service.ts`, `conversion/rdv.ts`, `inbox/outils-mcp.ts`, `routines/outils-mcp.ts`, `base-vivante/*`, `connecteurs/hubspot/sync.ts`).

## Lot 1 : emails multiples

**Modèle.** Nouvelle table `contact_emails` : `id`, colonnes `metierColumns()`, `contact_id` (cascade), `email` (minuscules, nettoyé), `principal` (booléen). Index unique `(instance_id, contact_id, email)` ; au plus une adresse principale par contact (index unique partiel sur `principal`). RLS d'instance comme les autres tables.

**`contacts.email` reste.** C'est l'adresse principale, recopiée par le service à chaque changement. Ainsi la synchro HubSpot, le mapping et tout ce qui lit `contacts.email` continuent de marcher sans modification. Les adresses secondaires vivent dans l'OS seulement (non poussées vers HubSpot : hors périmètre).

**Migration.** Copie chaque `contacts.email` non vide dans `contact_emails` comme principale. Réversible : `contacts.email` n'est jamais supprimée.

**Service.** Dans `src/crm/` : `ajouterEmail`, `retirerEmail`, `definirEmailPrincipal`. Règles : adresse valide et unique pour ce contact ; retirer la principale promeut la plus ancienne restante, ou vide `contacts.email` s'il n'en reste aucune ; retirer la dernière est permis.

**Recherche par adresse.** Helper unique `contactsParEmails(tx, emails)` qui cherche dans `contact_emails`. Il remplace les `lower(contacts.email) = …` de `conversion/rdv.ts` (participants d'un RDV), `inbox/outils-mcp.ts`, `routines/outils-mcp.ts`, `base-vivante/vers-crm.ts` et `historique.ts`, et la recherche texte de `crm/service.ts`. Un participant dont l'adresse est une secondaire retrouve donc bien son contact.

**Interface.** Fiche contact : bloc « Adresses email » (liste, badge Principale, ajouter, retirer, choisir la principale). La fiche expose `emails: {email, principal}[]` en plus de `email`.

**Fusion de contacts** (`crm/fusion.ts`) : les adresses du contact absorbé passent au contact gardé (doublons ignorés, principale conservée).

## Lot 2 : création en pop-up

Composant `CreerFiche` (`web/src/pages/liens/`), basé sur `Modal` (`Overlay.tsx`) :

- **Contact** : nom (obligatoire), fonction, email, organisation (recherche + choix, ou « créer une organisation » en ouvrant le même pop-up pour l'organisation, un seul niveau).
- **Organisation** : nom (obligatoire), ville, secteur.
- À la validation : `createContact` / `createEntreprise` avec `lierA` = le RDV ; la fiche RDV se recharge, l'élément est lié, et l'utilisateur n'a pas quitté la page.
- Point d'entrée : bouton « Créer » à côté de la recherche dans `LierExistant` (donc partout où `LierExistant` sert : fiche RDV, cartes de liens des fiches). Le texte déjà tapé dans la recherche préremplit le nom.
- Si la création passe en simulation (dry-run CRM) ou renvoie un avertissement, le message est affiché dans le pop-up et rien n'est lié.
- Doublon probable (même nom ou même email) : le pop-up propose l'existant avant de créer (réutilise l'`avertissement` renvoyé par l'API).

## Lot 3 : diagnostics liés aux fiches

- `diagnostic_projets` gagne `contact_id` (facultatif, `set null` à la suppression, index). `entreprise_id` existe déjà.
- Formulaire « Nouveau projet » : choisir une organisation existante (recherche) ou la créer par le pop-up du lot 2 ; choisir un contact de cette organisation ou le créer. Le nom du projet reprend le nom de l'organisation par défaut. Projets existants sans organisation : inchangés, et le rapprochement actuel (`rapprochement.ts`) reste valable.
- La fiche du projet affiche l'organisation et le contact liés (liens vers leurs fiches) et permet de les changer.
- Fiches organisation et contact : bloc « Diagnostics » (nom, étape, date) qui ouvre le projet. Chargé via `fiches.ts`.
- Suppression et fusion de fiches (`suppression.ts`, `fusion.ts`) : la fusion de deux organisations ou contacts déplace les diagnostics vers la fiche gardée ; la suppression détache (les colonnes passent à `null`), jamais de perte du projet.

## Hors périmètre

Envoi des adresses secondaires vers HubSpot ; plusieurs contacts par diagnostic ; refonte de la section Diagnostics ; onglets Rendez-vous/Email des fiches.

## Tests

Chaque lot arrive avec ses tests (service et routes sur base de test, composants avec Testing Library), puis `npm run verify` et une vérification dans le navigateur. Données fictives uniquement.

## Risques

- Les lectures de `contacts.email` oubliées : on garde la colonne comme principale pour que l'oubli ne casse rien, seulement la recherche par adresse secondaire. Un test par point d'usage listé.
- Migration : ajout de table seulement, sans suppression de colonne.
- Travail en cours d'une autre session sur `feature/transfert-instance` : ce travail démarre d'un `origin/main` à jour sur sa propre branche, après son commit.
