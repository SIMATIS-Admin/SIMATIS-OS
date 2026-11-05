# Règles de rédaction du support d'ouverture (livraison 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Appliquer au support d'ouverture (étape 1) le mécanisme déjà en place pour le rapport : une fiche de règles du second cerveau, la relecture des deux derniers supports finaux à la préparation d'un nouveau support, et une capitalisation automatique quand le pilote archive le support final.

**Architecture:** La version finale d'un support est celle que l'OS connaît déjà (`supportStatut = 'final'`, texte dans `supportTexte`) : pas de nouvelle case, pas d'export Drive. À la fin d'une demande « support final », le runner lance une demande `regles_support` : Claude compare le support final aux supports finaux précédents, met à jour la fiche du support et déclare ses changements au journal existant (nouvelle valeur `support` de la fiche). À la préparation, le prompt reçoit les règles et, selon un réglage propre au support, les deux derniers supports finaux.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres), zod, vitest, React, MCP interne.

**Spec:** `docs/superpowers/specs/2026-11-05-rapport-versions-finales-design.md` (livraison 4). Livraisons 1 à 3 déjà mergées (plans `…livraisons-1-2.md` et `…capitalisation-regles-livraison-3.md`).

## Global Constraints

- Dépôt public : tests et exemples **fictifs uniquement** (« Atelier Fictif », « Bureau Fictif »). Aucun nom de client, extrait de support ou règle propriétaire dans le code, les tests, les commentaires ou les commits.
- Mêmes règles du jeu que le rapport : règle ferme = constatée sur au moins 2 supports finaux ou donnée par Marc ; une observation n'est jamais appliquée d'office ; une règle contredite est **signalée**, jamais supprimée ; un libellé de journal est une consigne générique de 200 caractères au plus, sans nom d'entreprise.
- Fiche du second cerveau : `brain/methodes/diagnostic-endurance-commerciale/regles-support-ouverture.md` (à créer, Task 6). Les règles communes restent dans `regles-communes-diagnostic.md`. Le runner n'écrit que dans le dossier `brain/methodes/diagnostic-endurance-commerciale`.
- Nom de demande `regles_support` : ne commence pas par `capitalisation_` (ce préfixe déclenche la capitalisation de la restitution dans `attentesClaude`).
- Réglage d'instance `diagnostic.relireSupports` : actif par défaut, indépendant de `relireFinaux`. Désactivé, seules les règles restent dans le prompt. La capitalisation compare toujours aux supports finaux précédents.
- Pas de migration : `fiche` et `demande` sont des colonnes texte à valeurs contrôlées en TypeScript seulement.
- Interface en français, vouvoiement ; commentaires : le pourquoi seulement ; style du fichier voisin.
- `npm run verify` vert avant chaque commit ; fichiers ajoutés explicitement (jamais `git add -A`), `git diff --staged` relu ; node via `/opt/homebrew/opt/node@24/bin`.
- Branche `feature/regles-support-ouverture` (déjà créée depuis `origin/main`). Après merge : reconstruire l'app et relancer le conteneur depuis `origin/main` (AGENTS.md, Livraison).

## Review Focus

- Un support jamais archivé, ou archivé sans texte, n'est jamais relu comme modèle ni utilisé comme finale (Task 2).
- Le support en cours de préparation ne se relit pas lui-même : le projet courant est exclu des modèles (Task 2).
- Fin d'une demande autre que « support final », ou terminée en erreur : aucune capitalisation lancée (Task 3).
- Archivage pendant que Claude répond déjà : le support reste final, aucune erreur bloquante, bouton de relance (Task 3, Task 5).
- Outil de règles appelé hors demande `regles_rapport` / `regles_support` / `regles_annuler` : refusé (Task 1).

---

### Task 1: Journal et outil ouverts aux règles du support

**Files:**
- Modify: `src/diagnostic/schema.ts` (`DEMANDES`, `FICHES_REGLES`), `src/diagnostic/regles.ts`, `src/diagnostic/outils-mcp.ts`
- Test: `src/diagnostic/regles.test.ts`

