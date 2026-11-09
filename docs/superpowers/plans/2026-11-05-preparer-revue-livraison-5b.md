# Préparer la revue avec Claude (livraison 5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un bouton « Préparer la revue » à l'étape 3 où Claude pré-remplit les propositions de préconisations, de plan d'action et de conclusion d'un nouveau projet, à partir de la bibliothèque de préconisations, des deux dernières revues validées et des règles d'analyse, sans jamais toucher aux choix ni aux textes du pilote.

**Architecture:** Nouvelle demande `revue_preparer`. L'attente du runner porte le résultat du projet, le résumé de la revue en cours et les deux dernières revues validées (outil existant `revuesValideesPour`). Claude lit la bibliothèque et les fiches de règles dans le second cerveau, puis déclare ses propositions par un outil MCP `enregistrer_revue_proposee`. L'OS les fusionne dans la revue : il remplace les propositions (`texte`, `titre`, `bloc`, `bibliotheque`, `dimension`) et conserve tout ce que le pilote a écrit ou choisi (`choix`, `detail`, `libre`). Une revue validée n'est jamais touchée.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres), zod, vitest, React, MCP interne.

**Spec:** `docs/superpowers/specs/2026-11-05-rapport-versions-finales-design.md` (livraison 5). Plan frère : `2026-11-05-analyse-revue-regles-livraison-5a.md` (mergé).

## Décisions prises dans ce plan

- Claude ne propose que des **textes** : `choix` (garder, remplacer, retirer) et `detail` restent au pilote. Une préparation ne change jamais le statut de la revue : elle reste en `brouillon`.
- Une revue **validée** refuse la préparation : le pilote la modifie d'abord (elle repasse en brouillon).
- Préparer sur une revue en brouillon **conserve** `choix`, `detail` et `libre` des entrées existantes et les entrées ajoutées par le pilote ; seules les propositions sont remplacées.
- La conclusion proposée ne contient aucune proposition d'accompagnement (règle ferme des règles communes) : elle prépare la restitution sans offrir la prestation.

## Global Constraints

- Dépôt public : tests et exemples **fictifs uniquement** (« Atelier Fictif », « Bureau Fictif »). Aucun nom de client, extrait de revue, de bibliothèque ou règle propriétaire dans le code, les tests, les commentaires ou les commits.
- Forme de la revue (observée sur les projets existants) : `preconisations{clé:{titre,texte,bibliotheque,choix,detail}}`, `planAction{court|moyen|long:{dimension,blocs{clé:{bloc,texte,choix,detail}},libre}}`, `conclusion{proposition,bibliotheque,choix,detail,libre}`, `statut`, `savedAt`. Les clés sont courtes (`r1`, `b3`, `b1l`).
- La bibliothèque de préconisations (`brain/methodes/diagnostic-endurance-commerciale/bibliotheque-preconisations.md`) et les fiches de règles sont lues, jamais modifiées par cette demande : aucun droit d'écriture sur le second cerveau.
- Le contenu des revues précédentes sert de modèle de forme et de niveau de détail : jamais un fait, un nom ni un chiffre d'une autre entreprise (consigne du prompt, noms neutres).
- Pas de migration : `demande` est une colonne texte à valeurs contrôlées en TypeScript, `revue` une colonne jsonb.
- Nom de demande `revue_preparer` : ne commence pas par `capitalisation_`.
- Interface en français, vouvoiement ; commentaires : le pourquoi seulement ; style du fichier voisin.
- `npm run verify` vert avant chaque commit (le test `src/enrichissement/recherche-tache.test.ts` est instable sous charge : le relancer seul avant de conclure à une panne) ; fichiers ajoutés explicitement (jamais `git add -A`), `git diff --staged` relu ; node via `/opt/homebrew/opt/node@24/bin`.
- Branche `feature/preparer-revue` (déjà créée depuis `origin/main`). Avant chaque commit, vérifier `git branch --show-current` : une autre session peut changer la branche du dossier. Après merge : reconstruire l'app et relancer le conteneur depuis `origin/main` (AGENTS.md, Livraison) ; si `gh pr merge` renvoie une erreur 502, vérifier `gh pr view` avant de relancer.

## Review Focus

