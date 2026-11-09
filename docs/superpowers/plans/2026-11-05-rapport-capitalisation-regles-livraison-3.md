# Capitalisation automatique des règles de rédaction (livraison 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand le pilote coche une version finale du rapport, Claude compare cette version au dernier brouillon de l'OS et aux finaux précédents, met à jour les fiches de règles du second cerveau, et l'OS affiche un journal annulable de ces changements.

**Architecture:** Cocher une finale lance une demande au runner (`regles_rapport`). L'attente du runner reçoit le texte de la finale et le dernier brouillon ; Claude met à jour deux fiches du second cerveau (règles du rapport, règles communes) puis déclare chaque changement par un outil MCP qui l'écrit dans une table de journal. Une annulation passe par une seconde demande (`regles_annuler`) : Claude rétablit l'ancien texte de la règle si elle n'a pas changé depuis.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres, RLS par instance), zod, vitest, React, MCP interne.

**Spec:** `docs/superpowers/specs/2026-11-05-rapport-versions-finales-design.md` (livraison 3). Livraisons 1 et 2 : plan `2026-11-05-rapport-versions-finales-livraisons-1-2.md`, déjà mergées.

## Global Constraints

- Dépôt public : tests et exemples **fictifs uniquement** (« Atelier Fictif », « Bureau Fictif »). Aucun nom de client, extrait de rapport ou règle propriétaire dans le code, les tests, les commentaires ou les commits.
- Règle ferme = constatée sur au moins 2 rapports finaux, ou donnée par Marc ; une observation n'est jamais appliquée d'office ; une règle contredite est **signalée** au journal, jamais supprimée en silence.
- Un libellé de journal est une consigne de style générique : jamais un extrait de rapport, jamais le nom de l'entreprise du projet.
- Fiches du second cerveau : `brain/methodes/diagnostic-endurance-commerciale/regles-redaction-rapport.md` (existe) et `brain/methodes/diagnostic-endurance-commerciale/regles-communes-diagnostic.md` (à créer, Task 6). Le runner n'écrit que dans ce dossier.
- Les noms de demande `regles_rapport` et `regles_annuler` ne commencent pas par `capitalisation_` : ce préfixe déclenche la capitalisation de la restitution dans `attentesClaude`.
- Table métier : `...metierColumns()`, `instanceIsolation('<table>')`, ajoutée à `METIER_TABLES` dans `src/db/metier-tables.ts` ; migration par `npm run db:generate`.
- Interface en français, vouvoiement ; commentaires : le pourquoi seulement ; style du fichier voisin.
- `npm run verify` vert avant chaque commit ; fichiers ajoutés explicitement (jamais `git add -A`), `git diff --staged` relu ; node via `/opt/homebrew/opt/node@24/bin`.
- Branche `feature/capitalisation-regles-rapport` (déjà créée depuis `origin/main`). Après merge : reconstruire l'app et relancer le conteneur depuis `origin/main` (AGENTS.md, Livraison), et vérifier qu'aucune migration n'a été sautée (colonne et endpoint).

## Review Focus

- Cocher une finale pendant que Claude répond déjà : la finale est posée, aucune erreur bloquante, et un bouton permet de relancer la capitalisation (Task 3, Task 5).
- Libellé de règle contenant le nom de l'entreprise du projet, ou trop long : refusé par l'outil (Task 2).
- Outil de règles appelé sans demande `regles_rapport` / `regles_annuler` en cours : refusé (Task 2).
- Annulation d'une règle que la fiche a modifiée depuis : Claude refuse, l'entrée reste active et le motif s'affiche (Task 4, Task 5).
- Projet supprimé : ses entrées de journal restent lisibles (pas de clé étrangère vers le projet) (Task 1).

---

### Task 1: Journal des règles (table et service)

**Files:**
- Modify: `src/diagnostic/schema.ts` (nouvelle table), `src/db/metier-tables.ts`
- Create: `src/diagnostic/regles.ts`, `drizzle/00NN_<nom>.sql` (générée)
- Test: `src/diagnostic/regles.test.ts`