**Interfaces:**
- Consumes: `enregistrerReglesRapport`, `ChangementRegle`, `FicheRegles` (livraison 3).
- Produces: `DEMANDES` étendu de `'regles_support'` ; `FICHES_REGLES = ['rapport', 'communes', 'support']` ; `enregistrerReglesRapport` accepte aussi la demande `regles_support` (origine du journal : `support final`) ; l'outil MCP `enregistrer_regles_rapport` accepte la fiche `support` (description mise à jour : « fiches de règles de rédaction »).

- [ ] **Step 1: Write the failing tests** : changement de fiche `support` pendant une demande `regles_support` → entrée créée avec `origine === 'support final'` ; même appel pendant une demande `regles_rapport` pour la fiche `support` reste accepté (la fiche n'est pas liée à la demande) ; appel sans aucune des trois demandes → `SupportInvalide` ; les tests existants du rapport restent verts.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/regles.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : élargir la vérification de demande à `regles_rapport | regles_support`, l'origine selon la demande (`version finale N` ou `support final`), l'énumération de la fiche dans l'outil.
- [ ] **Step 4: Run** le fichier — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(diagnostic): journal des règles ouvert au support`.

### Task 2: Supports finaux et réglage dans l'attente du runner

**Files:**
- Create: `src/diagnostic/supports-finaux.ts`
- Modify: `src/diagnostic/chat.ts` (`attentesClaude`), `src/instances/schema.ts`, `src/api/routes.ts` (route des réglages), `web/src/api.ts`
- Test: `src/diagnostic/supports-finaux.test.ts`, `src/diagnostic/api.test.ts`

**Interfaces:**
- Consumes: `diagnosticProjets.supportTexte` / `supportFinalLe` / `supportStatut`, `Diapositive` ; route `GET/PUT /api/i/:slug/diagnostic/reglages` (livraison 2).
- Produces:
  - `InstanceConfig.diagnostic?: { relireFinaux?: boolean; relireSupports?: boolean }`.
  - `supportsFinauxPour(db: Executor, instance: Instance, projetId: string): Promise<SupportFinal[]>` avec `SupportFinal = { nom: string; texte: string }` : au plus deux, du plus récent au plus ancien par `supportFinalLe`, projets de l'instance autres que `projetId`, `supportStatut === 'final'` et `supportTexte` non vide ; `nom` neutre (`Support final 1`, `Support final 2`) ; `texte` = titre, texte affiché et notes de chaque diapositive, tronqué à 30 000 caractères.
  - `attentesClaude` ajoute `relireSupports: boolean`, `supportsFinaux: SupportFinal[]` (jointes pour `preparer_support` si le réglage est actif, et toujours pour `regles_support`), `supportFinalTexte: string | null` (texte du support du projet courant, seulement pour `regles_support`).
  - route des réglages : `GET` → `{ relireFinaux: boolean; relireSupports: boolean }` ; `PUT` accepte l'un ou l'autre champ (au moins un) et renvoie les deux ; web : `ReglagesDiag` étendu, `majReglagesDiagnostic(slug: string, reglage: Partial<ReglagesDiag>)`.

- [ ] **Step 1: Write the failing tests** : `supportsFinauxPour` renvoie les deux plus récents hors projet courant avec leur texte ; ignore un support non final, ou final sans texte ; liste vide sans finale ; l'attente d'une demande `preparer_support` porte `supportsFinaux` seulement si `relireSupports` n'est pas `false` ; l'attente d'une demande `regles_support` en porte toujours et ajoute `supportFinalTexte` ; API : `GET` des réglages renvoie `{ relireFinaux: true, relireSupports: true }` par défaut, `PUT { relireSupports: false }` ne touche pas `relireFinaux`, corps vide → 400. Les tests de la livraison 2 sur `majReglagesDiagnostic` sont adaptés à la nouvelle signature.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/supports-finaux.test.ts src/diagnostic/api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** le module, les champs d'attente et la route.
- [ ] **Step 4: Run** les deux fichiers puis `npx vitest run src/diagnostic web/src/pages/Diagnostic.test.tsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): joindre les supports finaux à la demande du runner`.

### Task 3: Capitaliser à l'archivage du support final

**Files:**
- Modify: `src/diagnostic/support.ts`, `src/routines/runner-api.ts` (route `fin`), `src/api/routes.ts`
- Test: `src/diagnostic/support.test.ts`, `src/diagnostic/api.test.ts`

**Interfaces:**
- Consumes: `envoyerMessage`, `DEBUT_MESSAGE_REGLES`-style constantes, `finirAttente`.
- Produces:
  - `DEBUT_MESSAGE_REGLES_SUPPORT = 'Capitaliser le support final'`.
  - `demanderCapitalisationSupport(db: Executor, instance: Instance, id: string): Promise<ProjetVue>` : message à l'étape 1, demande `regles_support` ; refuse (`ChatIndisponible`) si le support n'est pas final ou sans texte, ou si Claude répond déjà.
  - `capitaliserSiSupportFinal(db: Executor, instance: Instance, id: string, demandeTerminee: Demande | null): Promise<void>` : ne fait rien si `demandeTerminee !== 'support_final'` ou si le support n'est pas final ; sinon appelle `demanderCapitalisationSupport` en ignorant `ChatIndisponible`.
  - route `fin` du runner : lit la demande en cours avant `finirAttente`, puis appelle `capitaliserSiSupportFinal` si la demande ne s'est pas terminée en erreur.
  - `POST /api/i/:slug/diagnostic/projets/:id/support/capitaliser` → `ProjetVue` (409 sur refus, 400 sur identifiant invalide) ; web : `capitaliserSupportDiag(slug: string, id: string): Promise<ProjetDiag>`.

- [ ] **Step 1: Write the failing tests** : `demanderCapitalisationSupport` sur un support final lance la demande `regles_support` avec le message attendu à l'étape 1 ; refus sans support final, et pendant que Claude répond ; `capitaliserSiSupportFinal` lance la demande après une demande `support_final` ; ne lance rien après `preparer_support`, `rapport` ou `null` ; ne lance rien si le support n'est pas final ; reste muet si Claude répond déjà ; la route répond 200, 409, 400 ; le test de la route `fin` du runner (monté comme dans les tests existants de `runner-api`) lance la capitalisation quand le projet vient de finir une demande `support_final` sans erreur, et pas avec une erreur.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/support.test.ts src/diagnostic/api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les fonctions et les deux routes (gabarit de `rapport/capitaliser`).
- [ ] **Step 4: Run** les deux fichiers puis `npx vitest run src/diagnostic src/routines` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): capitaliser le support à son archivage`.