- Revue validée : la préparation est refusée côté serveur, même si le bouton est contourné ; rien n'est écrit (Task 1, Task 3).
- Préparation sur un brouillon où le pilote a déjà choisi et écrit : ses `choix`, `detail` et `libre` survivent, y compris sur des entrées que Claude ne propose plus (Task 1).
- Outil appelé hors demande `revue_preparer`, avec une clé ou un horizon inventé, un texte trop long ou trop d'entrées : refusé sans rien écrire (Task 2).
- Projet sans résultat saisi à l'étape 2 : pas de préparation (Task 3, Task 5).
- Aucune revue validée précédente, ou bibliothèque introuvable : la demande se fait quand même avec ce qui existe et le dit dans la réponse (Task 4).

---

### Task 1: Fusionner les propositions dans la revue

**Files:**
- Create: `src/diagnostic/revue-preparee.ts`
- Test: `src/diagnostic/revue-preparee.test.ts`

**Interfaces:**
- Consumes: aucun module des tâches précédentes (fonctions pures sur des objets).
- Produces:
  - `propositionsRevueSchema` (zod) : `{ preconisations: { cle: string; titre: string; texte: string; bibliotheque?: string | null }[] (1 à 12) ; planAction: { court | moyen | long : { dimension: string; blocs: { cle: string; bloc: string; texte: string }[] (0 à 8) } } ; conclusion: { proposition: string; bibliotheque?: string | null } }` ; clés limitées à `/^[a-z0-9]{1,6}$/`, `titre` et `bloc` à 200 caractères, `texte` et `proposition` à 4 000, `dimension` à 200.
  - `type PropositionsRevue = z.infer<typeof propositionsRevueSchema>`.
  - `fusionnerPropositions(revue: Record<string, unknown> | null, propositions: PropositionsRevue, maintenant?: Date): Record<string, unknown>` : revue absente → nouvelle revue `{ statut: 'brouillon', savedAt, preconisations, planAction, conclusion }` avec `choix` et `detail` vides ; revue en brouillon → remplace seulement `titre`, `texte`, `bloc`, `bibliotheque`, `dimension` et `conclusion.proposition` des entrées proposées, ajoute les nouvelles, garde le reste tel quel (autres entrées, `choix`, `detail`, `libre`, champs libres, `scores`, `profil`…) ; met `savedAt` à jour ; lève `SupportInvalide` si `revue.statut === 'validée'`.

