# Règles de construction du deck de restitution (livraison 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Appliquer au deck de restitution (étape 5) le mécanisme déjà en place pour le rapport et le support : une case « Version finale » sur les decks, une fiche de règles du second cerveau, la relecture des deux derniers decks finaux à la production d'un nouveau deck, et une capitalisation automatique à la case cochée.

**Architecture:** Le deck est un artifact claude.ai que le pilote retouche en place : sa version finale est donc **un lien de `restitutionLiens` coché** (une seule par projet), comme `rapportLiens`. L'OS ne stocke pas le texte du deck : Claude le **relit sur claude.ai** (action `read` de l'outil Artifact, déjà permise pendant la restitution) quand il capitalise et quand il produit un nouveau deck. À la case cochée, le runner lance une demande `regles_restitution` : Claude compare le deck final aux decks finaux précédents, met à jour la fiche du second cerveau et déclare ses changements au journal existant (nouvelle valeur `restitution` de la fiche). À la production, le prompt reçoit les règles et, selon un réglage propre au deck, les liens des deux derniers decks finaux.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres), zod, vitest, React, MCP interne.

**Spec:** `docs/superpowers/specs/2026-11-05-rapport-versions-finales-design.md` (livraison 6). Livraisons 1 à 5b déjà mergées (plans du même dossier, notamment `…support-ouverture-regles-livraison-4.md` dont celle-ci reprend le gabarit).

## Rulings de conception (fermés avant le plan)

