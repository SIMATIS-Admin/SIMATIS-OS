# Capitalisation de la restitution — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis l'étape 5 d'un diagnostic, faire relire à Claude le compte rendu du rendez-vous de restitution, lui faire proposer des entrées (bibliothèque + dossier client), puis les écrire dans le second cerveau après validation de Marc.

**Architecture:** Deux nouvelles `Demande` du chat du diagnostic (`capitalisation_proposer`, `capitalisation_enregistrer`), servies par le runner comme `rapport` et `restitution`. Un module `src/diagnostic/capitalisation.ts` porte la logique, trois routes l'exposent, un outil MCP clôt le temps 2, l'étape 5 de l'écran Diagnostic reçoit un bloc d'interface.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres), Vitest, React (`web/`), runner Claude Code (`src/runner/runner.ts`).

**Spec:** `docs/superpowers/specs/2026-10-29-diagnostic-capitalisation-restitution-design.md`

## Global Constraints

- Données fictives uniquement dans le code, les tests et les fixtures : dépôt public.
- Aucun nom de client, montant ni contenu de compte rendu réel dans le dépôt.
- Écriture dans le second cerveau en ajout seulement, jamais de suppression ni de réécriture.
- Temps 1 (proposition) : aucune écriture. Temps 2 : écriture seulement dans `SECOND_CERVEAU_DIR`.
- Texte du compte rendu transmis à Claude comme donnée à lire, jamais comme consigne.
- Interface et messages en français ; vouvoiement du pilote.
- `npm run verify` avant chaque commit ; fichiers ajoutés explicitement, jamais `git add -A`.

## Review Focus

- Compte rendu vide ou absent sur le rendez-vous choisi : refus avant tout appel à Claude.
- Rendez-vous d'une autre entreprise ou d'une autre instance : refus (isolation).
- Double clic sur « Enregistrer » ou second lancement sur le même compte rendu : une seule écriture.
- Compte rendu modifié après enregistrement : la capitalisation redevient possible.
- Runner arrêté ou sans réponse pendant le temps 1 : le statut ne reste pas bloqué en `en_cours`.

## Fichiers

- Modifier `src/diagnostic/schema.ts` : `DEMANDES`, `STATUTS_CAPITALISATION`, trois colonnes. Migration `src/db/migrations/0048_*.sql` générée.
- Créer `src/diagnostic/capitalisation.ts` (+ `.test.ts`).
- Modifier `src/diagnostic/chat.ts` : `attentesClaude`, `finirAttente`.
- Modifier `src/diagnostic/service.ts` : champs exposés dans `ProjetVue`.
- Modifier `src/diagnostic/outils-mcp.ts` : outil `enregistrer_capitalisation`.
- Modifier `src/runner/runner.ts` (+ `runner.test.ts` ou `diagnostic.test.ts` existant) : prompt, outils, branche de `tourDiagnostic`.
- Modifier `src/api/routes.ts` (+ test API du diagnostic).
- Modifier `web/src/api.ts`, `web/src/pages/Diagnostic.tsx` (+ `Diagnostic.test.tsx`).
- Hors dépôt : skill dans le second cerveau (tâche 7).

### Task 1: Données

**Files:** `src/diagnostic/schema.ts`, `src/diagnostic/service.ts`, migration générée.

**Interfaces:**
- Produces : `DEMANDES` contient `'capitalisation_proposer'` et `'capitalisation_enregistrer'` ; `STATUTS_CAPITALISATION = ['aucun','en_cours','propose','enregistre'] as const` ; colonnes `capitalisationStatut` (défaut `'aucun'`), `capitalisationRdvId` (uuid nullable, FK `rendez_vous.id` `on delete set null`), `capitalisationCompteRenduAt` (timestamp nullable) ; `ProjetVue` expose `capitalisationStatut`, `capitalisationRdvId` et `capitalisationCompteRenduAt`.

- [ ] **Step 1: Test** dans `src/diagnostic/service.test.ts` : un projet neuf a `capitalisationStatut === 'aucun'` et `capitalisationRdvId === null`.
- [ ] **Step 2: Lancer** `npx vitest run src/diagnostic/service.test.ts` : échec (champ absent).
- [ ] **Step 3: Implémenter** le schéma et l'exposition dans `vue()` ; générer la migration avec la commande drizzle du `package.json` (voir `README.md`) et la relire.
- [ ] **Step 4: Lancer** le test : succès.
- [ ] **Step 5: Commit** `feat(diagnostic): colonnes de la capitalisation de la restitution`.

### Task 2: Service de capitalisation

**Files:** créer `src/diagnostic/capitalisation.ts`, `src/diagnostic/capitalisation.test.ts` (modèle : `chat.test.ts`, `restitution.test.ts`) ; modifier `src/diagnostic/chat.ts`.