**Interfaces:**
- Consumes: `metierColumns`, `instanceIsolation` (`src/db/columns.js`), `withInstance`, `Tx`, `Executor`.
- Produces:
  - `ACTIONS_REGLE = ['ajoutée', 'durcie', 'modifiée', 'signalée', 'annulée'] as const`, `type ActionRegle`.
  - table `diagnosticReglesJournal` : `projetId uuid` (sans clé étrangère), `fiche` (`'rapport' | 'communes'`), `action`, `libelle text`, `avant text | null`, `apres text | null`, `source text`, `statut` (`'actif' | 'annule'`, défaut `'actif'`).
  - `type ChangementRegle = { fiche: 'rapport' | 'communes'; action: Exclude<ActionRegle, 'annulée'>; libelle: string; avant: string | null; apres: string | null }`.
  - `ajouterChangementsRegles(tx: Tx, projetId: string, source: string, changements: ChangementRegle[]): Promise<void>`.
  - `listerJournalRegles(db: Executor, instance: Instance, limite?: number): Promise<EntreeJournalRegle[]>` (du plus récent, 50 par défaut) ; `EntreeJournalRegle = { id: string; le: string; fiche; action; libelle: string; avant: string | null; apres: string | null; source: string; statut: 'actif' | 'annule'; projetId: string }`.
  - `marquerReglesAnnulee(tx: Tx, id: string, motif: string | null): Promise<void>` : passe `statut` à `annule` et ajoute une entrée `annulée` ; avec un motif non nul, l'entrée reste `actif` et le motif est gardé dans `source`.

- [ ] **Step 1: Write the failing tests** (`setupTestApp`, instance fictive) : ajouter deux changements puis `listerJournalRegles` les rend du plus récent au plus ancien avec `statut: 'actif'` ; `limite` respectée ; deux instances ne voient pas les entrées l'une de l'autre ; supprimer le projet laisse ses entrées lisibles ; `marquerReglesAnnulee(tx, id, null)` passe l'entrée à `annule` et en ajoute une `annulée` ; avec un motif, l'entrée reste `actif`.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/regles.test.ts` — Expected: FAIL (module inconnu).
- [ ] **Step 3: Implement** la table (sur le modèle de `enrichissementTaches`), l'ajout à `METIER_TABLES`, `npm run db:generate`, puis `regles.ts` avec les trois fonctions.
- [ ] **Step 4: Run** le fichier de test — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(diagnostic): journal des règles de rédaction`.

### Task 2: Outil MCP `enregistrer_regles_rapport`

**Files:**
- Modify: `src/diagnostic/regles.ts`, `src/diagnostic/outils-mcp.ts`, `src/diagnostic/schema.ts` (`DEMANDES`)
- Test: `src/diagnostic/regles.test.ts`

**Interfaces:**
- Consumes: `ajouterChangementsRegles`, `marquerReglesAnnulee`, `ChangementRegle` (Task 1) ; `registerTool` ; `SupportInvalide` (`support.ts`).
- Produces:
  - `DEMANDES` étendu de `'regles_rapport'` et `'regles_annuler'`.
  - `enregistrerReglesRapport(tx: Tx, projetId: string, charge: { changements?: ChangementRegle[]; annulation?: { journalId: string; effectuee: boolean; motif?: string } }): Promise<void>` ; lève `SupportInvalide` hors demande, libellé trop long (> 200), plus de 20 changements, ou libellé contenant le nom du projet (insensible à la casse).
  - outil MCP `enregistrer_regles_rapport` (`scope: 'instance'`, entrée `projetId`, `changements`, `annulation`).

