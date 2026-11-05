# Règles d'analyse : capitalisation à la validation de la revue (livraison 5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand le pilote valide la revue d'un diagnostic (étape 3), Claude compare ce que l'OS proposait à ce que le pilote a choisi et écrit, met à jour une fiche de règles d'analyse dans le second cerveau, et déclare ses changements au journal existant.

**Architecture:** La version finale d'une analyse est la revue validée (`revue.statut = 'validée'`, déjà gérée par l'écran). La validation lance une demande `regles_analyse` : Claude reçoit un résumé lisible de la revue validée (propositions de la bibliothèque, choix « garder / remplacer / retirer », textes du pilote, plan d'action, champs libres) et des deux dernières revues validées des autres projets, puis met à jour la fiche des règles d'analyse et les règles communes. Le journal « Règles apprises » et l'annulation existent déjà.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres), zod, vitest, React, MCP interne.

**Spec:** `docs/superpowers/specs/2026-11-05-rapport-versions-finales-design.md` (livraison 5). Livraisons 1 à 4 déjà mergées.

**Suite :** la livraison 5b (bouton « Préparer la revue » où Claude pré-remplit préconisations et plan d'action à partir de la bibliothèque, des deux dernières revues validées et des règles d'analyse) aura son propre plan, écrit après celui-ci.

## Global Constraints

- Dépôt public : tests et exemples **fictifs uniquement** (« Atelier Fictif », « Bureau Fictif »). Aucun nom de client, extrait de revue ou règle propriétaire dans le code, les tests, les commentaires ou les commits.
- Mêmes règles du jeu que pour le rapport et le support : règle ferme = constatée sur au moins 2 revues validées ou donnée par Marc ; une observation n'est jamais appliquée d'office ; une règle contredite est **signalée**, jamais supprimée ; un libellé de journal est une consigne générique de 200 caractères au plus, sans nom d'entreprise.
- Fiche du second cerveau : `brain/methodes/diagnostic-endurance-commerciale/regles-analyse-revue.md` (à créer, Task 6). Le runner n'écrit que dans le dossier `brain/methodes/diagnostic-endurance-commerciale`.
- Nom de demande `regles_analyse` : ne commence pas par `capitalisation_`.
- La bibliothèque générique de préconisations reste alimentée par la skill de capitalisation existante, qui n'est ni remplacée ni modifiée. Les règles d'analyse portent sur la manière de retenir, corriger et formuler, pas sur le contenu des préconisations.
- Pas de migration : `fiche` et `demande` sont des colonnes texte à valeurs contrôlées en TypeScript.
- Interface en français, vouvoiement ; commentaires : le pourquoi seulement ; style du fichier voisin.
- `npm run verify` vert avant chaque commit (le test `src/enrichissement/recherche-tache.test.ts` est instable sous charge : le relancer seul avant de conclure à une panne) ; fichiers ajoutés explicitement (jamais `git add -A`), `git diff --staged` relu ; node via `/opt/homebrew/opt/node@24/bin`.
- Branche `feature/regles-analyse-revue` (déjà créée depuis `origin/main`). Avant chaque commit, vérifier `git branch --show-current` : une autre session peut changer la branche du dossier. Après merge : reconstruire l'app et relancer le conteneur depuis `origin/main` (AGENTS.md, Livraison).

## Review Focus

- Revue sans aucune préconisation, ou dont les champs `choix` et `detail` sont vides : le résumé le dit, aucun `null` ni `undefined` dans le prompt (Task 2, Task 4).
- Revue validée, modifiée (retour en brouillon), puis revalidée : une nouvelle capitalisation part à la seconde validation, pas à la modification (Task 3).
- Une mise à jour du projet qui ne touche pas la revue, ou qui garde une revue déjà validée, ne lance rien (Task 3).
- Validation pendant que Claude répond déjà : la revue reste validée, aucune erreur bloquante, bouton de relance (Task 3, Task 5).
- Revue validée sans texte proposé (projet saisi à la main) : comparée seulement aux autres revues, sans inventer de proposition (Task 2, Task 4).

---

### Task 1: Journal et outil ouverts aux règles d'analyse

**Files:**
- Modify: `src/diagnostic/schema.ts` (`DEMANDES`, `FICHES_REGLES`), `src/diagnostic/regles.ts`
- Test: `src/diagnostic/regles.test.ts`

**Interfaces:**
- Consumes: `enregistrerReglesRapport`, `ChangementRegle`, `FicheRegles` (livraisons 3 et 4).
- Produces: `DEMANDES` étendu de `'regles_analyse'` ; `FICHES_REGLES = ['rapport', 'communes', 'support', 'analyse']` ; `enregistrerReglesRapport` accepte aussi la demande `regles_analyse` (origine du journal : `analyse validée`) ; la description de l'outil MCP cite les règles d'analyse.

- [ ] **Step 1: Write the failing tests** : changement de fiche `analyse` pendant une demande `regles_analyse` → entrée créée avec `origine === 'analyse validée'` ; refus sans aucune des demandes de règles (`SupportInvalide`) ; les tests existants du rapport et du support restent verts.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/regles.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : élargir la vérification de demande, l'origine selon la demande, l'énumération des fiches.
- [ ] **Step 4: Run** le fichier — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(diagnostic): journal des règles ouvert à l'analyse`.

### Task 2: Résumé des revues validées et attente du runner

**Files:**
- Create: `src/diagnostic/revues-validees.ts`
- Modify: `src/diagnostic/chat.ts` (`attentesClaude`)
- Test: `src/diagnostic/revues-validees.test.ts`

**Interfaces:**
- Consumes: `diagnosticProjets.revue` (jsonb : `statut`, `savedAt`, `preconisations{clé:{titre,texte,choix,detail}}`, `planAction{court|moyen|long:{blocs{clé:{bloc,texte,choix,detail}},libre}}`, `conclusion{texte|proposition,choix,detail,libre}`, `indicateurs`, `nonFait`, `preconisationAutre`).
- Produces:
  - `resumeRevue(revue: Record<string, unknown>): string` : texte lisible, une ligne par entrée (« Préconisation <titre> — proposé : … — choix : garder|remplacer|retirer|non précisé — texte du pilote : … »), le plan d'action par horizon, la conclusion et les champs libres ; `(aucune préconisation)` quand il n'y en a pas ; jamais `null` ni `undefined` ; tronqué à 30 000 caractères.
  - `revuesValideesPour(db: Executor, instance: Instance, projetId: string): Promise<{ nom: string; texte: string }[]>` : au plus deux, du plus récent au plus ancien par `revue.savedAt`, projets de l'instance autres que `projetId`, `revue.statut === 'validée'` ; `nom` neutre (`Revue validée 1`, `Revue validée 2`).
  - `attentesClaude` ajoute `revueValideeTexte: string | null` (résumé de la revue du projet courant, seulement pour `regles_analyse`) et `revuesValidees: { nom: string; texte: string }[]` (seulement pour `regles_analyse`).

- [ ] **Step 1: Write the failing tests** (revues fictives) : `resumeRevue` rend propositions, choix et textes du pilote pour des préconisations, des blocs de plan et la conclusion ; une revue vide donne `(aucune préconisation)` ; des champs absents ou non texte ne produisent ni `null` ni `undefined` ; `revuesValideesPour` renvoie les deux plus récentes hors projet courant, ignore une revue en brouillon ou absente ; l'attente d'une demande `regles_analyse` porte les deux champs, une autre demande non.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/revues-validees.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** le module et les champs d'attente.
- [ ] **Step 4: Run** le fichier puis `npx vitest run src/diagnostic` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): joindre les revues validées à la demande du runner`.

### Task 3: Capitaliser à la validation de la revue

**Files:**
- Modify: `src/diagnostic/service.ts` ou un nouveau `src/diagnostic/analyse.ts`, `src/api/routes.ts`
- Test: `src/diagnostic/analyse.test.ts`, `src/diagnostic/api.test.ts`

**Interfaces:**
- Consumes: `envoyerMessage`, `ChatIndisponible`, `updateProjet`.
- Produces:
  - `DEBUT_MESSAGE_REGLES_ANALYSE = 'Capitaliser l’analyse validée'`.
  - `demanderCapitalisationAnalyse(db: Executor, instance: Instance, id: string): Promise<ProjetVue>` : message à l'étape 3, demande `regles_analyse` ; refuse (`ChatIndisponible`) si `revue.statut !== 'validée'`, ou si Claude répond déjà.
  - `revueVientDEtreValidee(avant: unknown, apres: unknown): boolean` : vrai seulement quand le statut passe d'autre chose à `validée`.
  - la route `PATCH /api/i/:slug/diagnostic/projets/:id` lit le statut de la revue avant la mise à jour et, si `revueVientDEtreValidee`, lance `demanderCapitalisationAnalyse` en ignorant `ChatIndisponible` ; elle renvoie la vue la plus récente.
  - `POST /api/i/:slug/diagnostic/projets/:id/revue/capitaliser` → `ProjetVue` (409 sur refus, 400 sur identifiant invalide) ; web : `capitaliserAnalyseDiag(slug: string, id: string): Promise<ProjetDiag>`.

- [ ] **Step 1: Write the failing tests** : `revueVientDEtreValidee` pour brouillon→validée (vrai), validée→validée (faux), validée→brouillon (faux), absente→validée (vrai), absente→absente (faux) ; `demanderCapitalisationAnalyse` lance la demande à l'étape 3 sur une revue validée, refuse sur un brouillon ou une revue absente, et pendant que Claude répond ; API : un `PATCH` qui valide la revue lance la demande, un `PATCH` qui garde la revue validée ou qui change autre chose ne lance rien, un `PATCH` qui valide pendant que Claude répond garde la revue validée sans erreur ; la route `revue/capitaliser` répond 200, 409, 400.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/analyse.test.ts src/diagnostic/api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les fonctions et la route (gabarit de `rapport/capitaliser`) ; le service `updateProjet` ne change pas.
- [ ] **Step 4: Run** les deux fichiers puis `npx vitest run src/diagnostic` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): capitaliser l'analyse à la validation de la revue`.

