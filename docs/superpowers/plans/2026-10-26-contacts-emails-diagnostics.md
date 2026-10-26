# Plan : emails multiples, création en pop-up, diagnostics liés

Spec : `docs/superpowers/specs/2026-10-26-contacts-emails-diagnostics-design.md`.

**Avant de commencer.** Attendre que l'autre session ait commité `feature/transfert-instance` (arbre propre). Puis : `git fetch`, `git switch -c feature/contacts-emails origin/main`. Node : `/opt/homebrew/opt/node@24/bin`. Un lot = une branche = une PR (revue par l'agent, CI verte, merge, rebuild de l'app depuis `origin/main`). Avant chaque commit : relire `git diff --staged` (aucune donnée réelle), ajouter les fichiers explicitement. Tests écrits avant ou avec le code.

## Lot 1 : emails multiples (`feature/contacts-emails`)

1. **Schéma et migration.** Ajouter `contactEmails` dans `src/crm/schema.ts` (voir spec), `npx drizzle-kit generate`, y ajouter la copie `insert … select` des `contacts.email` non vides comme principales. Test de migration dans le style de `migrate.test.ts` : un contact avec email obtient une ligne principale.
2. **Service.** Nouveau `src/crm/emails.ts` : `ajouterEmail`, `retirerEmail`, `definirEmailPrincipal`, `contactsParEmails`. Tests `emails.test.ts` : adresse invalide, doublon, majuscules, promotion à la suppression de la principale, dernière adresse retirée, isolation d'instance.
3. **Création et mise à jour d'un contact.** `createContact` et le patch de `fiches.ts` (champ `email`) passent par le service : `contacts.email` et la ligne principale restent synchronisées. Tests dans `service.test.ts` et `fiches.test.ts`.
4. **Recherche par adresse.** Remplacer les comparaisons `lower(contacts.email)` par `contactsParEmails` dans `conversion/rdv.ts`, `inbox/outils-mcp.ts`, `routines/outils-mcp.ts`, `base-vivante/vers-crm.ts`, `base-vivante/historique.ts`, et la recherche texte de `crm/service.ts`. Un test par fichier : un participant ou un mail venant d'une adresse secondaire retrouve son contact.
5. **Fusion.** `crm/fusion.ts` : déplacer les adresses vers le contact gardé. Test dans `fusion.test.ts`.
6. **Routes.** `POST/DELETE /contacts/:id/emails`, `PUT …/principal` dans `src/api/routes.ts` ; la fiche contact renvoie `emails`. Tests de routes.
7. **Interface.** Bloc « Adresses email » dans la fiche contact (`web/src/pages/Fiche.tsx`) et fonctions dans `web/src/api.ts`. Tests dans `Fiche.test.tsx`.
8. **Vérification.** `npm run verify`, test dans le navigateur (ajouter, promouvoir, retirer une adresse). PR, revue, CI, merge, rebuild.

## Lot 2 : création en pop-up (`feature/creation-popup`, depuis `main` à jour)

1. **Composant.** `web/src/pages/liens/CreerFiche.tsx` (contact ou organisation, `Modal`, champs de la spec, création d'organisation imbriquée sur un niveau). Tests `CreerFiche.test.tsx` : validation du nom, appel de `createContact`/`createEntreprise` avec `lierA`, message de simulation ou d'avertissement, proposition de l'existant en cas de doublon.
2. **Branchement.** Bouton « Créer » dans `LierExistant` (`CarteLiens.tsx`), préremplissage depuis la recherche, rechargement après création. Tests dans `CarteLiens.test.tsx` et `FicheRdv.test.tsx` : depuis un RDV, créer un contact le lie sans changer d'URL.
3. **Serveur.** Vérifier que `lierA` accepte un RDV pour contact et organisation (`liens.ts`, `rdv-liens.ts`) ; combler avec un test si ce n'est pas le cas.
4. **Vérification.** `npm run verify`, test navigateur sur un RDV de démonstration. PR, revue, CI, merge, rebuild.

## Lot 3 : diagnostics liés (`feature/diagnostics-fiches`, depuis `main` à jour)

1. **Schéma.** `contact_id` sur `diagnostic_projets` (facultatif, `set null`, index), migration. Test de migration.
2. **Service diagnostic.** `createProjet` et `updateProjet` acceptent `contactId` (contrôle d'instance, comme `entrepriseId`). Tests `service.test.ts` et `api.test.ts`.
3. **Fiches.** `crm/fiches.ts` renvoie les diagnostics liés d'une organisation et d'un contact. Tests `fiches.test.ts`.
4. **Fusion et suppression.** `fusion.ts` déplace `entreprise_id`/`contact_id` des diagnostics vers la fiche gardée ; `suppression.ts` détache. Tests dans `fusion.test.ts` et `suppression.test.ts`.
5. **Interface.** Formulaire « Nouveau projet » (organisation et contact : recherche ou création via `CreerFiche`), affichage et changement des liens dans la fiche du projet, bloc « Diagnostics » dans les fiches organisation et contact. Tests `Diagnostic.test.tsx`, `Diagnostics.creation.test.tsx`, `Fiche.test.tsx`.
6. **Vérification.** `npm run verify`, test navigateur : créer un diagnostic avec une nouvelle organisation et un nouveau contact, le retrouver dans les deux fiches. PR, revue, CI, merge, rebuild.

## Fin de chaque lot

Expliquer à Marc, pas à pas et simplement, comment tester dans l'app. Mettre à jour la mémoire d'avancement si besoin. Dire quels processus tournent encore, le cas échéant.