- [ ] **Step 1: Write the failing tests** : appel pendant une demande `regles_rapport` → entrées créées avec `source` « version finale N » (N lue dans le projet) ; appel sans demande → `SupportInvalide` ; libellé contenant le nom du projet (casse différente) → refusé et rien écrit ; libellé de 201 caractères → refusé ; 21 changements → refusé ; annulation `effectuee: true` pendant `regles_annuler` → entrée annulée ; `effectuee: false` avec motif → entrée active, motif gardé.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/regles.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `enregistrerReglesRapport` et l'outil, sur le modèle de `enregistrer_rapport` dans `outils-mcp.ts` (vérification de la demande en cours avant toute écriture).
- [ ] **Step 4: Run** — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(diagnostic): outil MCP des règles de rédaction`.

### Task 3: Lancer la capitalisation en cochant une finale

**Files:**
- Modify: `src/diagnostic/rapport.ts` (`marquerVersionFinale`, nouvelles fonctions), `src/diagnostic/chat.ts` (`attentesClaude`), `src/diagnostic/service.ts` si `ProjetVue` doit exposer l'état
- Test: `src/diagnostic/rapport.test.ts`, `src/diagnostic/finaux.test.ts`

**Interfaces:**
- Consumes: `envoyerMessage` (`chat.ts`), `exporterDocParLien`, `texteDuDocx`, `rapportsFinauxPour` (livraison 2), `DriveDeps`.
- Produces:
  - `DEBUT_MESSAGE_REGLES = 'Capitaliser le rapport final version'`.
  - `demanderCapitalisationRapport(db: Executor, instance: Instance, id: string): Promise<ProjetVue>` : message à l'étape 4, demande `regles_rapport` ; refuse (`ChatIndisponible`) sans version finale, ou si Claude répond déjà.
  - `demanderAnnulationRegle(db: Executor, instance: Instance, id: string, journalId: string): Promise<ProjetVue>` : demande `regles_annuler` ; refuse si l'entrée est introuvable ou déjà annulée.
  - `marquerVersionFinale` (existant) appelle `demanderCapitalisationRapport` après avoir posé une finale (`finale === true` seulement) ; une `ChatIndisponible` de cet appel est ignorée.
  - `attentesClaude(db, drive?)` ajoute : `rapportFinalTexte: string | null` (Doc final du projet exporté, tronqué à 30 000 ; seulement pour `regles_rapport`), `rapportBrouillon: unknown` (contenu de la dernière version rédigée par Claude de numéro inférieur à la finale, sinon la dernière ; seulement pour `regles_rapport`), `regleAAnnuler: { id: string; libelle: string; avant: string | null; apres: string | null; fiche: 'rapport' | 'communes' } | null` (seulement pour `regles_annuler`). `rapportsFinaux` est joint aussi pour `regles_rapport` (finaux précédents, projet courant exclu).

- [ ] **Step 1: Write the failing tests** : cocher une finale crée la demande `regles_rapport` et un message pilote commençant par `DEBUT_MESSAGE_REGLES` ; décocher n'en crée pas ; cocher pendant que Claude répond garde la finale et ne lève pas ; `demanderCapitalisationRapport` sans finale → `ChatIndisponible` ; l'attente d'une demande `regles_rapport` porte `rapportFinalTexte` (Google fictif de `finaux.test.ts`), `rapportBrouillon` et `rapportsFinaux` ; l'attente d'une demande `regles_annuler` porte `regleAAnnuler` ; `demanderAnnulationRegle` d'une entrée déjà annulée → `ChatIndisponible`. Les tests existants de `marquerVersionFinale` restent verts.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/rapport.test.ts src/diagnostic/finaux.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les fonctions et les champs d'attente ; `marquerVersionFinale` appelle la demande après sa transaction (pas dedans), et renvoie la vue relue.
- [ ] **Step 4: Run** les deux fichiers puis `npx vitest run src/diagnostic` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): lancer la capitalisation à la version finale`.

### Task 4: Le runner capitalise et annule

**Files:**
- Modify: `src/runner/runner.ts` (`AttenteDiag`, prompts, outils, branche de `tourDiagnostic`, consigne des règles communes dans `consigneRegles`)
- Test: `src/runner/diagnostic.test.ts`

**Interfaces:**
- Consumes: champs d'attente de la Task 3 ; `FICHE_REGLES_RAPPORT`, `consigneCerveau`, `dossierOuNull`, `OPTIONS_SUPPORT`.
- Produces:
  - `AttenteDiag` étendu de `rapportFinalTexte`, `rapportBrouillon`, `regleAAnnuler`.
  - `FICHE_REGLES_COMMUNES = 'brain/methodes/diagnostic-endurance-commerciale/regles-communes-diagnostic.md'`.
  - `promptReglesRapport(a: AttenteDiag, cerveau: string): string` ; `promptAnnulerRegle(a: AttenteDiag, cerveau: string): string` ; `outilsRegles(cerveau: string, travail: string[]): string`.
  - `promptRapport` lit aussi `FICHE_REGLES_COMMUNES` (règles fermes impératives).

