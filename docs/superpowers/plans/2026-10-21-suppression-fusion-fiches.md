# Suppression et fusion de fiches — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer et fusionner contacts, organisations et affaires (à l'unité ou en masse depuis les listes), avec répercussion dans HubSpot.

**Architecture:** Deux services (`suppression.ts`, `fusion.ts`) dans `src/crm/`, sur le modèle de `liens.ts` : transaction `withInstance`, écriture HubSpot via `writeVia` (simulation = rien en local), puis écriture locale. Deux nouvelles opérations de connecteur (`record.archive`, `record.merge`). Routes sous `/api/i/:slug/fiches/:kind/…`. Interface : sélection existante du composant `Tableau`, enrichie de « Supprimer » et « Fusionner », plus une vue liste des affaires.

**Tech Stack:** TypeScript, Fastify, Drizzle/Postgres (RLS par instance), React, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-suppression-fusion-fiches-design.md`

## Écarts assumés par rapport au spec (à relire)

- Tâches, activités, sujets d'Inbox, rendez-vous liés, tests VMA et diagnostics qui pointent vers la fiche supprimée ou absorbée sont **détachés** (colonne mise à `null`), pas supprimés : on ne perd aucun historique. En fusion, ils sont **repointés** vers la fiche gardée.
- Une affaire qui a un **devis** ou une conversion ne se supprime pas (message clair) ; en fusion, ils passent sur l'affaire gardée.
- Fusion d'une fiche locale (gardée) avec une fiche HubSpot (absorbée) : **refusée** (la fiche HubSpot reviendrait à la synchronisation). Garder la fiche HubSpot, ou fusionner deux fiches du même côté.
- Vue **liste des affaires** à créer dans le pipeline (elle n'existe pas).

## Global Constraints

- Double verrou inchangé : mode réel = `ctx.reel` (variable serveur + interrupteur admin) ; sinon simulation, **aucune** écriture locale (`SimulationFiche`, voir `src/crm/liens.ts`).
- CRM en lecture seule (`sens !== 'deux_sens'`) : `CrmIndisponible` pour toute fiche HubSpot.
- Fusion : même type de fiche uniquement ; HubSpot = `POST /crm/v3/objects/{companies|contacts|deals}/merge` `{primaryObjectId, objectIdToMerge}` (à confirmer dans la doc HubSpot avant l'étape d'implémentation de la Task 2). Archivage = `DELETE /crm/v3/objects/{type}/{id}`.
- Aucune donnée réelle dans le dépôt, tests et démos fictifs. Pas de `git add -A`. Commits co-signés comme d'habitude. Documentation et interface en français.
- Branche : `feature/suppression-fusion` (déjà créée).

## Review Focus

- Suppression d'une fiche déjà absente ou d'une autre instance : 404 / ligne en erreur, pas de plantage ni de fuite inter-instance.
- Suppression en masse avec une fiche en échec au milieu : les autres passent, récapitulatif exact.
- Fusion d'une fiche avec elle-même ou de deux types différents : 400.
- Fusion où les deux fiches sont déjà liées à la même cible : un seul lien reste, le principal reste cohérent avec la colonne miroir.
- Suppression d'une fiche principale d'un lien : le suivant devient principal, colonne miroir à jour.
- Suppression/fusion en simulation : base strictement inchangée.
- Table qui référence une fiche et que la liste du service oublie (future migration) : test de garde-fou sur le catalogue Postgres.

---

### Task 1: Opérations HubSpot `record.archive` et `record.merge`

**Files:**
- Modify: `src/connecteurs/hubspot/write.ts` (nouveaux `case` dans `writeHubspot`)
- Modify: `test/hubspot-portal.ts` (le faux portail répond aux nouvelles routes)
- Test: `src/connecteurs/hubspot/hubspot.test.ts` (ajouter dans le fichier existant, même style que les tests d'écriture déjà présents)

**Interfaces:**
- Produces: `writeVia(tx, instance, 'crm', { op: 'record.archive', data: { kind: Kind, id: string } }, deps)` → `WriteResult` ; `{ op: 'record.merge', data: { kind: Kind, gardeId: string, absorbeId: string } }` → `WriteResult`. `id`/`gardeId`/`absorbeId` sont des ids **locaux** (le connecteur les traduit en ids HubSpot avec `hubspotId`).

- [ ] **Step 1: tests** — `record.archive` d'une entreprise HubSpot envoie `DELETE /crm/v3/objects/companies/<sourceId>` en mode réel ; en simulation n'envoie rien et renvoie `{ simulation: true }` ; `record.merge` de deux contacts envoie `POST /crm/v3/objects/contacts/merge` avec `{ primaryObjectId, objectIdToMerge }` ; fiche locale (`source: 'natif'`) → `EcritureRefusee("Cette fiche n'existe pas dans HubSpot")`.
- [ ] **Step 2: lancer** `npx vitest run src/connecteurs/hubspot/hubspot.test.ts` — attendu : FAIL (« non prise en charge »).
- [ ] **Step 3: implémenter** dans `write.ts` : table de correspondance `lienHubspot(kind)` existante (donne `table` et `objet`). `record.archive` → `DELETE /crm/v3/objects/${objet}/${id}`. `record.merge` → `POST /crm/v3/objects/${objet}/merge`. Ajouter au faux portail `test/hubspot-portal.ts` les réponses `DELETE …/objects/\w+/\w+` (204) et `POST …/objects/\w+/merge` (200 `{id}`), en enregistrant l'appel comme les autres.
- [ ] **Step 4: lancer** le même fichier — attendu : PASS.
- [ ] **Step 5: commit** `feat: opérations HubSpot d'archivage et de fusion`.