### Task 4: Le runner prépare avec les règles et capitalise

**Files:**
- Modify: `src/runner/runner.ts` (`AttenteDiag`, `promptSupport`, nouveaux prompts, `promptAnnulerRegle`, branche de `tourDiagnostic`)
- Test: `src/runner/diagnostic.test.ts`

**Interfaces:**
- Consumes: champs d'attente de la Task 2 ; `outilsRegles`, `FICHE_REGLES_COMMUNES`, `OPTIONS_SUPPORT` (livraison 3).
- Produces:
  - `AttenteDiag` étendu de `relireSupports`, `supportsFinaux`, `supportFinalTexte`.
  - `FICHE_REGLES_SUPPORT = 'brain/methodes/diagnostic-endurance-commerciale/regles-support-ouverture.md'`.
  - `promptSupport` ajoute, quand le second cerveau est accessible, la lecture des fiches `FICHE_REGLES_SUPPORT` et `FICHE_REGLES_COMMUNES` (règles fermes impératives, priment sur la trame par défaut de la skill) et, pour `preparer_support` avec `relireSupports`, un bloc des supports finaux comme modèles de structure et de ton (jamais de fait, nom ni chiffre).
  - `promptReglesSupport(a: AttenteDiag): string` : texte du support final, supports finaux précédents, fiches à lire, mêmes règles du jeu que `promptReglesRapport`, appel final unique à `enregistrer_regles_rapport` (fiche « support » ou « communes »).
  - `promptAnnulerRegle` choisit la fiche d'après `regleAAnnuler.fiche` (`support` → `FICHE_REGLES_SUPPORT`).
  - `tourDiagnostic` : branche `regles_support` (second cerveau requis, `outilsRegles`, mêmes options que `regles_rapport`) ; le garde « skill du support absente » n'y s'applique pas.