### Task 4: Le runner capitalise les règles d'analyse

**Files:**
- Modify: `src/runner/runner.ts` (`AttenteDiag`, nouveau prompt, `promptRapport`, `promptAnnulerRegle`, branche de `tourDiagnostic`)
- Test: `src/runner/diagnostic.test.ts`

**Interfaces:**
- Consumes: champs d'attente de la Task 2 ; `outilsRegles`, `FICHE_REGLES_COMMUNES`, `OPTIONS_SUPPORT`.
- Produces:
  - `AttenteDiag` étendu de `revueValideeTexte` et `revuesValidees`.
  - `FICHE_REGLES_ANALYSE = 'brain/methodes/diagnostic-endurance-commerciale/regles-analyse-revue.md'`.
  - `promptReglesAnalyse(a: AttenteDiag): string` : résumé de la revue validée, revues validées précédentes, fiches à lire, mêmes règles du jeu que `promptReglesRapport`, avec la méthode propre à l'analyse (ce que le pilote garde, remplace ou retire par type d'entrée ; niveau de détail de ses textes ; ce qu'il ajoute dans les champs libres ; ce qui change entre les horizons du plan d'action), appel final unique à `enregistrer_regles_rapport` (fiche « analyse » ou « communes »).
  - `promptAnnulerRegle` : une règle de la fiche `analyse` cite `FICHE_REGLES_ANALYSE`.
  - `promptRapport` lit aussi `FICHE_REGLES_ANALYSE` (règles fermes impératives).
  - `tourDiagnostic` : branche `regles_analyse` (second cerveau requis, `outilsRegles`, mêmes options que `regles_rapport`).