- **Version finale** : un deck de `restitutionLiens` coché « Version finale ». Pas d'export PowerPoint requis : l'export reste un outil de livraison, pas de capitalisation.
- **Lecture du texte** : par Claude, sur le lien du deck (Artifact `read`), à la demande seulement. Rien n'est stocké en base ; coût si faux : un deck retouché après la case cochée change ce que Claude lit, d'où le bouton de relance « Capitaliser ce deck ».
- **Pas de migration** : `restitutionLiens` est un jsonb (le champ `finale` s'y ajoute) ; `fiche` et `demande` sont des colonnes texte contrôlées en TypeScript.

## Global Constraints

- Dépôt public : tests et exemples **fictifs uniquement** (« Atelier Fictif », « Bureau Fictif », liens `https://claude.ai/artifacts/…` inventés). Aucun nom de client, contenu de deck, tarif ou règle propriétaire dans le code, les tests, les commentaires ou les commits.
- Mêmes règles du jeu que le rapport : règle ferme = constatée sur au moins 2 decks finaux ou donnée par Marc ; une observation n'est jamais appliquée d'office ; une règle contredite est **signalée**, jamais supprimée ; un libellé de journal est une consigne générique de 200 caractères au plus, sans nom d'entreprise, sans tarif.
- La restitution est le seul livrable où la **proposition d'accompagnement** a sa place (règle commune : elle vient après le rapport) : les règles du deck peuvent porter sur sa place, sa forme et ses options, jamais sur ses montants.
- Fiche du second cerveau : `brain/methodes/diagnostic-endurance-commerciale/regles-restitution.md` (à créer, Task 6). Les règles communes restent dans `regles-communes-diagnostic.md`. Le runner n'écrit que dans le dossier `brain/methodes/diagnostic-endurance-commerciale`.
- Nom de demande `regles_restitution` : ne commence pas par `capitalisation_` (ce préfixe déclenche la capitalisation du compte rendu de restitution dans `attentesClaude`).
- Réglage d'instance `diagnostic.relireRestitutions` : actif par défaut, indépendant de `relireFinaux` et `relireSupports`. Désactivé, seules les règles restent dans le prompt. La capitalisation compare toujours aux decks finaux précédents.
- Interface en français, vouvoiement ; commentaires : le pourquoi seulement ; style du fichier voisin.
- `npm run verify` vert avant chaque commit ; fichiers ajoutés explicitement (jamais `git add -A`), `git diff --staged` relu ; node via `/opt/homebrew/opt/node@24/bin`.
- Branche `feature/regles-restitution` depuis `origin/main`. Une autre session peut travailler dans le même dossier : vérifier `git branch --show-current` et `git status` avant chaque commit ; s'il y a des modifications que cette session n'a pas faites, s'arrêter et prévenir Marc. Après merge : reconstruire l'app et relancer le conteneur depuis `origin/main` (AGENTS.md, Livraison).

## Review Focus

- Un deck non coché, ou d'un autre projet, n'est jamais pris pour un modèle ; le deck en cours de production ne se relit pas lui-même (Task 3).
- Cocher un lien qui n'est pas dans `restitutionLiens` du projet, ou qui n'est pas un artifact claude.ai : refus, rien modifié (Task 2).
- Cocher pendant que Claude répond déjà (production, export, autre capitalisation) : la case reste cochée, aucune erreur bloquante, bouton de relance (Task 2, Task 5).
- Pendant `regles_restitution`, Claude ne peut ni créer ni publier d'artifact : seule la lecture est permise (Task 2).
- Outil de règles appelé hors demande `regles_rapport` / `regles_support` / `regles_analyse` / `regles_restitution` / `regles_annuler` : refusé (Task 1).
- Nouveau deck produit : les `restitutionLiens` existants gardent leur drapeau `finale` (Task 2).

---

### Task 1: Journal et outil ouverts aux règles du deck

**Files:**
- Modify: `src/diagnostic/schema.ts` (`DEMANDES`, `FICHES_REGLES`, type du jsonb `restitutionLiens`), `src/diagnostic/regles.ts`, `src/diagnostic/outils-mcp.ts`
- Test: `src/diagnostic/regles.test.ts`

**Interfaces:**
- Consumes: `enregistrerReglesRapport`, `ChangementRegle`, `FicheRegles` (livraisons 3 à 5a).
- Produces: `DEMANDES` étendu de `'regles_restitution'` ; `FICHES_REGLES = ['rapport', 'communes', 'support', 'analyse', 'restitution']` ; `export type LienRestitution = { lien: string; le: string; finale?: boolean }` et `restitutionLiens` typé `LienRestitution[]` ; `enregistrerReglesRapport` accepte la demande `regles_restitution` (origine du journal : `deck final`) ; l'outil MCP `enregistrer_regles_rapport` accepte la fiche `restitution`.

- [ ] **Step 1: Write the failing tests** : changement de fiche `restitution` pendant une demande `regles_restitution` → entrée créée avec `origine === 'deck final'` ; appel pendant `regles_annuler` toujours accepté ; appel sans aucune des demandes autorisées → `SupportInvalide` ; les tests existants (rapport, support, analyse) restent verts.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/regles.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : élargir la vérification de demande, l'origine selon la demande, l'énumération de la fiche dans l'outil (description : « fiches de règles de construction des livrables »).
- [ ] **Step 4: Run** le fichier — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(diagnostic): journal des règles ouvert au deck de restitution`.

### Task 2: Version finale du deck, capitalisation et permission de lecture

**Files:**
- Modify: `src/diagnostic/restitution.ts`, `src/api/routes.ts`, `web/src/api.ts` (types et appels seulement)
- Test: `src/diagnostic/restitution.test.ts`, `src/diagnostic/api.test.ts`

**Interfaces:**
- Consumes: `envoyerMessage`, `ChatIndisponible`, `LIEN_ARTIFACT` ; gabarit `marquerVersionFinale` de `rapport.ts`.
- Produces:
  - `DEBUT_MESSAGE_REGLES_RESTITUTION = 'Capitaliser le deck de restitution final'`.
  - `marquerDeckFinal(db: Executor, instance: Instance, id: string, lien: string, finale: boolean): Promise<ProjetVue>` : refuse (`ChatIndisponible`) un lien absent de `restitutionLiens` du projet ; décoche les autres liens (une seule finale) ; cocher lance ensuite `demanderReglesRestitution` en ignorant `ChatIndisponible` (la case reste posée) ; décocher ne lance rien.
  - `demanderReglesRestitution(db: Executor, instance: Instance, id: string): Promise<ProjetVue>` : message à l'étape 5, demande `regles_restitution` ; refuse (`ChatIndisponible`) s'il n'y a pas de deck final ou si Claude répond déjà.
  - `autoriserSiRestitution` : pendant `regles_restitution`, seule l'action `read` de l'outil Artifact est permise ; tout le reste est refusé avec message ; la décision n'est rendue qu'avec exactement une demande en cours (comportement existant).
  - `enregistrerRestitution` conserve le drapeau `finale` des liens existants quand un nouveau deck s'ajoute en tête.
  - routes `POST /api/i/:slug/diagnostic/projets/:id/restitution/finale` (corps `{ lien: string; finale: boolean }`) et `POST …/restitution/regles` → `ProjetVue` (409 sur refus, 400 sur identifiant ou corps invalide) ; web : `marquerDeckFinalDiag(slug, id, lien, finale): Promise<ProjetDiag>`, `capitaliserDeckDiag(slug, id): Promise<ProjetDiag>`, `restitutionLiens: { lien: string; le: string; finale?: boolean }[]`.

- [ ] **Step 1: Write the failing tests** : cocher un lien du projet le marque seul finale et lance la demande `regles_restitution` avec le message attendu à l'étape 5 ; cocher un autre lien déplace la finale ; lien étranger au projet, ou absent de la liste → `ChatIndisponible`, rien modifié ; cocher pendant que Claude répond : finale posée, aucune demande lancée, pas d'erreur ; décocher ne lance rien ; `demanderReglesRestitution` refuse sans deck final ; `autoriserSiRestitution` pendant `regles_restitution` : `Artifact` `read` autorisé, `publish`, `Edit` et `Bash` refusés ; un nouveau deck enregistré en tête n'efface pas la finale existante ; routes : 200, 409, 400.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/restitution.test.ts src/diagnostic/api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les fonctions, la permission et les deux routes (gabarit de `rapport/finale` et `rapport/capitaliser`).
- [ ] **Step 4: Run** les deux fichiers — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(diagnostic): version finale du deck de restitution et capitalisation`.

### Task 3: Decks finaux et réglage dans l'attente du runner

**Files:**
- Create: `src/diagnostic/restitutions-finales.ts`
- Modify: `src/diagnostic/chat.ts` (`attentesClaude`), `src/instances/schema.ts`, `src/api/routes.ts` (route des réglages), `web/src/api.ts`
- Test: `src/diagnostic/restitutions-finales.test.ts`, `src/diagnostic/api.test.ts`

**Interfaces:**
- Consumes: `restitutionLiens` avec `finale` ; route `GET/PUT /api/i/:slug/diagnostic/reglages` (livraisons 2 et 4).
- Produces:
  - `InstanceConfig.diagnostic?: { relireFinaux?: boolean; relireSupports?: boolean; relireRestitutions?: boolean }`.
  - `RestitutionFinale = { nom: string; lien: string }` ; `restitutionsFinalesPour(db: Executor, instance: Instance, projetId: string): Promise<RestitutionFinale[]>` : au plus deux, du plus récent au plus ancien par date du lien coché, projets de l'instance autres que `projetId`, lien `finale === true` ; `nom` neutre (`Deck final 1`, `Deck final 2`).
  - `attentesClaude` ajoute `relireRestitutions: boolean`, `restitutionsFinales: RestitutionFinale[]` (jointes pour `restitution` si le réglage est actif, et toujours pour `regles_restitution`), `restitutionFinaleLien: string | null` (lien du deck final du projet courant, seulement pour `regles_restitution`).
  - route des réglages : `GET` → `{ relireFinaux, relireSupports, relireRestitutions }` (tous vrais par défaut) ; `PUT` accepte l'un ou plusieurs champs (au moins un) et renvoie les trois ; web : `ReglagesDiag` étendu.

- [ ] **Step 1: Write the failing tests** : les deux plus récents hors projet courant ; un lien non coché ignoré ; liste vide sans finale ; l'attente d'une demande `restitution` porte `restitutionsFinales` seulement si `relireRestitutions` n'est pas `false` ; celle de `regles_restitution` en porte toujours et ajoute `restitutionFinaleLien` ; API : `GET` des réglages renvoie les trois à `true` par défaut, `PUT { relireRestitutions: false }` ne touche pas les deux autres, corps vide → 400 ; les tests existants sur `majReglagesDiagnostic` restent verts.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/restitutions-finales.test.ts src/diagnostic/api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** le module, les champs d'attente et la route.
- [ ] **Step 4: Run** ces fichiers puis `npx vitest run src/diagnostic web/src/pages/Diagnostic.test.tsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): joindre les decks finaux à la demande du runner`.

### Task 4: Le runner produit avec les règles et capitalise

**Files:**
- Modify: `src/runner/runner.ts` (`AttenteDiag`, `promptRestitution`, nouveau prompt, `promptAnnulerRegle`, branche de `tourDiagnostic`, outils)
- Test: `src/runner/diagnostic.test.ts`

**Interfaces:**
- Consumes: champs d'attente de la Task 3 ; `outilsRegles`, `FICHE_REGLES_COMMUNES`, `blocModeles`-style de `promptSupport` (livraison 4).
- Produces:
  - `AttenteDiag` étendu de `relireRestitutions`, `restitutionsFinales`, `restitutionFinaleLien`.
  - `FICHE_REGLES_RESTITUTION = 'brain/methodes/diagnostic-endurance-commerciale/regles-restitution.md'`.
  - `promptRestitution` ajoute, quand le second cerveau est accessible, la lecture des fiches `FICHE_REGLES_RESTITUTION` et `FICHE_REGLES_COMMUNES` (règles fermes impératives, priment sur la trame par défaut de la skill) et, avec `relireRestitutions`, un bloc des decks finaux : liens à lire avec Artifact `read`, modèles de plan, de durée et de ton, jamais de fait, nom, chiffre ni tarif.
  - `promptReglesRestitution(a: AttenteDiag): string` : lien du deck final, liens des decks finaux précédents, fiches à lire, mêmes règles du jeu que `promptReglesSupport`, rappel que les montants ne sont jamais capitalisés, appel final unique à `enregistrer_regles_rapport` (fiche « restitution » ou « communes »).
  - `promptAnnulerRegle` choisit la fiche d'après `regleAAnnuler.fiche` (`restitution` → `FICHE_REGLES_RESTITUTION`).
  - `tourDiagnostic` : branche `regles_restitution` (second cerveau requis, outils = `outilsRegles` plus lecture d'Artifact, mêmes options que `regles_support`) ; le garde « skill de restitution absente » n'y s'applique pas.

- [ ] **Step 1: Write the failing tests** : `promptRestitution` cite les deux fiches avec un second cerveau et pas sans ; les liens des decks finaux n'apparaissent que si `relireRestitutions` est vrai ; liste vide : bloc absent, ni `null` ni `undefined` ; `promptReglesRestitution` contient le lien final, les liens précédents, les deux chemins de fiche, la règle des deux constats, la signalisation des contradictions, l'interdiction de tout nom d'entreprise et de tout montant, et l'appel à `enregistrer_regles_rapport` avec le `projetId` ; sans deck précédent, il le dit ; la liste d'outils de `regles_restitution` autorise l'écriture seulement dans le dossier des règles et n'inclut aucun outil de publication ; `promptAnnulerRegle` pour une règle de la fiche `restitution` cite `FICHE_REGLES_RESTITUTION`.
- [ ] **Step 2: Run** `npx vitest run src/runner/diagnostic.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** prompts, outils et branche (gabarit `regles_support`) ; réutiliser le formatage de modèles existant plutôt que le dupliquer.
- [ ] **Step 4: Run** le fichier — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(runner): règles de construction du deck de restitution`.

### Task 5: Écran de l'étape 5

**Files:**
- Modify: `web/src/pages/Diagnostic.tsx` (panneau « Deck de restitution » et journal « Règles apprises »)
- Test: `web/src/pages/Diagnostic.test.tsx`

**Interfaces:**
- Consumes: `marquerDeckFinalDiag`, `capitaliserDeckDiag`, `majReglagesDiagnostic`, `reglagesDiagnostic` (Tasks 2 et 3).
- Produces: une case « Version finale » sur le deck affiché et sur chaque deck de la liste « Decks précédents » (une seule cochée) ; une case de réglage « Relire les deux derniers decks finaux avant de produire » (`relireRestitutions`, cochée par défaut) ; un bouton « Capitaliser ce deck » visible quand un deck est final, désactivé pendant que Claude travaille ; le journal « Règles apprises » nomme la fiche `restitution` « règles du deck de restitution ». Les réglages du rapport et du support continuent de fonctionner.

- [ ] **Step 1: Write the failing tests** : la case du deck appelle `marquerDeckFinalDiag('simatis', 'p1', lien, true)` ; une seule case cochée à la fois ; décocher appelle avec `false` ; la case de réglage est cochée par défaut et appelle `majReglagesDiagnostic('simatis', { relireRestitutions: false })` ; les cases des deux autres réglages appellent toujours leur propre champ ; le bouton est absent sans deck final, actif ensuite, désactivé pendant une réponse de Claude, appelle `capitaliserDeckDiag('simatis', 'p1')` ; une entrée de journal de fiche `restitution` s'affiche avec « règles du deck de restitution » ; message de l'API affiché en cas de refus.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/Diagnostic.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** les ajouts d'écran, sur le modèle des cases du rapport et du support.
- [ ] **Step 4: Run** — Expected: PASS ; vérifier dans le navigateur (lecture seule sur les données réelles).
- [ ] **Step 5: Commit** `feat(diagnostic): écran des règles du deck de restitution`.

### Task 6: Fiche du deck, vérification et livraison

**Files:** second cerveau (hors dépôt) ; aucun fichier de code.

- [ ] **Step 1: Créer** `brain/methodes/diagnostic-endurance-commerciale/regles-restitution.md` dans le second cerveau, sur le gabarit de `regles-support-ouverture.md` (mode d'emploi, règles fermes, observations, journal), vide au départ : aucune règle n'est inventée avant les premiers decks finaux ; la lier depuis la fiche méthode, `amelioration-continue.md` et `regles-communes-diagnostic.md`, et ajouter une entrée datée au `log.md`.
- [ ] **Step 2: Run** `npm run verify` — Expected: tout vert.
- [ ] **Step 3: Ouvrir la PR**, relire le diff (aucune donnée réelle), suivre la CI jusqu'au vert, merger.
- [ ] **Step 4: Reconstruire l'app et relancer le conteneur** depuis `origin/main` à jour ; vérifier `curl localhost:4300/health` et que `GET /api/i/simatis/diagnostic/reglages` renvoie les trois champs.
- [ ] **Step 5: Mettre à jour le second cerveau** : `brain/outils/simatis-os-structure.md`, `brain/outils/simatis-os-feuille-de-route.md`, `log.md`.
- [ ] **Step 6: Expliquer à Marc**, pas à pas, comment tester : à l'étape 5, cocher « Version finale » sur un deck, voir la ligne de capitalisation dans le chat, ouvrir « Règles apprises », produire un nouveau deck.