- [ ] **Step 1: Write the failing tests** : `promptSupport` cite les deux fiches avec un second cerveau et pas sans ; les supports finaux n'apparaissent que si `relireSupports` est vrai et seulement pour `preparer_support` ; un `texte` absent n'affiche ni `null` ni `undefined` ; `promptReglesSupport` contient le texte final, les supports précédents, les deux chemins de fiche, la règle des deux constats, la signalisation des contradictions, l'interdiction de tout nom d'entreprise et l'appel à `enregistrer_regles_rapport` avec le `projetId` ; sans support précédent, il le dit ; `promptAnnulerRegle` pour une règle de la fiche `support` cite `FICHE_REGLES_SUPPORT`.
- [ ] **Step 2: Run** `npx vitest run src/runner/diagnostic.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** prompts et branche (même gabarit que `regles_rapport`) ; réutiliser le formatage des modèles de `blocFinaux` plutôt que le dupliquer.
- [ ] **Step 4: Run** le fichier — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(runner): règles de rédaction du support d'ouverture`.

### Task 5: Écran du support

**Files:**
- Modify: `web/src/api.ts`, `web/src/pages/Diagnostic.tsx` (composants `Support` et journal du rapport)
- Test: `web/src/pages/Diagnostic.test.tsx`

**Interfaces:**
- Consumes: `capitaliserSupportDiag`, `majReglagesDiagnostic`, `reglagesDiagnostic` (Tasks 2 et 3).
- Produces: dans le panneau Support, une case « Relire les deux derniers supports finaux avant de préparer » (réglage `relireSupports`, cochée par défaut) ; un bouton « Capitaliser ce support » visible quand le support est final, désactivé pendant que Claude travaille ; le journal « Règles apprises » nomme la fiche `support` « règles du support ». Le réglage du rapport (Task 7 de la livraison 2) continue de fonctionner avec la nouvelle signature.

- [ ] **Step 1: Write the failing tests** : la case est cochée par défaut et appelle `majReglagesDiagnostic('simatis', { relireSupports: false })` au clic ; la case du rapport appelle toujours `majReglagesDiagnostic('simatis', { relireFinaux: … })` ; le bouton est absent tant que le support n'est pas final, actif ensuite, désactivé pendant une réponse de Claude, et appelle `capitaliserSupportDiag('simatis', 'p1')` ; une entrée de journal de fiche `support` s'affiche avec « règles du support » ; message de l'API affiché en cas de refus.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/Diagnostic.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** les deux ajouts d'écran, sur le modèle de la case et du bouton du rapport.
- [ ] **Step 4: Run** — Expected: PASS ; vérifier dans le navigateur (lecture seule sur les données réelles).
- [ ] **Step 5: Commit** `feat(diagnostic): écran des règles du support d'ouverture`.

### Task 6: Fiche du support, vérification et livraison

**Files:** second cerveau (hors dépôt) ; aucun fichier de code.

- [ ] **Step 1: Créer** `brain/methodes/diagnostic-endurance-commerciale/regles-support-ouverture.md` dans le second cerveau, sur le gabarit de `regles-redaction-rapport.md` (mode d'emploi, règles fermes, observations, journal), vide au départ : aucune règle n'est inventée avant les premiers supports finaux ; la lier depuis la fiche méthode, `amelioration-continue.md` et `regles-communes-diagnostic.md`, et ajouter une entrée datée au `log.md`.
- [ ] **Step 2: Run** `npm run verify` — Expected: tout vert.
- [ ] **Step 3: Ouvrir la PR**, relire le diff (aucune donnée réelle), suivre la CI jusqu'au vert (relancer une fois si une coupure de connexion Postgres sans lien fait échouer un test d'un autre module), merger.
- [ ] **Step 4: Reconstruire l'app et relancer le conteneur** depuis `origin/main` à jour ; vérifier `curl localhost:4300/health` et que `GET /api/i/simatis/diagnostic/reglages` renvoie les deux champs.
- [ ] **Step 5: Mettre à jour le second cerveau** : `brain/outils/simatis-os-structure.md`, `brain/outils/simatis-os-feuille-de-route.md`, `log.md`.
- [ ] **Step 6: Expliquer à Marc**, pas à pas, comment tester : archiver un support final (« Support final »), voir la ligne de capitalisation dans le chat de l'étape 1, ouvrir « Règles apprises », préparer un nouveau support.
