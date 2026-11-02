# Test de VMA : relances et suivi, livraison 1 (OS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relancer à la main ou automatiquement les invitations au Test de VMA restées sans réponse, avec vouvoiement ou tutoiement, et voir envoi et relances dans la fenêtre Test de VMA.

**Architecture:** Colonnes ajoutées à `vma_tests` (registre, date d'envoi, relances, échec). Le service `relancerInvitation` (`src/vma/relances.ts`) est le seul chemin de relance : le bouton (route API) et le passage quotidien (`startRelancesVma`, comme `startReleveVma`) l'appellent. L'envoi réutilise `writeVia`, donc le dry-run et le double verrou existants.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres), React, Vitest (testcontainers pour la base).

**Spec:** `docs/superpowers/specs/2026-11-02-vma-relances-suivi-design.md` (livraison 1 seulement ; ouverture et clic du mail = livraison 2).

## Global Constraints

- Branche `feature/vma-relances` partie de `origin/main` à jour, arbre propre avant de changer de branche ; jamais de commit sur `main`.
- `git add` explicite, relire `git diff --staged` : dépôt public, **données fictives uniquement** (entreprises « Atelier Fictif », adresses `@exemple.test`).
- Vouvoiement par défaut ; salutation = prénom seul via `salutation()`.
- Relance auto : 7 jours après `envoyee_le`, une seule, jamais si déjà relancée (main ou auto).
- Une simulation (dry-run) n'est ni une relance comptée ni un envoi daté.
- Écriture réelle uniquement via `writeVia` (double verrou) ; jamais d'envoi réel en test.
- Interface et mails en français ; commits terminés par `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `npm run verify` vert avant chaque commit.

## Review Focus

- Invitation sans adresse e-mail : ni bouton, ni relance auto, refus 409 côté API.
- Invitation expirée entre l'affichage et le clic : refus, pas de mail avec un lien mort.
- Double clic ou deux passages le même jour : une seule relance enregistrée.
- Échec d'envoi : `echec_envoi` renseigné, compteur inchangé, la routine ne s'arrête pas sur une invitation en échec.
- Invitations antérieures à la migration : `envoyee_le` repris de `created_at` seulement si une adresse existe.

---

## File Structure

- `src/vma/schema.ts` (modif) : nouvelles colonnes.
- `drizzle/0062_vma_relances.sql` + journal (généré) : migration et reprise de l'existant.
- `src/vma/invitations.ts` (modif) : `tutoiement` dans la création et le mail d'invitation ; `mailRelance`.
- `src/vma/relances.ts` (nouveau) : `relancerInvitation`, `relancerEnAttente`, `startRelancesVma`.
- `src/vma/routes.ts` (modif) : champs de suivi dans `vueTest`, `tutoiement` à la création, route de relance.
- `src/server.ts` (modif) : démarrage et arrêt du passage quotidien.
- `web/src/api.ts`, `web/src/pages/TestsVma.tsx`, `web/src/styles.css` (modif) : frise, bouton, case « Tutoyer », filtre.

---

### Task 1: Données et mails (vouvoiement / tutoiement, relance)

**Files:**
- Modify: `src/vma/schema.ts`, `src/vma/invitations.ts`
- Create: `drizzle/0062_vma_relances.sql` (via `npm run db:generate`)
- Test: `src/vma/envoi-invitation.test.ts`

**Interfaces:**
- Produces: `vmaTests` colonnes `tutoiement: boolean` (défaut false), `envoyeeLe: Date | null`, `relances: Relance[]`, `echecEnvoi: string | null` ; `type Relance = { le: string; origine: 'manuelle' | 'auto' }` (exporté de `schema.ts`) ; `mailInvitation(p: {…, tutoiement?: boolean})` ; `mailRelance(p: { entrepriseNom; contactNom; lien; expireLe; tutoiement?: boolean }): { subject: string; html: string }` ; `creerInvitation` accepte `tutoiement?: boolean` et le stocke ; `envoyerInvitation(db, instance, ecriture, test)` accepte aussi `tutoiement` et `id`, et renseigne `envoyeeLe`/`echecEnvoi` après l'envoi (`envoye` seulement pour la date ; `echec` pour la raison).

- [ ] **Step 1: Write the failing tests** dans `envoi-invitation.test.ts` :
  - `mailInvitation` avec `tutoiement: true` contient « Voici ton lien » et « copie ce lien », et pas « votre lien » ; sans `tutoiement` contient « Voici votre lien ».
  - `mailRelance` : objet `Rappel : votre test VMA (Atelier Fictif)` ; en tutoiement `Rappel : ton test VMA (Atelier Fictif)` ; contient `href` du lien, `Bonjour Jeanne,`, la date d'expiration, et échappe le nom (`Atelier &lt;b&gt;`).
  - Test base : après un envoi en échec (messagerie absente), la ligne a `echecEnvoi` non nul et `envoyeeLe` nul.
- [ ] **Step 2: Run** `npx vitest run src/vma/envoi-invitation.test.ts` — Expected: FAIL (`mailRelance` absent).
- [ ] **Step 3: Implement** : colonnes dans `schema.ts` ; `npm run db:generate`, puis ajouter à la fin de la migration générée `UPDATE "vma_tests" SET "envoyee_le" = "created_at" WHERE "contact_email" IS NOT NULL;` ; `mailInvitation` et `mailRelance` avec un petit helper `vous(tutoiement)` pour les formes (votre/ton, copiez/copie) ; `envoyerInvitation` écrit `envoyeeLe` (envoi réel) ou `echecEnvoi` (échec) dans la ligne ; une simulation ne change rien.
- [ ] **Step 4: Run** `npx vitest run src/vma` — Expected: PASS (les autres tests VMA inchangés).
- [ ] **Step 5: Commit** `feat(vma): registre tutoiement, dates d'envoi et mail de relance`.

### Task 2: Service de relance et route du bouton

**Files:**
- Create: `src/vma/relances.ts`, `src/vma/relances.test.ts`
- Modify: `src/vma/routes.ts`

**Interfaces:**
- Consumes: Task 1 (`mailRelance`, colonnes).
- Produces: `class RelanceImpossible extends Error` ; `relancerInvitation(db: Database, instance: Instance, ecriture: ConnexionDeps, p: { testId: string; origine: 'manuelle' | 'auto'; tutoiement?: boolean; maintenant?: Date }): Promise<EnvoiInvitation>` ; route `POST /api/i/:slug/vma/tests/:id/relancer` body `{ tutoiement?: boolean }` → `200 { ...vueTest, envoi }`, `409 { error }` si impossible.
- Règles de refus (`RelanceImpossible`, message en français) : statut ≠ `envoyee`, expirée à `maintenant`, sans adresse, id inconnu.

- [ ] **Step 1: Write failing tests** (`relances.test.ts`, base de test comme `envoi-invitation.test.ts`, secrets inexistants donc l'envoi échoue ; pour l'envoi réussi, tester le chemin simulation avec la messagerie fictive si le helper de test existe, sinon injecter via `vi.mock` de `writeVia` comme les autres tests de l'envoi) :
  - refus pour utilisée, révoquée, expirée, sans adresse ;
  - envoi `envoye` : `relances` reçoit `{ le, origine }` ; envoi `simule` : `relances` reste vide ; envoi `echec` : `echecEnvoi` rempli, `relances` vide ;
  - `tutoiement: true` passé met à jour la colonne de l'invitation ;
  - deux appels simultanés (`Promise.all`) : une seule relance enregistrée (verrou `SELECT … FOR UPDATE` ou mise à jour conditionnelle).
- [ ] **Step 2: Run** `npx vitest run src/vma/relances.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `relancerInvitation` dans `relances.ts` : lecture de la ligne avec verrou, contrôles, envoi par le même `writeVia('messagerie', { op: 'message.send', … })` que `envoyerInvitation` (extraire un helper partagé `envoyerMail(tx, instance, ecriture, to, message)` plutôt que dupliquer), puis mise à jour. Route dans `routes.ts` : `RelanceImpossible` → 409, `TestIntrouvable` → 404, UUID vérifié comme les autres routes.
- [ ] **Step 4: Add route test** dans `src/vma/routes.test.ts` si présent (sinon dans `relances.test.ts` via `t.app.inject`) : 409 pour invitation utilisée, 200 pour invitation ouverte.
- [ ] **Step 5: Run** `npx vitest run src/vma` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(vma): relance d'une invitation (service et route)`.

### Task 3: Relance automatique à 7 jours

**Files:**
- Modify: `src/vma/relances.ts`, `src/server.ts`, `.env.example`, `src/config.ts` (+ `config.test.ts`)
- Test: `src/vma/relances.test.ts`

**Interfaces:**
- Consumes: Task 2 `relancerInvitation`.
- Produces: `RELANCE_AUTO_JOURS = 7` ; `relancerEnAttente(db, ecriture, maintenant?: Date): Promise<{ relancees: number; ignorees: number; echecs: number }>` ; `startRelancesVma(db, deps: { ecriture: ConnexionDeps; tickMs?: number; onResult?; onError? }): () => void`.
- Interrupteur : variable serveur `VMA_RELANCE_AUTO` (défaut `true`) dans `config.ts` (`vmaRelanceAuto: boolean`) et `.env.example` sans valeur secrète. *(Écart à la spec : pas d'entrée dans Paramètres > Routines, réservé aux routines Claude. La spec est ajustée.)*

- [ ] **Step 1: Write failing tests** (instances « mandat » fictives, dates injectées) : une invitation envoyée il y a 6 jours → non relancée ; 7 jours → relancée une fois (origine `auto`) ; déjà relancée à la main → non ; expirée, utilisée, révoquée, sans adresse → non ; second appel immédiat → aucune nouvelle relance ; une invitation en échec n'empêche pas de traiter les suivantes (`echecs` compté) ; toutes les instances actives sont parcourues (`listInstances`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `relancerEnAttente` (sélection par instance sous `withInstance`, puis `relancerInvitation` par ligne, erreur isolée par ligne) et `startRelancesVma` : tick toutes les heures, ne lance le passage qu'à partir de 8 h (Europe/Paris, `zoned`/`jourDe` comme `routines/planification.ts`) et une fois par jour (marqueur de jour en mémoire). Config + câblage dans `server.ts` (démarrage si le site est configuré et `vmaRelanceAuto`, arrêt dans le gestionnaire de signaux, journal `app.log.info` si `relancees > 0`).
- [ ] **Step 4: Run** `npx vitest run src/vma src/config.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(vma): relance automatique 7 jours après l'invitation`.

### Task 4: Interface : frise, bouton, tutoiement, filtre

**Files:**
- Modify: `src/vma/routes.ts` (`vueTest` + `creationSchema`), `web/src/api.ts`, `web/src/pages/TestsVma.tsx`, `web/src/styles.css`
- Test: `web/src/pages/TestsVma.test.tsx`, test de route dans `src/vma`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `vueTest` expose `tutoiement`, `envoyeeLe`, `relances`, `echecEnvoi` ; `creationSchema` accepte `tutoiement?: boolean` ; `api.ts` : champs ajoutés au type `TestVma` et à `NouveauTestVma`, `relancerTestVma(slug: string, id: string, tutoiement: boolean): Promise<TestVmaCree>` ; `TestsVma.tsx` exporte `etapesFrise(t: TestVma, maintenant?: number): { libelle: string; fait: boolean }[]`.

- [ ] **Step 1: Write failing tests** :
  - `etapesFrise` : invitation envoyée le 12/10, relancée le 19/10 (auto) → « Envoyé 12/10 », « Relancé 19/10 (auto) » faits ; « Test passé » non fait ; avec résultat → « Test passé » fait.
  - Le bouton « Relancer » est affiché pour une invitation ouverte avec adresse, absent si utilisée, révoquée, expirée ou sans adresse.
  - Cliquer ouvre la confirmation avec la case « Tutoyer » préremplie depuis `t.tutoiement` ; confirmer appelle `relancerTestVma(slug, id, valeurCochée)`.
  - La case « Tutoyer » du formulaire d'invitation est décochée par défaut et part dans `creerTestVma`.
  - Le filtre « Sans réponse depuis plus de 7 jours » ne garde que les invitations ouvertes envoyées il y a plus de 7 jours.
  - Route : `GET tests` renvoie les nouveaux champs ; `POST tests` avec `tutoiement: true` le stocke.
- [ ] **Step 2: Run** `npx vitest run src/vma web/src/pages/TestsVma.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** : frise sous chaque ligne (étapes non atteintes grisées, `echecEnvoi` visible), bouton « Relancer » à côté de « Copier le lien », confirmation par une petite boîte avec la case « Tutoyer » (même style que les boîtes existantes ; `window.confirm` ne permet pas la case), message de résultat via `messageEnvoi`, filtre en en-tête de liste. Styles dans `styles.css` selon les classes existantes (`row`, `small muted`).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(vma): frise de suivi, bouton Relancer et tutoiement`.

### Task 5: Vérification, recette et clôture

**Files:**
- Modify: `docs/superpowers/specs/2026-11-02-vma-relances-suivi-design.md` (écart de l'interrupteur, §4), second cerveau (hors dépôt)

- [ ] **Step 1: Run** `npm run verify` — Expected: tout vert.
- [ ] **Step 2: Recette navigateur** : démarrer l'app en tâche de fond (jamais avec `&`), ouvrir Diagnostic > Test de VMA ; vérifier la frise, le bouton, la case « Tutoyer », le filtre ; l'envoi reste simulé tant que le double verrou n'est pas levé. Arrêter ce qui a été lancé ou dire ce qui tourne.
- [ ] **Step 3: Corriger le §4 de la spec** (interrupteur `VMA_RELANCE_AUTO`).
- [ ] **Step 4: PR**, revue de code par l'agent, CI verte, merge, reconstruction de l'app et relance du conteneur depuis `origin/main` (règle du projet).
- [ ] **Step 5: Second cerveau** : mettre à jour `brain/outils/simatis-os-structure.md` et `brain/outils/simatis-os-feuille-de-route.md` (livraison 1 faite, livraison 2 site à faire), noter dans `log.md` ; rien copié dans le dépôt.
- [ ] **Step 6: Expliquer à Marc**, pas à pas, comment tester (relancer une invitation ouverte, vérifier la frise, lever le verrou d'écriture pour un vrai envoi).