---

### Task 2: Service de suppression

**Files:**
- Create: `src/crm/suppression.ts`
- Modify: `src/crm/liens.ts` (exporter `viaHubspot`, `ecrireHubspot`, `SIMULATION` ; élargir le type de `op` de `ecrireHubspot` à `'association.add' | 'association.remove' | 'record.archive' | 'record.merge'`)
- Test: `src/crm/suppression.test.ts` (même squelette que `liens.test.ts` : `setupTestApp`, instances natif/hub/lecture, `fakePortal(demoPortal())`)

**Interfaces:**
- Consumes: `viaHubspot(tx, a, b)`, `ecrireHubspot(tx, instance, op, data, deps)`, `SIMULATION`, `ligne` (à exporter aussi), `Ref`, `assurerLiensPrincipaux`.
- Produces:
  - `export const REFERENCES: { table: string; colonne: string; kind: Kind }[]` — toutes les colonnes qui pointent vers une fiche (hors tables de liaison qui sont en `cascade`) : `taches.{opportunite_id,contact_id,entreprise_id}`, `activites.{…}`, `opportunites.{contact_id,entreprise_id}`, `contacts.entreprise_id`, `rdv_liens.{contact_id,entreprise_id}`, `inbox_sujets.{contact_id,entreprise_id}` (vérifier le nom réel de la table dans `src/inbox/schema.ts`), `vma_tests.entreprise_id`, `diagnostics.entreprise_id`, `devis.opportunite_id`, conversion (`src/conversion/schema.ts`, nom réel de la table).
  - `supprimerFiche(db: Executor, instance: Instance, ref: Ref, deps: ConnexionDeps): Promise<{ ok: true } | SimulationFiche>` — lève `FicheInvalide` (fiche introuvable, ou affaire avec devis/conversion) ou `CrmIndisponible`.

- [ ] **Step 1: tests** (noms) :
  - `supprime une organisation locale : ses liens disparaissent, ses contacts sont détachés (entreprise_id null)`
  - `détache les tâches et activités de la fiche sans les supprimer`
  - `le suivant devient principal quand on supprime le lien principal d'un contact` (colonne miroir `opportunites.contact_id` à jour)
  - `archive dans HubSpot puis supprime en local en mode réel` (appel `DELETE` vu dans `portal.calls`)
  - `simulation : rien n'est supprimé, ni localement ni dans HubSpot` (`realWrites:false` → `{ simulation: true }`, ligne toujours en base)
  - `CRM en lecture seule : refuse une fiche HubSpot` (`CrmIndisponible`)
  - `refuse de supprimer une affaire qui a un devis` (`FicheInvalide`)
  - `fiche d'une autre instance : introuvable` (`FicheInvalide`)
  - `REFERENCES couvre toutes les clés étrangères vers contacts, entreprises et opportunites` : interroge `pg_constraint`/`information_schema` sur le catalogue (`t.owner.pool`) et vérifie que chaque FK non `cascade` vers ces trois tables figure dans `REFERENCES` ou dans une liste d'exceptions explicite du test (tables de liaison).