- [ ] **Step 1: Write the failing tests** : `promptReglesAnalyse` contient le résumé validé, les revues précédentes, les chemins des deux fiches, la règle des deux constats, la signalisation des contradictions, l'interdiction de tout nom d'entreprise, l'appel à `enregistrer_regles_rapport` avec le `projetId`, et la mention « fiche « analyse » » ; sans revue précédente, il le dit sans afficher `null` ; sans texte proposé dans le résumé, il demande de comparer seulement aux autres revues ; `promptAnnulerRegle` cite `FICHE_REGLES_ANALYSE` pour la fiche `analyse` ; `promptRapport` cite `FICHE_REGLES_ANALYSE`.
- [ ] **Step 2: Run** `npx vitest run src/runner/diagnostic.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** prompts et branche (même gabarit que `regles_support`).
- [ ] **Step 4: Run** le fichier — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(runner): règles d'analyse de la revue`.

### Task 5: Écran de la revue

**Files:**
- Modify: `web/src/api.ts`, `web/src/pages/Diagnostic.tsx` (composant `Revue`, noms de fiches du journal)
- Test: `web/src/pages/Diagnostic.test.tsx`

**Interfaces:**
- Consumes: `capitaliserAnalyseDiag` (Task 3) ; `NOMS_FICHES_REGLES` (livraison 4).
- Produces: dans l'étape 3, un bouton « Capitaliser cette analyse » visible quand la revue est validée, désactivé pendant que Claude travaille ; le journal nomme la fiche `analyse` « règles d'analyse » ; `EntreeReglesDiag.fiche` accepte `'support' | 'analyse'`.