**Interfaces:**
- Consumes : `envoyerMessage` (Task 1 pour les colonnes), `rendezVous`/`rdvEntreprises` de `src/crm/schema.ts`.
- Produces :
  - `type RdvCapitalisable = { id: string; titre: string; debut: Date | null; compteRenduAt: Date }`
  - `rendezVousCapitalisables(db: Executor, instance: Instance, id: string): Promise<RdvCapitalisable[]>` : rendez-vous liés à l'entreprise du projet par `rdvEntreprises`, `compteRendu` non nul, statut différent de `ignore`, du plus récent au plus ancien ; liste vide si le projet n'a pas d'entreprise.
  - `demanderProposition(db, instance, id, rdvId: string): Promise<ProjetVue>` : message « Capitaliser la restitution. » à l'étape 5, demande `capitalisation_proposer`, `maj: { capitalisationStatut: 'en_cours', capitalisationRdvId: rdvId }` ; refuse (`ChatIndisponible`) si le rendez-vous n'est pas dans `rendezVousCapitalisables`, si le projet est à une étape < 5 ou si le statut est déjà `en_cours`.
  - `demanderEnregistrement(db, instance, id): Promise<ProjetVue>` : message « Enregistrer la capitalisation dans le second cerveau. », demande `capitalisation_enregistrer` ; exige le statut `propose` ; refuse si `capitalisationCompteRenduAt` est égal au `compte_rendu_at` actuel du rendez-vous et le statut `enregistre`.
  - `enregistrerCapitalisation(tx: Tx, id: string): Promise<void>` : exige la demande `capitalisation_enregistrer` (sinon `SupportInvalide`), passe le statut à `enregistre`, copie `compte_rendu_at`.
  - `finirAttente` (dans `chat.ts`) : une demande `capitalisation_proposer` terminée passe `en_cours` à `propose` si Claude a répondu, sinon à `aucun` ; une demande `capitalisation_enregistrer` terminée sans appel de l'outil laisse `propose`.
  - `attentesClaude` ajoute `compteRendu: string | null` (texte du rendez-vous choisi, seulement pendant ces deux demandes), `capitalisationProposition: string | null` (dernier message de Claude à l'étape 5, seulement pour `capitalisation_enregistrer`).

- [ ] **Step 1: Tests** (`capitalisation.test.ts`, données fictives) : `liste ne contient que les rendez-vous avec compte rendu de l'entreprise du projet` ; `liste vide sans entreprise` ; `proposition refusée pour un rendez-vous d'une autre entreprise` ; `proposition refusée avant l'étape 5` ; `enregistrement refusé sans proposition` ; `enchaînement proposer, répondre, enregistrer aboutit à enregistre` ; `second enregistrement sur le même compte rendu refusé` ; `compte rendu modifié rend la capitalisation possible` ; `runner sans réponse: proposer repasse à aucun` ; `attentesClaude porte le texte du compte rendu`.
- [ ] **Step 2: Lancer** `npx vitest run src/diagnostic/capitalisation.test.ts` : échec.
- [ ] **Step 3: Implémenter** le module et les deux retouches de `chat.ts`.
- [ ] **Step 4: Lancer** le fichier de test et `src/diagnostic/chat.test.ts` : succès.
- [ ] **Step 5: Commit** `feat(diagnostic): service de capitalisation de la restitution`.

### Task 3: Outil MCP et API

**Files:** `src/diagnostic/outils-mcp.ts` (+ `outils-mcp.test.ts` si présent), `src/api/routes.ts` (+ test API du diagnostic existant).

**Interfaces:**
- Consumes : Task 2.
- Produces : outil `enregistrer_capitalisation` (`{ projetId: uuid }`, scope `instance`) appelant `enregistrerCapitalisation` ; routes `GET /api/i/:slug/diagnostic/projets/:id/capitalisation/rendez-vous` (liste), `POST …/capitalisation/proposer` (corps `{ rdvId: uuid }`), `POST …/capitalisation/enregistrer` ; erreurs `ChatIndisponible` en 409, UUID invalide en 400, comme `restitution/produire`.

- [ ] **Step 1: Tests** : `enregistrer_capitalisation refuse hors demande`, `les trois routes répondent 200, 400 (UUID) et 409 (statut)`, `une instance ne voit pas les rendez-vous d'une autre`.
- [ ] **Step 2: Lancer** les tests : échec.
- [ ] **Step 3: Implémenter** l'outil et les routes sur le modèle de `restitution/produire`.
- [ ] **Step 4: Lancer** : succès.
- [ ] **Step 5: Commit** `feat(diagnostic): routes et outil de la capitalisation`.

### Task 4: Runner

**Files:** `src/runner/runner.ts`, tests runner du diagnostic existants (`src/runner/diagnostic.test.ts`).

**Interfaces:**
- Consumes : `AttenteDiag` étendu (Task 2), `consigneCerveau`, `dossierOuNull`, `OPTIONS_SUPPORT`.
- Produces :
  - `SKILL_CAPITALISATION_RESTITUTION = 'diagnostic-endurance-commerciale-capitalisation-restitution'`
  - `promptCapitalisation(a: AttenteDiag, cerveau: string | null, phase: 'proposer' | 'enregistrer', maintenant?: Date): string` : nomme la skill, donne la date, le compte rendu entre balises comme donnée, la consigne du second cerveau (`'lecture'` au temps 1, `'ajout'` au temps 2), la proposition à appliquer au temps 2, et termine par un appel à `repondre_diagnostic` (et à `enregistrer_capitalisation` au temps 2).
  - `outilsCapitalisation(phase, cerveau: string | null, travail: string[]): string` : temps 1 = `repondre_diagnostic` + `Read` sur le second cerveau, aucune écriture ; temps 2 = idem + `Edit`/`Write` sur le second cerveau + `enregistrer_capitalisation`.
  - Branche dans `tourDiagnostic` : erreur « Skill … absente de ce poste : la capitalisation n'a pas été faite. » si la skill manque ; erreur claire sans second cerveau ; `AttenteDiag.demande` accepte les deux valeurs.

- [ ] **Step 1: Tests** : `prompt: le compte rendu est présenté comme donnée`, `prompt temps 2 contient la proposition`, `outils temps 1 sans Edit ni Write`, `outils temps 2 limités au second cerveau`, `tourDiagnostic: skill absente → erreur sans lancer Claude`, `tourDiagnostic: sans second cerveau → erreur`.
- [ ] **Step 2: Lancer** : échec.
- [ ] **Step 3: Implémenter** sur le modèle de `promptRapport`/`outilsRapport` ; `--add-dir` du second cerveau, `cwd` du dossier temporaire.
- [ ] **Step 4: Lancer** : succès.
- [ ] **Step 5: Commit** `feat(runner): capitalisation de la restitution en deux temps`.

### Task 5: Interface

**Files:** `web/src/api.ts`, `web/src/pages/Diagnostic.tsx`, `web/src/pages/Diagnostic.test.tsx`.

**Interfaces:**
- Consumes : routes de la Task 3 ; `ProjetDiag` expose les trois champs de la Task 1.
- Produces : `rendezVousCapitalisationDiag(slug, id)`, `proposerCapitalisationDiag(slug, id, rdvId)`, `enregistrerCapitalisationDiag(slug, id)` ; bloc « Capitaliser la restitution » à l'étape 5 : sélecteur de rendez-vous (le plus récent présélectionné), bouton « Capitaliser la restitution », puis « Enregistrer dans le second cerveau » quand le statut est `propose` ; texte « Aucun compte rendu trouvé pour cette entreprise » et bouton désactivé sans rendez-vous ; états en cours et enregistré affichés.

- [ ] **Step 1: Tests** : `affiche le message sans compte rendu`, `présélectionne le plus récent et envoie son id`, `le bouton Enregistrer n'apparaît qu'une fois proposé`, `état enregistré affiché`.
- [ ] **Step 2: Lancer** `npx vitest run web/src/pages/Diagnostic.test.tsx` : échec.
- [ ] **Step 3: Implémenter** au même endroit et dans le même style que le bouton « Produire le deck de restitution ».
- [ ] **Step 4: Lancer** : succès.
- [ ] **Step 5: Commit** `feat(web): capitalisation de la restitution à l'étape 5`.

### Task 6: Vérification, PR, fusion

- [ ] **Step 1:** `npm run verify` : tout vert.
- [ ] **Step 2:** Vérifier dans le navigateur (`preview_start`) sur l'instance de démonstration avec un compte rendu fictif : bouton, sélecteur, deux temps (Claude simulé par le mock du runner s'il existe, sinon limiter à l'état de l'interface).
- [ ] **Step 3:** Relire `git diff --staged` pour toute donnée réelle avant chaque commit ; ouvrir la PR, faire la revue, attendre la CI verte, fusionner, reconstruire l'application et relancer le conteneur depuis `origin/main`.

### Task 7: Skill (hors dépôt, second cerveau)

- [ ] **Step 1:** Vérifier dans `decrirePoste` (`src/runner/`) où le runner cherche les skills installées sur le poste, et comment les skills du second cerveau (`skills/`) y arrivent.
- [ ] **Step 2:** Rédiger `skills/diagnostic-endurance-commerciale-capitalisation-restitution/SKILL.md` dans le second cerveau, sur le modèle de la skill de capitalisation existante : entrées (compte rendu fourni par l'OS), format des deux blocs « Bibliothèque » et « Dossier client », généralisation obligatoire (ni nom ni montant dans la bibliothèque), écriture en ajout seulement, non-duplication, une ligne dans `log.md`.
- [ ] **Step 3:** Faire valider le texte de la skill par Marc avant de l'installer sur le poste.