- [ ] **Step 2: lancer** `npx vitest run src/crm/suppression.test.ts` — attendu : FAIL (module absent).
- [ ] **Step 3: implémenter** `supprimerFiche` : `withInstance` → `ligne()` (sinon `FicheInvalide('Fiche introuvable dans cette instance')`) → si `kind === 'affaire'` et devis/conversion présents, `FicheInvalide` → `viaHubspot(tx, l, l)` ; si vrai, `ecrireHubspot(…, 'record.archive', { kind, id })` et `SIMULATION` si simulation → pour chaque entrée de `REFERENCES` du `kind`, `update … set colonne = null where colonne = id` (SQL brut paramétré via `sql` de drizzle, filtre `instance_id`) → pour les liens primaires : avant de supprimer, mémoriser les propriétaires dont la fiche est cible d'un lien principal, supprimer la fiche (les tables de liaison partent en cascade), puis `assurerLiensPrincipaux(tx, kind, ownerId)` pour chaque propriétaire concerné → `logEvent` (`acteur: 'pilote'`, `niveau: 'L2'`, action « Fiche supprimée : <kind> », **sans nom ni donnée**).
- [ ] **Step 4: lancer** le fichier — attendu : PASS.
- [ ] **Step 5: commit** `feat: suppression de fiches avec archivage HubSpot`.

---

### Task 3: Service de fusion

**Files:**
- Create: `src/crm/fusion.ts`
- Test: `src/crm/fusion.test.ts` (squelette de `liens.test.ts`)