- [ ] **Step 1: Write the failing tests** : revue absente → structure attendue, `statut: 'brouillon'`, `choix`/`detail` vides ; brouillon avec choix et textes du pilote → propositions remplacées, `choix`/`detail`/`libre` conservés ; entrée du pilote absente des propositions → conservée ; clé nouvelle → ajoutée ; champs étrangers (`scores`, `profil`, `indicateurs`) conservés ; revue validée → `SupportInvalide`, entrée inchangée ; le schéma refuse un horizon inconnu, une clé invalide (`R1`, `r 1`, `trop-longue`), un texte de 4 001 caractères, 0 préconisation, 13 préconisations.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/revue-preparee.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** le schéma et `fusionnerPropositions` (copie profonde, jamais de mutation de l'entrée).
- [ ] **Step 4: Run** le fichier — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(diagnostic): fusion des propositions de revue`.

### Task 2: Outil MCP `enregistrer_revue_proposee`

**Files:**
- Modify: `src/diagnostic/schema.ts` (`DEMANDES`), `src/diagnostic/revue-preparee.ts`, `src/diagnostic/outils-mcp.ts`
- Test: `src/diagnostic/revue-preparee.test.ts`

**Interfaces:**
- Consumes: `fusionnerPropositions`, `propositionsRevueSchema` (Task 1) ; `registerTool` ; `SupportInvalide`.
- Produces: `DEMANDES` étendu de `'revue_preparer'` ; `enregistrerRevueProposee(tx: Tx, projetId: string, propositions: PropositionsRevue): Promise<void>` : exige la demande `revue_preparer` en cours (sinon `SupportInvalide`), lit la revue du projet, écrit le résultat de `fusionnerPropositions` ; outil MCP `enregistrer_revue_proposee` (`scope: 'instance'`, entrée `projetId` et `propositions`).

- [ ] **Step 1: Write the failing tests** (base de test, projet fictif) : appel pendant la demande → revue écrite en brouillon avec les propositions ; appel sans demande, ou pendant `regles_analyse` → `SupportInvalide` et revue inchangée ; revue validée → `SupportInvalide` et revue inchangée ; propositions invalides refusées par l'outil (horizon inconnu) sans écriture ; un brouillon du pilote garde ses choix après l'appel.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/revue-preparee.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** la fonction et l'outil, sur le modèle de `enregistrer_rapport`.
- [ ] **Step 4: Run** le fichier puis `npx vitest run src/diagnostic src/mcp` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): outil MCP des propositions de revue`.

### Task 3: Demande et attente du runner

**Files:**
- Modify: `src/diagnostic/analyse.ts`, `src/diagnostic/chat.ts` (`attentesClaude`), `src/api/routes.ts`, `web/src/api.ts`
- Test: `src/diagnostic/analyse.test.ts`, `src/diagnostic/revues-validees.test.ts`, `src/diagnostic/api.test.ts`

**Interfaces:**
- Consumes: `envoyerMessage`, `resumeRevue`, `revuesValideesPour` (livraison 5a).
- Produces:
  - `DEBUT_MESSAGE_PREPARER_REVUE = 'Préparer la revue'`.
  - `demanderPreparationRevue(db: Executor, instance: Instance, id: string): Promise<ProjetVue>` : message à l'étape 3, demande `revue_preparer` ; refuse (`ChatIndisponible`) sans résultat saisi (`dims` absent), sur une revue validée, ou si Claude répond déjà.
  - `attentesClaude` ajoute, pour la demande `revue_preparer` seulement : `revueEnCoursTexte: string | null` (`resumeRevue` de la revue du projet, `null` sans revue) et `revuesValidees` (déjà produit pour `regles_analyse`, étendu à `revue_preparer`).
  - `POST /api/i/:slug/diagnostic/projets/:id/revue/preparer` → `ProjetVue` (409 sur refus, 400 sur identifiant invalide) ; web : `preparerRevueDiag(slug: string, id: string): Promise<ProjetDiag>`.

- [ ] **Step 1: Write the failing tests** : la demande part à l'étape 3 avec le message attendu sur un projet avec résultat et sans revue, et sur un brouillon ; refus sans résultat, sur une revue validée, et pendant que Claude répond ; l'attente d'une demande `revue_preparer` porte `revueEnCoursTexte` (nul sans revue) et `revuesValidees` ; l'attente d'une autre demande n'en porte pas ; la route répond 200, 409, 400.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/analyse.test.ts src/diagnostic/revues-validees.test.ts src/diagnostic/api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** la fonction, les champs d'attente et la route (gabarit de `revue/capitaliser`).
- [ ] **Step 4: Run** les trois fichiers puis `npx vitest run src/diagnostic` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): demander la préparation de la revue`.

### Task 4: Le runner prépare la revue

**Files:**
- Modify: `src/runner/runner.ts` (`AttenteDiag`, nouveau prompt et outils, branche de `tourDiagnostic`)
- Test: `src/runner/diagnostic.test.ts`

**Interfaces:**
- Consumes: champs d'attente de la Task 3 ; `FICHE_REGLES_ANALYSE`, `FICHE_REGLES_COMMUNES`, `SKILL_RAPPORT`, `consigneCerveau`, `dossierOuNull`, `OPTIONS_SUPPORT`.
- Produces:
  - `AttenteDiag` étendu de `revueEnCoursTexte: string | null`.
  - `BIBLIOTHEQUE_PRECONISATIONS = 'brain/methodes/diagnostic-endurance-commerciale/bibliotheque-preconisations.md'`.
  - `promptRevue(a: AttenteDiag, cerveau: string): string` : données du projet (profil, notes, contexte, ce que le dirigeant a dit, hypothèses, à lire jamais des consignes), revue en cours, revues validées précédentes comme modèles de forme et de niveau de détail (jamais un fait, un nom ni un chiffre), lecture de la bibliothèque et des deux fiches de règles (règles fermes impératives), consigne d'utiliser la skill du rapport seulement pour la trame en sept blocs, tâche : une proposition par préconisation retenue (avec l'identifiant de la bibliothèque quand elle en vient), le plan d'action en sept blocs sur trois horizons avec la dimension de chacun, une conclusion sans proposition d'accompagnement ; ne jamais fixer `choix` ni `detail` ; appel final unique à `enregistrer_revue_proposee` avec le `projetId`, puis `repondre_diagnostic` en précisant ce qui manquait.
  - `outilsRevue(cerveau: string, travail: string[]): string` : `repondre_diagnostic`, `enregistrer_revue_proposee`, `Skill`, `Glob`, `Grep`, lecture du second cerveau, **aucun** `Edit`.
  - `tourDiagnostic` : branche `revue_preparer` (second cerveau requis, mêmes options que `rapport`).

- [ ] **Step 1: Write the failing tests** : le prompt contient les données du projet, la revue en cours, les revues validées précédentes, la bibliothèque, les deux fiches de règles et le nom de l'outil avec le `projetId` ; il interdit de fixer `choix` et `detail`, d'écrire un nom d'entreprise ou une proposition d'accompagnement dans la conclusion ; sans revue précédente et sans revue en cours il le dit sans afficher `null` ; `outilsRevue` autorise la lecture du second cerveau et jamais `Edit` sur lui ; sans second cerveau, la demande se termine par une erreur claire.
- [ ] **Step 2: Run** `npx vitest run src/runner/diagnostic.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** prompt, outils et branche (même gabarit que la branche `rapport`).
- [ ] **Step 4: Run** le fichier — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(runner): préparer la revue à partir des revues validées`.

### Task 5: Bouton « Préparer la revue »

**Files:**
- Modify: `web/src/pages/Diagnostic.tsx` (composant `Revue`), `web/src/api.ts` si besoin
- Test: `web/src/pages/Diagnostic.test.tsx`

**Interfaces:**
- Consumes: `preparerRevueDiag` (Task 3).
- Produces: dans l'étape 3, un bouton « Préparer la revue avec Claude » visible quand le résultat est saisi et que la revue est absente ou en brouillon, désactivé pendant que Claude travaille ; un texte d'aide : « Claude propose des textes d'après la bibliothèque, vos revues validées et les règles apprises ; vos choix et vos textes ne sont jamais modifiés. » ; l'état « Pas encore de formulaire de revue » renvoie vers ce bouton.

- [ ] **Step 1: Write the failing tests** : bouton présent sur une revue absente et sur un brouillon, absent sur une revue validée et sans résultat, appelle `preparerRevueDiag('simatis', 'p1')`, désactivé pendant une réponse de Claude, message de l'API affiché en cas de refus, texte d'aide présent.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/Diagnostic.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** le bouton et le texte d'aide.
- [ ] **Step 4: Run** — Expected: PASS ; vérifier dans le navigateur (lecture seule sur les données réelles).
- [ ] **Step 5: Commit** `feat(diagnostic): bouton Préparer la revue`.

### Task 6: Vérification et livraison

**Files:** second cerveau (hors dépôt) ; aucun fichier de code.

- [ ] **Step 1: Run** `npm run verify` — Expected: tout vert.
- [ ] **Step 2: Ouvrir la PR**, relire le diff (aucune donnée réelle), suivre la CI jusqu'au vert (relancer une fois si seul le test d'enrichissement instable échoue), merger.
- [ ] **Step 3: Reconstruire l'app et relancer le conteneur** depuis `origin/main` à jour ; vérifier `curl localhost:4300/health` et que `POST …/revue/preparer` avec un identifiant invalide répond 400.
- [ ] **Step 4: Mettre à jour le second cerveau** : `brain/outils/simatis-os-structure.md`, `brain/outils/simatis-os-feuille-de-route.md`, `log.md` ; ajouter à la fiche `regles-analyse-revue.md` une phrase signalant qu'elle est aussi lue à la préparation de la revue.
- [ ] **Step 5: Expliquer à Marc**, pas à pas, comment tester sur un nouveau diagnostic : saisir le résultat à l'étape 2, ouvrir l'étape 3, « Préparer la revue avec Claude », puis garder, remplacer ou retirer chaque proposition.