- [ ] **Step 1: Write the failing tests** : le bouton est absent sur une revue en brouillon ou absente, actif sur une revue validée, désactivé pendant une réponse de Claude, et appelle `capitaliserAnalyseDiag('simatis', 'p1')` ; le message de l'API s'affiche en cas de refus ; une entrée de journal de fiche `analyse` s'affiche avec « règles d'analyse ».
- [ ] **Step 2: Run** `npx vitest run web/src/pages/Diagnostic.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** le bouton (le composant `Revue` reçoit les rappels `onChange` et `onErreur`) et le libellé de fiche.
- [ ] **Step 4: Run** — Expected: PASS ; vérifier dans le navigateur (lecture seule sur les données réelles).
- [ ] **Step 5: Commit** `feat(diagnostic): écran des règles d'analyse`.

### Task 6: Fiche d'analyse, vérification et livraison

**Files:** second cerveau (hors dépôt) ; aucun fichier de code.

- [ ] **Step 1: Créer** `brain/methodes/diagnostic-endurance-commerciale/regles-analyse-revue.md` dans le second cerveau, sur le gabarit de `regles-support-ouverture.md` (mode d'emploi, règles fermes, observations, journal), vide au départ ; la lier depuis la fiche méthode, `amelioration-continue.md`, `bibliotheque-preconisations.md` (renvoi : la bibliothèque porte le contenu, cette fiche la manière de l'adapter) et `regles-communes-diagnostic.md`, et ajouter une entrée datée au `log.md`.
- [ ] **Step 2: Run** `npm run verify` — Expected: tout vert.
- [ ] **Step 3: Ouvrir la PR**, relire le diff (aucune donnée réelle), suivre la CI jusqu'au vert (relancer une fois si seul le test d'enrichissement instable échoue), merger.
- [ ] **Step 4: Reconstruire l'app et relancer le conteneur** depuis `origin/main` à jour ; vérifier `curl localhost:4300/health` et que `POST …/revue/capitaliser` sur un projet sans revue validée répond 409.
- [ ] **Step 5: Mettre à jour le second cerveau** : `brain/outils/simatis-os-structure.md`, `brain/outils/simatis-os-feuille-de-route.md`, `log.md`.
- [ ] **Step 6: Expliquer à Marc**, pas à pas, comment tester : revue d'un projet, « Capitaliser cette analyse », ouvrir « Règles apprises » ; puis valider la revue d'un nouveau projet et voir la capitalisation partir d'elle-même.