- [ ] **Step 1: Write the failing tests** : `promptReglesRapport` contient le texte de la finale et le brouillon, les deux chemins de fiche, la règle des deux constats (ferme / observation), la signalisation d'une contradiction au lieu d'une suppression, l'interdiction de tout nom d'entreprise, l'appel à `enregistrer_regles_rapport` avec le `projetId`, et mentionne l'absence de brouillon quand `rapportBrouillon` est nul ; `promptAnnulerRegle` donne l'ancien et le nouveau texte, demande de ne rétablir que si la fiche contient encore le nouveau texte, sinon de déclarer `effectuee: false` avec le motif ; `outilsRegles` autorise `Edit` sur le seul dossier `brain/methodes/diagnostic-endurance-commerciale`, jamais sur le second cerveau entier, et ne contient aucun accès sans `cerveau` ; sans second cerveau la demande se termine par une erreur claire ; `promptRapport` cite `FICHE_REGLES_COMMUNES`.
- [ ] **Step 2: Run** `npx vitest run src/runner/diagnostic.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les prompts et la branche `regles_rapport` / `regles_annuler` de `tourDiagnostic` (mêmes options que la branche `rapport`, `--add-dir` du second cerveau, pas de skill exigée) ; mettre à jour le garde `a.demande && !support && …` pour que les deux nouvelles demandes n'exigent pas la skill du support.
- [ ] **Step 4: Run** le fichier — Expected: PASS ; `npx tsc --noEmit` propre.
- [ ] **Step 5: Commit** `feat(runner): capitaliser les règles de rédaction`.

### Task 5: Routes et écran du journal

**Files:**
- Modify: `src/api/routes.ts`, `web/src/api.ts`, `web/src/pages/Diagnostic.tsx`
- Test: `src/diagnostic/api.test.ts`, `web/src/pages/Diagnostic.test.tsx`

**Interfaces:**
- Consumes: `listerJournalRegles`, `demanderCapitalisationRapport`, `demanderAnnulationRegle` (Tasks 1 et 3).
- Produces:
  - `GET /api/i/:slug/diagnostic/regles-journal` → `EntreeJournalRegle[]`.
  - `POST /api/i/:slug/diagnostic/projets/:id/rapport/capitaliser` → `ProjetVue` (409 si refus).
  - `POST /api/i/:slug/diagnostic/projets/:id/regles-journal/:entree/annuler` → `ProjetVue` (409 si refus ; 400 si identifiants invalides).
  - web : `journalReglesDiag(slug)`, `capitaliserRapportDiag(slug, id)`, `annulerRegleDiag(slug, id, entree)`.
  - écran : dans le panneau Rapport, un bouton « Capitaliser cette version » (visible quand une finale existe, désactivé pendant une production), et une section repliable « Règles apprises » listant date, fiche, action, libellé, avec « Annuler » sur les entrées `actif` d'action `ajoutée`, `durcie` ou `modifiée`.

- [ ] **Step 1: Write the failing tests** : les trois routes (200, 409 sur refus, 400 sur identifiant invalide, journal vide par défaut) ; côté web : la section liste les entrées fictives, « Annuler » appelle `annulerRegleDiag(slug, id, entree)`, absent sur une entrée `annule` ou `signalée`, message de l'API affiché en cas de refus, bouton « Capitaliser cette version » absent sans finale et désactivé pendant une production.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/api.test.ts web/src/pages/Diagnostic.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** routes (gabarit de `rapport/finale`) et interface.
- [ ] **Step 4: Run** les deux fichiers — Expected: PASS ; vérifier dans le navigateur (lecture seule sur les données réelles).
- [ ] **Step 5: Commit** `feat(diagnostic): journal des règles et capitalisation à la demande`.

### Task 6: Fiche des règles communes, vérification et livraison

**Files:** second cerveau (hors dépôt) ; aucun fichier de code.

- [ ] **Step 1: Créer** `brain/methodes/diagnostic-endurance-commerciale/regles-communes-diagnostic.md` dans le second cerveau : même gabarit que `regles-redaction-rapport.md` (mode d'emploi, règles fermes, observations, journal), vide au départ, avec la règle « aucune proposition d'accompagnement » **remontée** depuis la fiche du rapport ; la lier depuis la fiche méthode et `amelioration-continue.md`, ajouter une entrée datée au `log.md`.
- [ ] **Step 2: Run** `npm run verify` — Expected: tout vert.
- [ ] **Step 3: Ouvrir la PR**, relire le diff (aucune donnée réelle), suivre la CI jusqu'au vert, merger.
- [ ] **Step 4: Reconstruire l'app et relancer le conteneur** depuis `origin/main` à jour ; vérifier `curl localhost:4300/health`, la colonne et la table créées par la migration, et l'endpoint `regles-journal`.
- [ ] **Step 5: Mettre à jour le second cerveau** : `brain/outils/simatis-os-structure.md`, `brain/outils/simatis-os-feuille-de-route.md`, `log.md`.
- [ ] **Step 6: Expliquer à Marc**, pas à pas, comment tester : cocher une version finale, ouvrir « Règles apprises », annuler une règle.
