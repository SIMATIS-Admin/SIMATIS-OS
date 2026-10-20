# Diagnostic : import du PDF de l'outil et calcul du profil : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** À l'étape 2 d'un projet de diagnostic, Marc importe le PDF de l'outil externe ; Claude en lit les réponses, l'OS calcule les trois dimensions et le profil avec la grille de scoring, et une réponse corrigée recalcule le profil.

**Architecture:** Même mécanisme que le rapport : une demande `entretien` au runner, qui lit le PDF (copié dans son dossier de travail) et enregistre les réponses par un outil MCP. Le calcul est une fonction pure en code, avec une grille JSON chargée depuis le second cerveau (chemin en variable d'environnement). La saisie manuelle des trois notes reste en secours.

**Tech Stack:** TypeScript, Fastify, Drizzle (PostgreSQL), Zod, Vitest (base réelle via `setupTestApp`), React + Vite (tests jsdom + Testing Library), Python 3 standard library pour l'export de la grille (sans dépendance).

**Spec:** [docs/superpowers/specs/2026-10-20-diagnostic-pdf-profil-design.md](../specs/2026-10-20-diagnostic-pdf-profil-design.md)

## Global Constraints

- PDF : 10 Mo au plus, une fois décodé ; le fichier doit commencer par `%PDF`.
- Lettres de réponse : `A`, `B`, `C`, `D`, `E`, `N/A` ; notes A=10, B=7, C=4, D=1, E=0 ; « N/A » exclu du numérateur et du dénominateur.
- Seuil de passage : 6/10, lu dans la grille (`seuil`).
- Une question est identifiée par la paire (`section`, `numero`) : les numéros se répètent d'une rubrique à l'autre.
- Le calcul se fait en code (jamais par Claude). Claude ne fait que lire le PDF et rendre les réponses.
- La grille (libellés, poids) et les PDF réels ne sont jamais dans le dépôt : tests et exemples avec des données fictives.
- Toute nouvelle variable d'environnement (`DIAGNOSTIC_GRILLE`) va dans `.env.example`, sans valeur.
- Aucun commit sans `npm run verify` vert.

## Review Focus

1. **Numéros de question répétés entre rubriques** (ex. « 6 » en marketing et en direction) : deux réponses de même numéro dans deux rubriques comptent chacune. Test dans Task 1 (chargement) et Task 2 (calcul).
2. **PDF incomplet** (une question de la grille sans réponse) : l'import est refusé et la liste des questions manquantes est donnée ; aucun profil n'est écrit. Test dans Task 2 et Task 4.
3. **Dimension entière en « N/A »** : le calcul refuse explicitement, aucune note n'est inventée. Test dans Task 2 ; et une correction qui vide une dimension est refusée. Test dans Task 4.
4. **Correction dans les deux sens** : passer d'une réponse à une autre fait monter ou descendre le profil, et l'historique garde l'ancienne valeur. Test dans Task 4.
5. **Fichier qui n'est pas un PDF, trop lourd, ou grille absente** : refusé avec un message clair, sans demande au runner. Test dans Task 4.

---

### Task 1: Grille de scoring : chargement et validation

**Files:**
- Create: `src/diagnostic/grille.ts`
- Create: `src/diagnostic/grille.test.ts`
- Create: `src/diagnostic/fixtures/grille-fictive.json`
- Create: `scripts/diagnostic/exporter_grille.py`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `export type Dimension = 'outils' | 'strategie' | 'polyvalence'`
  - `export const LETTRES = ['A', 'B', 'C', 'D', 'E', 'N/A'] as const` ; `export type Lettre = (typeof LETTRES)[number]`
  - `export type QuestionGrille = { section: string; numero: number; libelle: string; dimension: Dimension; poids: number }`
  - `export type Grille = { seuil: number; questions: QuestionGrille[] }`
  - `export class GrilleInvalide extends Error {}`
  - `export function chargerGrille(chemin: string): Grille` : lit le JSON, valide, lève `GrilleInvalide` (message en français) si le fichier manque, est illisible, a une question en double (même `section` + `numero`), un poids ≤ 0, ou une dimension inconnue.
  - `export function cleQuestion(q: { section: string; numero: number }): string` : renvoie `` `${q.section}#${q.numero}` ``.
- Format JSON attendu : `{ "seuil": 6, "questions": [{ "section", "numero", "libelle", "dimension", "poids" }] }`.

- [ ] **Step 1: Écrire les tests** dans `grille.test.ts` : charge `fixtures/grille-fictive.json` (3 questions fictives, dont deux de même `numero` dans deux `section` différentes) ; charger un chemin absent lève `GrilleInvalide` ; une question en double (même section et numéro) lève `GrilleInvalide` ; une dimension `'autre'` lève `GrilleInvalide`.

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run src/diagnostic/grille.test.ts`
Expected: FAIL (module `./grille.js` absent).

- [ ] **Step 3: Implémenter `grille.ts`** avec Zod (`z.object` pour le fichier, `superRefine` pour les doublons). `chargerGrille` lit le fichier avec `readFileSync` en UTF-8.

- [ ] **Step 4: Lancer les tests, vérifier le succès.**

- [ ] **Step 5: Écrire `scripts/diagnostic/exporter_grille.py`** : lit l'onglet « Grille de scoring » du classeur `.xlsx` avec la bibliothèque standard seulement (`zipfile` + `xml.etree`) ; colonnes A (Dimension), B (Section), C (N°), D (Question), E (Poids) ; traduit les dimensions (`Outils & Méthode` → `outils`, `Stratégie, régularité & endurance` → `strategie`, `Polyvalence` → `polyvalence`) ; écrit le JSON au chemin passé en argument, seuil 6. Usage : `python3 scripts/diagnostic/exporter_grille.py CHEMIN.xlsx SORTIE.json`.

- [ ] **Step 6: Vérifier le script sans données réelles** : Run: `python3 scripts/diagnostic/exporter_grille.py /chemin/inexistant.xlsx /tmp/grille.json`. Expected: échec avec un message clair (fichier introuvable), sans trace Python. Le vrai classeur n'est jamais utilisé dans le dépôt : son export est fait par Marc en Task 9, step 5.

- [ ] **Step 7: Commit** : `git commit -m "Diagnostic : grille de scoring, chargement et export"`.

---

### Task 2: Calcul des dimensions et du profil

**Files:**
- Create: `src/diagnostic/score.ts`
- Create: `src/diagnostic/score.test.ts`

**Interfaces:**
- Consumes: `Grille`, `Dimension`, `Lettre`, `cleQuestion` (Task 1) ; `Dimensions`, `Profil`, `profilDe` (`src/diagnostic/profil.ts`, existant).
- Produces:
  - `export const NOTES: Record<'A' | 'B' | 'C' | 'D' | 'E', number>` = `{ A: 10, B: 7, C: 4, D: 1, E: 0 }`
  - `export type ReponseQuestion = { section: string; numero: number; reponse: Lettre }`
  - `export class ScoreIncomplet extends Error {}`
  - `export function scorer(reponses: ReponseQuestion[], grille: Grille): { dims: Dimensions; profil: Profil }` : lève `ScoreIncomplet` avec un message en français si une question de la grille n'a pas de réponse (liste les libellés manquants), si une réponse n'est pas dans `LETTRES`, si une réponse porte sur une question absente de la grille, ou si une dimension n'a aucune réponse retenue (toutes « N/A »).

- [ ] **Step 1: Écrire les tests** `score.test.ts` avec une grille fictive inline (2 questions `outils`, 2 `strategie`, 1 `polyvalence`) :
  - moyenne pondérée : deux questions d'`outils` (poids 2 et 1, réponses A et C) donnent `(2*10 + 1*4) / 3 = 8`, soit `outils: 8` ;
  - « N/A » exclu : une question `N/A` ne compte ni au numérateur ni au dénominateur ;
  - question de même numéro dans deux rubriques : chacune compte (test avec `section` différentes) ;
  - question sans réponse : lève `ScoreIncomplet` dont le message contient le libellé ;
  - dimension entièrement en « N/A » : lève `ScoreIncomplet` ;
  - profil : `outils: 5` donne `profil: 'Joggeur'`.

- [ ] **Step 2: Lancer, vérifier l'échec** (`npx vitest run src/diagnostic/score.test.ts`).

- [ ] **Step 3: Implémenter `score.ts`.** Construire d'abord la table `cleQuestion → QuestionGrille`, puis parcourir les questions de la grille. Arrondir chaque dimension à 1 décimale avec `Math.round(x * 10) / 10` (les notes affichées en ont une).

- [ ] **Step 4: Lancer les tests, vérifier le succès.**

- [ ] **Step 5: Commit** : `git commit -m "Diagnostic : calcul des dimensions et du profil à partir des réponses"`.

---

### Task 3: Schéma et migration

**Files:**
- Modify: `src/diagnostic/schema.ts` (colonnes, `DEMANDES`)
- Create: `drizzle/0029_diagnostic_entretien.sql` (généré)
- Test: `src/diagnostic/service.test.ts` (un cas de lecture des nouvelles colonnes par défaut)

**Interfaces:**
- Consumes: rien.
- Produces:
  - `reponsesEntretien: jsonb<ReponseQuestion[]>`, défaut `[]`, colonne `reponses_entretien`
  - `pdfEntretien: text` nullable, colonne `pdf_entretien` (base64)
  - `pdfEntretienNom: text` nullable, colonne `pdf_entretien_nom`
  - `historiqueReponses: jsonb<{ question: string; ancienne: string; nouvelle: string; le: string }[]>`, défaut `[]`, colonne `historique_reponses` (`question` = `cleQuestion`)
  - `DEMANDES = ['preparer_support', 'support_final', 'rapport', 'entretien']`

- [ ] **Step 1: Écrire le test** dans `service.test.ts` : un projet créé a `reponsesEntretien` = `[]`, `pdfEntretien` = `null`, `historiqueReponses` = `[]`.

- [ ] **Step 2: Lancer, vérifier l'échec** (la colonne n'existe pas).

- [ ] **Step 3: Ajouter les colonnes** au `pgTable` de `diagnosticProjets`, après `rapportLiens`, et `'entretien'` à `DEMANDES`.

- [ ] **Step 4: Générer la migration** : `npx drizzle-kit generate --name diagnostic_entretien`. Vérifier que le SQL ne contient que les `ADD COLUMN` attendus.

- [ ] **Step 5: Lancer les tests, vérifier le succès**, puis `npm run verify`.

- [ ] **Step 6: Commit** : `git commit -m "Diagnostic : colonnes de l'entretien (réponses, PDF, historique)"`.

---

### Task 4: Service : import, enregistrement et correction

**Files:**
- Create: `src/diagnostic/entretien.ts`
- Create: `src/diagnostic/entretien.test.ts`
- Modify: `src/diagnostic/service.ts:ProjetVue` (exclure `pdfEntretien` de la vue, comme `rapport` et `logo`, et exposer `aPdfEntretien: boolean`)

**Interfaces:**
- Consumes: `chargerGrille`, `Grille`, `cleQuestion` (Task 1) ; `scorer`, `ScoreIncomplet`, `ReponseQuestion` (Task 2) ; `envoyerMessage`, `ChatIndisponible` (`chat.ts`) ; schéma (Task 3).
- Produces:
  - `export const PDF_MAX = 10 * 1024 * 1024`
  - `export function grilleCourante(): Grille` : charge `process.env.DIAGNOSTIC_GRILLE` (lève `GrilleInvalide` si la variable est absente, avec le message « DIAGNOSTIC_GRILLE non défini : l'import du PDF est indisponible. »).
  - `export function importerEntretien(db: Executor, instance: Instance, id: string, pdf: { nom: string; base64: string }): Promise<ProjetVue>` : refuse (`ChatIndisponible`) si le fichier n'est pas un PDF (décodé, commence par `%PDF`), s'il dépasse `PDF_MAX`, ou si la grille est absente. Sinon enregistre `pdfEntretien`/`pdfEntretienNom`, puis `envoyerMessage(..., { type: 'entretien', etape: 2, verifier: () => grilleCourante() })`.
  - `export function enregistrerReponses(tx: Tx, id: string, reponses: ReponseQuestion[]): Promise<void>` : vérifie `projet.demande === 'entretien'` (sinon `SupportInvalide`-like : lever `ChatIndisponible("Le pilote n'a pas demandé de lecture du PDF.")`), appelle `scorer`, puis pose `reponsesEntretien`, `dims`, et efface `demande`. (Le runner termine la demande via `finirAttente`.)
  - `export function corrigerReponse(db: Executor, instance: Instance, id: string, question: { section: string; numero: number }, reponse: Lettre): Promise<ProjetVue>` : refuse si le projet n'a pas encore de réponses ; remplace la réponse de cette question ; recalcule avec `scorer` (si `ScoreIncomplet`, rien n'est écrit et l'erreur remonte) ; ajoute `{ question: cleQuestion(question), ancienne, nouvelle, le }` à `historiqueReponses` ; met à jour `dims`.

- [ ] **Step 1: Écrire les tests** `entretien.test.ts` (base réelle, grille fictive écrite dans un fichier temporaire et pointée par `process.env.DIAGNOSTIC_GRILLE` dans `beforeAll`) :
  - PDF valide (`%PDF-1.4` encodé) : projet passe en demande `entretien`, `pdfEntretienNom` renseigné, `aPdfEntretien: true`, `etapeMessage` 2 ;
  - faux PDF (texte encodé sans `%PDF`) : refusé avec `ChatIndisponible`, aucune écriture ;
  - PDF de plus de 10 Mo : refusé ;
  - grille absente (variable effacée) : refusée avec le message « DIAGNOSTIC_GRILLE non défini ».
  - `enregistrerReponses` avec toutes les réponses : `dims` et profil corrects ; avec une question manquante : `ScoreIncomplet`, rien d'écrit.
  - `corrigerReponse` : passe de `E` à `A` sur une question, le profil monte (ex. d'un profil plus bas vers un profil plus haut), l'historique contient `ancienne: 'E'`, `nouvelle: 'A'` ; rendre une dimension entièrement « N/A » est refusé et ne change rien.

- [ ] **Step 2: Lancer, vérifier l'échec.**

- [ ] **Step 3: Implémenter `entretien.ts`.** Décoder le base64 avec `Buffer.from(base64, 'base64')` pour vérifier l'en-tête et la taille (taille décodée). Pour la taille, rejeter avant décodage si `base64.length > Math.ceil(PDF_MAX * 4 / 3) + 4`.

- [ ] **Step 4: Lancer les tests, vérifier le succès.** Puis `npm run verify`.

- [ ] **Step 5: Commit** : `git commit -m "Diagnostic : import du PDF, enregistrement et correction des réponses"`.

---

### Task 5: Outil MCP et permission du runner

**Files:**
- Modify: `src/diagnostic/outils-mcp.ts` (outil `enregistrer_reponses_entretien`, chaîne d'autorisation)
- Modify: `src/diagnostic/entretien.ts` (ajout de `autoriserSiEntretien`)
- Test: `src/diagnostic/entretien.test.ts`

**Interfaces:**
- Consumes: `enregistrerReponses` (Task 4) ; `autoriserSiRapport` (`rapport.ts`, existant) ; `Decision` (`support.ts`).
- Produces:
  - `export function autoriserSiEntretien(tx: Tx, outil: string, input: Record<string, unknown>): Promise<Decision | null>` : renvoie `null` si le travail en cours n'est pas une demande `entretien` ; sinon autorise `Read` (le PDF est dans le dossier de travail) et refuse tout le reste.
  - Outil MCP `enregistrer_reponses_entretien` : `{ projetId: uuid, reponses: { section: string (1..200), numero: int 1..999, reponse: enum(LETTRES) }[] (1..200 entrées) }`, `scope: 'instance'`.
  - Dans le handler `autoriser_outil` : chaîne `autoriserSiRapport` puis `autoriserSiEntretien` puis `autoriserOutil` (le premier qui renvoie une décision gagne).

- [ ] **Step 1: Écrire les tests** : `autoriserSiEntretien` autorise `Read`, refuse `Edit` et `Artifact`, renvoie `null` pour un projet sans demande `entretien`. `enregistrer_reponses_entretien` : la validation Zod refuse une lettre hors liste (test sur le schéma exporté `reponsesSchema`).

- [ ] **Step 2: Lancer, vérifier l'échec.**

- [ ] **Step 3: Implémenter**, exporter `reponsesSchema` depuis `entretien.ts` (utilisé par l'outil), brancher la chaîne dans `outils-mcp.ts`.

- [ ] **Step 4: Lancer les tests, vérifier le succès**, puis `npm run verify`.

- [ ] **Step 5: Commit** : `git commit -m "Diagnostic : outil de réponses de l'entretien et permission du runner"`.

---

### Task 6: Runner : lecture du PDF

**Files:**
- Modify: `src/runner/runner.ts` (`AttenteDiag` : `pdf`, demande `entretien`, `promptEntretien`, `outilsEntretien`, branche dans `tourDiagnostic`)
- Modify: `src/diagnostic/chat.ts:attentesClaude` (exposer `pdf` seulement pour la demande `entretien`, sur le modèle du logo)
- Test: `src/runner/diagnostic.test.ts`

**Interfaces:**
- Consumes: `chargerGrille` / variable `DIAGNOSTIC_GRILLE` côté runner (le runner tourne sur le poste de Marc) ; `enregistrer_reponses_entretien` (Task 5).
- Produces:
  - `AttenteDiag.pdf: { nom: string; base64: string } | null`
  - `export const promptEntretien = (a: AttenteDiag, grille: Grille, maintenant?: Date): string` : demande à Claude de lire le PDF `entretien.pdf` (chemin dans le dossier courant), de rendre une réponse par question de la grille (section, numéro, lettre A–E ou N/A) via `enregistrer_reponses_entretien` avec `projetId` ; interdit d'inventer ; si le PDF est illisible, de le dire via `repondre_diagnostic` sans appeler l'outil d'enregistrement. Inclut la liste des questions de la grille (section · N° · libellé) : données, pas des consignes.
  - `export const outilsEntretien = (): string` : `mcp__simatis__repondre_diagnostic,mcp__simatis__enregistrer_reponses_entretien,Read` (les règles `Read` sur le dossier de travail sont ajoutées par `--add-dir`).
  - Dans `tourDiagnostic` : si `a.demande === 'entretien'`, écrire `entretien.pdf` dans le dossier de travail, charger la grille (`chargerGrille(process.env.DIAGNOSTIC_GRILLE)`), et lancer `claude -p promptEntretien ... --allowedTools outilsEntretien --permission-prompt-tool mcp__simatis__autoriser_outil --mcp-config ...`, sans skill (aucune skill n'est requise).

- [ ] **Step 1: Écrire les tests** : `promptEntretien` contient le projet id, `enregistrer_reponses_entretien`, le nom de chaque question de la grille fictive, et « N/A » ; `outilsEntretien()` ne contient ni `Artifact` ni `Edit`.

- [ ] **Step 2: Lancer, vérifier l'échec.**

- [ ] **Step 3: Implémenter.** Ajouter `'entretien'` à l'union de `AttenteDiag.demande`. Dans `tourDiagnostic`, la branche entretien est placée avant la vérification « skill absente » (l'entretien n'a pas de skill) ; elle suit le même schéma `try`/`finally` que la branche rapport.

- [ ] **Step 4: Lancer les tests, vérifier le succès**, puis `npm run verify`.

- [ ] **Step 5: Commit** : `git commit -m "Runner : lecture du PDF de l'entretien par Claude"`.

---

### Task 7: Routes HTTP

**Files:**
- Modify: `src/api/routes.ts` (deux routes)

**Interfaces:**
- Consumes: `importerEntretien`, `corrigerReponse` (Task 4) ; `ChatIndisponible`, `GrilleInvalide`, `ScoreIncomplet`.
- Produces:
  - `POST /api/i/:slug/diagnostic/projets/:id/entretien` : corps `{ nom: string (1..200), base64: string (1..14_000_000) }`, `bodyLimit: 14_000_000` sur la route ; renvoie le projet ; 409 sur `ChatIndisponible`, 400 sur `GrilleInvalide` ou validation.
  - `POST /api/i/:slug/diagnostic/projets/:id/entretien/reponse` : corps `{ section: string, numero: number, reponse: Lettre }` ; renvoie le projet ; 409 sur `ChatIndisponible` et `ScoreIncomplet`.

- [ ] **Step 1: Écrire le test** : les routes ne sont pas testées en HTTP dans le dépôt (voir la décision de la livraison 2) ; vérifier par le typecheck et par le test de service (Task 4). Noter ce choix dans le journal.

- [ ] **Step 2: Implémenter** les deux routes sur le modèle de la route `support/:action`, avec `UUID.test(id)`.

- [ ] **Step 3: Lancer `npm run verify`.** Expected: vert.

- [ ] **Step 4: Commit** : `git commit -m "Diagnostic : routes d'import du PDF et de correction des réponses"`.

---

### Task 8: Interface de l'étape 2

**Files:**
- Modify: `web/src/api.ts` (type `ProjetDiag` : `aPdfEntretien`, `reponsesEntretien`, `historiqueReponses`, `demande` avec `'entretien'` ; `importerEntretienDiag`, `corrigerReponseDiag`)
- Modify: `web/src/pages/Diagnostic.tsx` (composant `Resultat` : zone d'import, état « Claude lit le PDF… », profil et notes par dimension, liste des réponses modifiables ; saisie manuelle conservée)
- Test: `web/src/pages/Diagnostic.test.tsx`

**Interfaces:**
- Consumes: routes (Task 7).
- Produces: `importerEntretienDiag(slug, id, { nom, base64 })`, `corrigerReponseDiag(slug, id, { section, numero, reponse })`.

- [ ] **Step 1: Écrire les tests** : un champ fichier accepte un PDF et appelle `importerEntretienDiag` avec le nom et le contenu base64 ; pendant `demande === 'entretien'`, « Claude lit le PDF… » est affiché ; avec des réponses, la liste affiche chaque question et une correction appelle `corrigerReponseDiag` ; la saisie manuelle reste présente.

- [ ] **Step 2: Lancer, vérifier l'échec** (`npx vitest run web/src/pages/Diagnostic.test.tsx`).

- [ ] **Step 3: Implémenter.** Lire le fichier avec `lireBase64` (existant pour le logo). Refuser côté interface un fichier de plus de 10 Mo avant envoi (message « PDF trop lourd (10 Mo au plus). »).

- [ ] **Step 4: Lancer les tests, vérifier le succès**, puis `npm run verify`. Vérifier aussi dans le navigateur l'étape 2 d'un projet fictif (zone d'import visible, saisie manuelle toujours présente).

- [ ] **Step 5: Commit** : `git commit -m "Diagnostic : import du PDF et réponses modifiables à l'étape 2"`.

---

### Task 9: Configuration et scénario complet

**Files:**
- Modify: `.env.example` (ajouter `DIAGNOSTIC_GRILLE=` sans valeur, avec un commentaire sur le chemin du JSON de grille dans le second cerveau)
- Test: `src/diagnostic/entretien.test.ts` (scénario complet : import, enregistrement, correction, recalcul)

- [ ] **Step 1: Écrire le scénario** : import d'un PDF fictif → `enregistrerReponses` (grille fictive complète) → profil attendu → `corrigerReponse` fait changer le profil → historique à une entrée.

- [ ] **Step 2: Lancer, vérifier le succès** (il ne doit pas exiger de changement de code ; s'il échoue, la correction se fait dans la tâche concernée).

- [ ] **Step 3: Ajouter la variable dans `.env.example`**, puis `npm run verify`.

- [ ] **Step 4: Commit** : `git commit -m "Diagnostic : configuration de la grille et scénario de l'entretien"`.

- [ ] **Step 5: Mode d'emploi pour Marc** : exporter la grille avec `scripts/diagnostic/exporter_grille.py` vers le second cerveau (chemin à valider avec Marc avant d'écrire dans le second cerveau, selon `REGLES-IA.md`), définir `DIAGNOSTIC_GRILLE` dans `.env` local, relancer l'OS et le runner, puis importer le PDF d'un projet.

---

## Self-Review

**1. Spec coverage :** import du PDF (Task 4, 7, 8), lecture par Claude (Task 6), calcul en code (Task 2), grille et variable (Task 1, 9), « N/A » exclu (Task 2), correction et historique (Task 4, 8), archivage du PDF (Task 3, 4), saisie manuelle conservée (Task 8), limite 10 Mo (Task 4, 7, 8), erreurs (Task 4, 6), tests (chaque tâche). Hors périmètre respecté.

**2. Cohérence des types :** `Grille`, `Dimension`, `Lettre`, `cleQuestion`, `ReponseQuestion`, `scorer`, `ScoreIncomplet`, `enregistrerReponses`, `corrigerReponse`, `importerEntretien`, `autoriserSiEntretien` ont le même nom partout. La question est identifiée par (section, numero) de bout en bout.

**3. Points à confirmer pendant l'exécution :** l'export de la grille vers le second cerveau (Task 9 step 5) écrit dans le second cerveau : à valider avec Marc. Le seuil est lu dans le JSON (6 par défaut dans l'export).

**4. Revue du plan :** à valider par Marc avant toute implémentation, puis choix de la méthode d'exécution.