**Interfaces:**
- Consumes: `REFERENCES`, `viaHubspot`, `ecrireHubspot`, `SIMULATION`, `ligne`, `assurerLiensPrincipaux`, `supprimer` (partie locale réutilisable : extraire de `suppression.ts` une `supprimerLocalement(tx, ref)` exportée et l'utiliser aussi dans `supprimerFiche`).
- Produces: `fusionnerFiches(db: Executor, instance: Instance, kind: Kind, gardeId: string, absorbeId: string, deps: ConnexionDeps): Promise<{ ok: true } | SimulationFiche>` — lève `FicheInvalide` (même id, introuvable, garde locale + absorbée HubSpot) ou `CrmIndisponible`.

- [ ] **Step 1: tests** :
  - `les champs vides de la fiche gardée sont complétés, les champs remplis ne sont jamais écrasés` (organisation : ville, domaine, secteur, taille ; contact : fonction, email, téléphone, rôle ; affaire : montant, échéance, motif, origine, potentiel, faisabilité, prochaine_etape)
  - `repointe tâches, activités, sujets d'Inbox et devis vers la fiche gardée`
  - `fusion de deux organisations liées au même contact : un seul lien, un seul principal, colonne miroir cohérente`
  - `les liens de l'absorbée sont transférés quand la gardée ne les a pas`
  - `l'absorbée n'existe plus après la fusion`
  - `HubSpot réel : appel POST merge avec primaryObjectId = garde et objectIdToMerge = absorbée`
  - `simulation : base inchangée`
  - `refuse deux types différents / même fiche / fiche introuvable` (`FicheInvalide`)
  - `refuse garde locale + absorbée HubSpot`, `accepte garde HubSpot + absorbée locale (aucun appel HubSpot)`
- [ ] **Step 2: lancer** `npx vitest run src/crm/fusion.test.ts` — attendu : FAIL.
- [ ] **Step 3: implémenter** : valider → `viaHubspot` si les deux sont HubSpot → `ecrireHubspot('record.merge')` / `SIMULATION` → compléter les champs vides (liste de champs par `kind`, un seul `update`) → repointer chaque `REFERENCES` (`update … set col = garde where col = absorbe`) → tables de liaison : pour chaque `Paire` de `liens.ts` touchant `kind`, déplacer les lignes absorbées dont la paire n'existe pas déjà chez la gardée (mettre `principal = false` sur les déplacées), supprimer les autres → `supprimerLocalement(absorbe)` → `assurerLiensPrincipaux` pour la gardée et pour chaque propriétaire de lien touché → `logEvent` sans donnée métier.
- [ ] **Step 4: lancer** le fichier — attendu : PASS.
- [ ] **Step 5: commit** `feat: fusion de fiches avec fusion HubSpot`.

---

### Task 4: Routes API

**Files:**
- Modify: `src/api/routes.ts` (après les routes de liens, vers la ligne 722)
- Test: `src/api/suppression-fusion.routes.test.ts` (squelette de `liens.routes.test.ts`)

**Interfaces:**
- Consumes: `supprimerFiche`, `fusionnerFiches`, `ficheParams`, `ficheErreur`, `onInstance`, `connexionDeps`.
- Produces :
  - `DELETE /api/i/:slug/fiches/:kind/:id` → `{ ok: true }` | `{ simulation: true, message }` ; 404 fiche introuvable (`FicheInvalide`) ; 409 `CrmIndisponible`.
  - `POST /api/i/:slug/fiches/:kind/supprimer` corps `{ ids: uuid[] }` (1 à 200) → `{ resultats: { id: string; ok: boolean; simulation?: boolean; erreur?: string }[] }`, toujours 200, une erreur par fiche n'interrompt pas le lot.
  - `POST /api/i/:slug/fiches/:kind/:id/fusion` corps `{ absorbeId: uuid }` → `{ ok: true }` | simulation ; 400 `FicheInvalide`, 409 `CrmIndisponible`.

- [ ] **Step 1: tests** : suppression unitaire (200 puis GET 404) ; lot de 3 dont un id inconnu → `resultats` avec 2 `ok` et 1 `erreur` ; fusion de deux contacts (200, absorbé disparu) ; fusion même id → 400 ; kind inconnu → 404 ; corps invalide (`ids: []`, 201 ids) → 400.
- [ ] **Step 2: lancer** `npx vitest run src/api/suppression-fusion.routes.test.ts` — attendu : FAIL (404 routes).
- [ ] **Step 3: implémenter** les trois routes ; le lot appelle `supprimerFiche` séquentiellement et capture les erreurs (message de `FicheInvalide`/`CrmIndisponible`, sinon « Erreur inattendue »). Déclarer `/fiches/:kind/supprimer` avant `/fiches/:kind/:id` n'est pas nécessaire (méthodes différentes) mais vérifier qu'aucune route `POST /fiches/:kind/:id` n'entre en collision.
- [ ] **Step 4: lancer** le fichier — attendu : PASS.
- [ ] **Step 5: commit** `feat: routes de suppression et de fusion de fiches`.

---

### Task 5: Client web et composant de liste

**Files:**
- Modify: `web/src/api.ts` (après `definirPrincipal`)
- Modify: `web/src/pages/listes/Tableau.tsx`
- Test: `web/src/pages/listes/Tableau.test.tsx` (ajouts)

**Interfaces:**
- Produces (api.ts) :
  - `supprimerFiche(slug: string, ref: RefFiche): Promise<{ ok: true } | SimulationTache>`
  - `supprimerFiches(slug: string, kind: RefFiche['kind'], ids: string[]): Promise<{ resultats: { id: string; ok: boolean; simulation?: boolean; erreur?: string }[] }>`
  - `fusionnerFiches(slug: string, kind: RefFiche['kind'], gardeId: string, absorbeId: string): Promise<{ ok: true } | SimulationTache>`
- Produces (Tableau) : props optionnelles `onSupprimer?: (ids: string[]) => Promise<{ ok: number; erreurs: { id: string; erreur: string }[]; simulation: boolean }>` et `onFusionner?: (gardeId: string, absorbeId: string) => Promise<{ simulation: boolean } | void>`.

- [ ] **Step 1: tests** : avec `onSupprimer`, cocher 2 lignes → bouton « Supprimer la sélection » → fenêtre de confirmation « Supprimer 2 fiches ? » → confirmer appelle `onSupprimer` avec les 2 ids, puis affiche le récapitulatif (« 1 supprimée, 1 échec : <raison> ») ; annuler n'appelle rien ; « Fusionner » n'est actif que pour **exactement 2** lignes cochées ; la fenêtre de fusion demande « Quelle fiche garder ? » (deux choix, aucun présélectionné), précise que la fusion est définitive dans HubSpot, et appelle `onFusionner(garde, absorbe)` ; sans les props, les boutons n'apparaissent pas.
- [ ] **Step 2: lancer** `npx vitest run web/src/pages/listes/Tableau.test.tsx` — attendu : FAIL.
- [ ] **Step 3: implémenter** api.ts (`sendJson('DELETE'|'POST', …)` via `fiche(slug, kind, id)` et `inst`) puis, dans `Tableau.tsx`, boutons dans la barre `tb-lot` existante, `Modal` de `../Overlay.js` pour confirmation/choix, récapitulatif affiché dans la barre ; vider la sélection après l'opération.
- [ ] **Step 4: lancer** le fichier — attendu : PASS.
- [ ] **Step 5: commit** `feat: suppression et fusion dans les listes`.

---

### Task 6: Brancher Contacts, Organisations, vue liste des Affaires et boutons de fiche

**Files:**
- Modify: `web/src/pages/Contacts.tsx`, `web/src/pages/Entreprises.tsx` (passer `onSupprimer`/`onFusionner` à `Tableau`, recharger via `setVersion`, afficher le message de simulation comme `modifier`)
- Modify: `web/src/pages/Pipeline.tsx` (nouveau mode `'liste'` à côté de `'board' | 'matrice'`, avec un `Tableau` : colonnes Titre, Organisation, Étape, Montant, Échéance ; `cle="affaires"`)
- Modify: `web/src/pages/Fiche.tsx` (bouton « Supprimer » avec confirmation → retour à la liste ; bouton « Fusionner avec… » avec `SearchBox` pour choisir l'autre fiche du même type)
- Test: `web/src/pages/Crm.test.tsx`, `web/src/pages/Pipeline.test.tsx`, `web/src/pages/Fiche.test.tsx` (ajouts)

**Interfaces:**
- Consumes: `supprimerFiches`, `supprimerFiche`, `fusionnerFiches` (Task 5), props de `Tableau`.

- [ ] **Step 1: tests** : liste de contacts → cocher 2, supprimer → `DELETE`/lot appelé avec `kind: 'contact'` puis liste rechargée ; idem organisations (`entreprise`) ; Pipeline : bascule en mode « Liste », cocher une affaire, supprimer (`affaire`) ; fiche : « Supprimer » demande confirmation, appelle `supprimerFiche`, puis navigue vers la liste ; en simulation, le message « Simulation » s'affiche et la fiche reste.
- [ ] **Step 2: lancer** `npx vitest run web/src/pages` — attendu : FAIL sur les nouveaux tests.
- [ ] **Step 3: implémenter** selon l'interface ci-dessus ; mapper le résultat du lot vers `{ ok, erreurs, simulation }` attendu par `Tableau` (`simulation` si au moins un résultat `simulation`).
- [ ] **Step 4: lancer** `npx vitest run web/src/pages` — attendu : PASS.
- [ ] **Step 5: commit** `feat: suppression et fusion branchées sur les listes et les fiches`.

---

### Task 7: Vérification complète, navigateur et livraison

**Files:** aucun nouveau (corrections éventuelles).

- [ ] **Step 1:** `npm run verify` (format, lint, types, tests, build) — attendu : tout vert. Corriger avant de continuer.
- [ ] **Step 2:** vérifier dans le navigateur (instance Démo, données fictives) : supprimer une organisation depuis la liste (mode simulation : message affiché, rien ne change), fusionner deux contacts de démo, vue liste des affaires. Pas d'écriture réelle HubSpot.
- [ ] **Step 3:** relecture de `git diff --staged` pour le garde-fou confidentialité (aucun nom réel, aucun secret) ; ajouter les fichiers explicitement ; commit.
- [ ] **Step 4:** push, ouvrir la PR (corps terminé par la ligne « Generated with Claude Code »), relecture de code par l'agent, CI verte, merge dans `main`.
- [ ] **Step 5:** `git fetch`, reconstruire l'application et relancer le conteneur depuis `origin/main` (mémoire « reconstruire après merge »), puis expliquer à Marc pas à pas comment tester (liste → cocher → Supprimer / Fusionner ; le cas du doublon OID). Rappeler que la vraie suppression/fusion dans HubSpot n'a lieu que lorsque les écritures réelles sont activées.
