# Versions finales du rapport et rédaction à partir des finaux (livraisons 1 et 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le pilote coche la version finale d'un rapport (Google Doc), et la production d'un nouveau rapport relit les deux derniers rapports finaux et la fiche de règles du second cerveau.

**Architecture:** La version finale est un drapeau `finale` sur une entrée de `rapportLiens` (jsonb : pas de migration). Au lancement d'une production, le serveur exporte les Google Docs finaux des autres projets, les convertit en texte et les joint à l'attente du runner ; `promptRapport` les présente comme modèle, avec la consigne de lire (et, au premier passage, d'amorcer) la fiche de règles du second cerveau. Un réglage d'instance `diagnostic.relireFinaux` (actif par défaut) retire le bloc des finaux quand les règles suffisent.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres), zod, vitest, React, `fflate` (déjà présent) pour lire le .docx.

**Spec:** `docs/superpowers/specs/2026-11-05-rapport-versions-finales-design.md`

Ce plan couvre les livraisons 1 et 2 du spec. Écart avec le spec : aucune migration Drizzle, le drapeau `finale` vit dans une colonne jsonb déjà existante. La capitalisation automatique, le journal et les règles communes (3), puis support (4), analyse (5) et restitution (6) auront chacun leur plan, écrit après livraison de celui-ci.

## Global Constraints

- Dépôt public : tests et exemples avec des données **fictives uniquement** (« Atelier Fictif », « Bureau Fictif »). Aucun nom de client, contenu de rapport ou règle propriétaire dans le code, les tests, les commentaires ou les commits.
- Une seule version finale par projet ; seul un lien Google Doc (`estGoogleDoc`) peut être final ; refus pendant `rapportLienStatut === 'en_cours'`.
- Les règles vivent dans le second cerveau, jamais dans le dépôt ni en base. Fiche de règles : `brain/methodes/diagnostic-endurance-commerciale/regles-redaction-rapport.md` (déjà créée, amorcée).
- Réglage `diagnostic.relireFinaux` : actif par défaut ; désactivé, seules les règles restent dans le prompt.
- Deux finaux au plus relus, texte tronqué à 30 000 caractères chacun (même borne que les autres contenus du prompt).
- Si moins de deux finaux existent, ou si un export Drive échoue, la production continue et le dit dans le prompt.
- Interface en français, vouvoiement ; commentaires : le pourquoi seulement ; style du fichier voisin.
- `npm run verify` vert avant chaque commit ; fichiers ajoutés explicitement (jamais `git add -A`), `git diff --staged` relu ; node via `/opt/homebrew/opt/node@24/bin`.
- Après merge : reconstruire l'app et relancer le conteneur depuis `origin/main` à jour (AGENTS.md, Livraison).

## Review Focus

- Cocher un lien qui n'est pas un Google Doc (artifact claude.ai) ou qui n'appartient pas au projet : refus, rien ne change (Task 1).
- Deux entrées de même numéro de version (double envoi) : une seule peut être finale, l'autre reste visible (Task 1, Task 3).
- Un Google Doc final supprimé ou inaccessible : la production continue sans lui et l'indique (Task 5).
- Texte du .docx vide ou fichier non zip : traité comme « texte indisponible », pas d'exception (Task 4).
- Projet courant déjà final : jamais relu comme modèle de lui-même (Task 5).

---

### Task 1: Marquer une version finale (service)

**Files:**
- Modify: `src/diagnostic/schema.ts` (type de l'entrée de `rapportLiens`, ligne ~86)
- Modify: `src/diagnostic/rapport.ts`
- Test: `src/diagnostic/rapport.test.ts`

**Interfaces:**
- Consumes: `estGoogleDoc(lien: string | null): boolean` de `src/diagnostic/drive.ts`; `ChatIndisponible`, `ProjetIntrouvable`, `verifierEspace`, `vue`, `withInstance` (déjà importés par `rapport.ts`).
- Produces: type `LienRapport = { lien: string; le: string; version?: number; finale?: boolean }` exporté de `schema.ts` ; `marquerVersionFinale(db: Executor, instance: Instance, id: string, lien: string, finale: boolean): Promise<ProjetVue>`.

- [ ] **Step 1: Write the failing tests** in `rapport.test.ts` (suivre le montage `setupTestApp`/`createProjet` du fichier). Cas, avec des liens `https://docs.google.com/document/d/doc-1/edit` etc. :
  - `cocher un Google Doc le rend final` : après `marquerVersionFinale(db, i, id, lienDoc1, true)`, `vue.rapportLiens.find(l => l.lien === lienDoc1)?.finale === true`.
  - `une seule finale par projet` : cocher `doc-2` après `doc-1` retire `finale` de `doc-1`.
  - `décocher` : `finale: false` laisse zéro finale.
  - `refuse un lien artifact` : rejette avec `ChatIndisponible` pour `https://claude.ai/artifact/abc`.
  - `refuse un lien étranger au projet` : `ChatIndisponible`.
  - `refuse pendant une production` : `rapportLienStatut = 'en_cours'` → `ChatIndisponible`.
  - `deux entrées de même version` : cocher l'une laisse l'autre sans `finale`.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/rapport.test.ts` — Expected: FAIL (`marquerVersionFinale` inconnue).
- [ ] **Step 3: Implement** le type `LienRapport` dans `schema.ts` (remplace le type inline de `rapportLiens`, et réutilisé côté web en Task 2) et `marquerVersionFinale` dans `rapport.ts`, sur le modèle de `renvoyerRapportSurDrive` (transaction `withInstance`, lecture du projet, contrôles, `update` de `rapportLiens` recalculé avec `finale` posé sur la seule entrée du lien cible, retiré des autres).
- [ ] **Step 4: Run** le même fichier — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): marquer la version finale d'un rapport`.

### Task 2: Route et client web

**Files:**
- Modify: `src/api/routes.ts` (près de la route `rapport/drive`, ligne ~566)
- Modify: `web/src/api.ts` (type `ProjetDiag.rapportLiens` ligne ~1312, nouvelle fonction)
- Test: `src/diagnostic/api.test.ts`

**Interfaces:**
- Consumes: `marquerVersionFinale` (Task 1).
- Produces: `POST /api/i/:slug/diagnostic/projets/:id/rapport/finale`, corps `{ lien: string, finale: boolean }`, réponse `ProjetVue` ; côté web `marquerRapportFinal(slug: string, id: string, lien: string, finale: boolean): Promise<ProjetDiag>` et `rapportLiens: { lien: string; le: string; version?: number; finale?: boolean }[]`.

- [ ] **Step 1: Write the failing test** dans `api.test.ts` : `POST …/rapport/finale` avec un lien Google Doc du projet → 200 et `rapportLiens[0].finale === true` ; lien étranger → 409 ; corps invalide → 400 ; id non UUID → 400.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/api.test.ts` — Expected: FAIL (404).
- [ ] **Step 3: Implement** la route avec le même gabarit que `rapport/drive` (`UUID.test`, `ChatIndisponible` → 409, schéma zod `{ lien: z.string().min(1).max(500), finale: z.boolean() }`) et la fonction web `marquerRapportFinal` sur le modèle de la fonction d'import voisine dans `api.ts`.
- [ ] **Step 4: Run** le test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): route de version finale du rapport`.

### Task 3: Case « Version finale » dans l'interface

**Files:**
- Modify: `web/src/pages/Diagnostic.tsx` (composant `Rapport`, ligne ~858 ; liste des versions ~916)
- Test: `web/src/pages/Diagnostic.test.tsx`

**Interfaces:**
- Consumes: `marquerRapportFinal` (Task 2) ; `projet.rapportLiens` avec `finale`.
- Produces: rien pour les tâches suivantes.

- [ ] **Step 1: Write the failing tests** (montage existant du fichier, `rapportLiens` ligne ~621 comme modèle) :
  - `une case par Google Doc` : deux liens Doc et un lien artifact → deux cases « Version finale », aucune pour l'artifact.
  - `cocher appelle l'API` : clic → `marquerRapportFinal` appelé avec `(slug, id, lienDoc, true)` ; la version finale affiche « Version finale » en évidence après retour.
  - `cochée à nouveau, décocher` : clic sur la case cochée → appel avec `false`.
  - `désactivée pendant la production` : `rapportLienStatut: 'en_cours'` → cases désactivées.
  - `erreur 409` : message de l'API affiché via `onErreur`.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/Diagnostic.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** la case dans la liste des versions du composant `Rapport` : `<label><input type="checkbox">Version finale</label>` par entrée dont le lien est un Google Doc (réutiliser le test déjà utilisé dans le composant pour `docGoogle`), même gestion d'erreur que les actions voisines.
- [ ] **Step 4: Run** le fichier — Expected: PASS. Puis vérifier dans le navigateur (preview) : cocher, décocher, remplacer.
- [ ] **Step 5: Commit** `feat(diagnostic): case Version finale dans l'étape Rapport`.

### Task 4: Texte d'un Word

**Files:**
- Create: `src/diagnostic/docx-texte.ts`
- Test: `src/diagnostic/docx-texte.test.ts`

**Interfaces:**
- Consumes: `fflate` (`unzipSync`, `strFromU8`).
- Produces: `texteDuDocx(octets: Uint8Array): string | null` — texte brut du corps (paragraphes séparés par `\n`, titres conservés comme lignes), `null` si le fichier n'est pas un .docx lisible ou si le texte est vide.

- [ ] **Step 1: Write the failing tests** : un .docx fictif fabriqué dans le test avec `genererRapportWord(contenuRapportFictif)` de `rapport-word.ts` → `texteDuDocx` contient le nom de l'entreprise fictive et un titre de section de la fixture ; `new Uint8Array([1,2,3])` → `null` ; un zip sans `word/document.xml` → `null`.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/docx-texte.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `texteDuDocx` : `unzipSync`, lire `word/document.xml`, une fin de paragraphe `</w:p>` devient `\n`, balises retirées, entités XML décodées (`&amp; &lt; &gt; &quot; &apos;`), `trim`, `null` si vide ; toute exception → `null`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): lire le texte d'un Word exporté`.

### Task 5: Rapports finaux joints à la demande du runner

**Files:**
- Modify: `src/diagnostic/drive.ts` (export par lien)
- Modify: `src/diagnostic/chat.ts` (`attentesClaude`, ligne ~179 ; objet de sortie ligne ~198)
- Modify: `src/routines/runner-api.ts` (ligne ~174, passage des `driveDeps`)
- Modify: `src/instances/schema.ts` (`InstanceConfig`)
- Test: `src/diagnostic/rapport-drive.test.ts` (réutiliser `fakeGoogle`), `src/diagnostic/chat.test.ts`

**Interfaces:**
- Consumes: `texteDuDocx` (Task 4) ; `exporterDocx` de `connecteurs/google/google.ts` ; `DriveDeps`.
- Produces:
  - `InstanceConfig.diagnostic?: { relireFinaux?: boolean }` (défaut vrai).
  - `exporterDocParLien(instance: Instance, lien: string, deps: DriveDeps): Promise<Buffer>` dans `drive.ts` (extraction de l'identifiant par `IDENTIFIANT_DOC`, même export que `exporterRapportDrive`).
  - `rapportsFinauxPour(db: Executor, instance: Instance, projetId: string, deps: DriveDeps): Promise<{ nom: string; version: number | null; texte: string | null }[]>` (au plus deux, du plus récent au plus ancien par `le`, projets de l'instance autres que `projetId`, `finale === true` ; `texte: null` si export ou conversion échoue ; tronqué à 30 000 caractères).
  - `attentesClaude(db: Executor, deps?: DriveDeps)` ajoute `relireFinaux: boolean` et `rapportsFinaux: { nom: string; version: number | null; texte: string | null }[]` (liste vide hors demande `rapport`).

- [ ] **Step 1: Write the failing tests** :
  - `rapportsFinauxPour renvoie les deux plus récents` : trois projets fictifs avec finale (dates différentes), un quatrième courant → deux entrées, ordre décroissant, courant exclu, texte issu du Word exporté par `fakeGoogle` (adapter le faux export pour renvoyer un vrai .docx fictif).
  - `export en échec` : un Doc répond 404 → entrée avec `texte: null`, l'autre intacte.
  - `projet sans finale` → liste vide.
  - `attentesClaude` : pour une demande `rapport`, `rapportsFinaux` rempli si `relireFinaux` n'est pas `false` ; vide si `config.diagnostic.relireFinaux === false` ; vide pour une autre demande ; sans `deps`, liste vide.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/rapport-drive.test.ts src/diagnostic/chat.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les signatures ci-dessus. `exporterRapportDrive` appelle `exporterDocParLien` pour ne pas dupliquer l'export. Dans `runner-api.ts`, passer à `attentesClaude` les mêmes `driveDeps` que `routes.ts` (ligne ~263) ; si l'objet n'est pas accessible là, le faire descendre par les paramètres de la fonction qui monte la route runner.
- [ ] **Step 4: Run** les deux fichiers — Expected: PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): joindre les rapports finaux à la demande de rapport`.

### Task 6: Prompt de rédaction avec règles et finaux

**Files:**
- Modify: `src/runner/runner.ts` (`AttenteDiag` ligne ~508 ; `promptRapport` ligne ~701 ; `outilsRapport` ligne ~735)
- Test: `src/runner/diagnostic.test.ts`

**Interfaces:**
- Consumes: `relireFinaux`, `rapportsFinaux` de l'attente (Task 5).
- Produces: `AttenteDiag` étendu de `relireFinaux: boolean` et `rapportsFinaux: { nom: string; version: number | null; texte: string | null }[]`. Constante exportée `FICHE_REGLES_RAPPORT = 'brain/methodes/diagnostic-endurance-commerciale/regles-redaction-rapport.md'` (chemin de la fiche dans le second cerveau).

- [ ] **Step 1: Write the failing tests** (modèle des tests `promptRapport` existants, attente fictive) :
  - `avec finaux` : le prompt contient « Rapports finaux » et le texte fictif de chaque finale, présenté comme modèle de structure, de vocabulaire et de longueur.
  - `réglage désactivé` : `relireFinaux: false` → aucun bloc des finaux, la consigne sur la fiche de règles reste.
  - `texte indisponible` : une entrée `texte: null` → mention « texte indisponible » et pas d'`undefined`/`null` littéral.
  - `moins de deux finaux` : une phrase indique combien ont été trouvés.
  - `fiche de règles` : le prompt contient `FICHE_REGLES_RAPPORT`, indique que ses règles fermes sont impératives et priment sur la trame par défaut, et, si la fiche n'existe pas et que deux finaux sont fournis, demande de la créer en classant points communs → règles fermes, différences → observations (amorçage).
  - `sans second cerveau` : `cerveau === null` → la phrase existante « Second cerveau non accessible » reste, aucune consigne d'écriture.
  - `outilsRapport` : avec cerveau, `Edit` autorisé sur le seul dossier du second cerveau pour permettre l'amorçage ; sans cerveau, aucun accès.
- [ ] **Step 2: Run** `npx vitest run src/runner/diagnostic.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : étendre `AttenteDiag` (et la fixture `attente` du test) ; dans `promptRapport`, ajouter après la ligne « Rapport précédent » un bloc des finaux (texte tronqué par `.slice(0, 30_000)`) et la consigne sur la fiche ; `outilsRapport` ajoute `Edit(/${cerveau}/**)` quand `cerveau` existe. **Emplacement fixé** : la fiche existe dans le second cerveau, `brain/methodes/diagnostic-endurance-commerciale/regles-redaction-rapport.md` (titre « règles de rédaction du rapport »). La consigne donne ce chemin relatif au dossier du second cerveau et demande à Claude de mettre à jour la fiche, sans jamais citer de nom d'entreprise.
- [ ] **Step 4: Run** le fichier — Expected: PASS.
- [ ] **Step 5: Commit** `feat(runner): rédiger le rapport à partir des finaux et des règles`.

### Task 7: Réglage « Relire les finaux »

**Files:**
- Modify: `src/api/routes.ts` (près de la route qui fusionne `funnel` dans `config`, ligne ~1553)
- Modify: `web/src/api.ts`, `web/src/pages/Diagnostic.tsx`
- Test: `src/diagnostic/api.test.ts`, `web/src/pages/Diagnostic.test.tsx`

**Interfaces:**
- Consumes: `InstanceConfig.diagnostic` (Task 5).
- Produces: `PUT /api/i/:slug/diagnostic/reglages`, corps `{ relireFinaux: boolean }`, réponse `{ relireFinaux: boolean }` ; `GET` du même chemin ; côté web `reglagesDiagnostic(slug)` et `majReglagesDiagnostic(slug, relireFinaux: boolean)`.

- [ ] **Step 1: Write the failing tests** : `GET` sans réglage → `{ relireFinaux: true }` ; `PUT false` puis `GET` → `false` ; l'écriture ne touche pas `ecrituresReelles` ni `modules` ; corps invalide → 400. Côté web : case « Relire les deux derniers rapports finaux avant de rédiger » dans le panneau Rapport, cochée par défaut, qui appelle `majReglagesDiagnostic`.
- [ ] **Step 2: Run** les deux fichiers de test — Expected: FAIL.
- [ ] **Step 3: Implement** en fusionnant dans `config` comme la route `funnel` (`{ ...i.config, diagnostic: { ...i.config.diagnostic, relireFinaux } }`) et la case dans le composant `Rapport`.
- [ ] **Step 4: Run** — Expected: PASS. Vérifier dans le navigateur.
- [ ] **Step 5: Commit** `feat(diagnostic): réglage Relire les finaux`.

### Task 8: Vérification, reprise de l'existant et livraison

**Files:** aucun fichier de code.

- [ ] **Step 1: Run** `npm run verify` — Expected: tout vert.
- [ ] **Step 2: Vérifier dans le navigateur** (preview) sur l'instance de démonstration : cocher une version, la remplacer, activer/désactiver le réglage, lancer « Produire le rapport » et lire le prompt dans les journaux du runner.
- [ ] **Step 3: Ouvrir la PR**, relire le diff (aucune donnée réelle), suivre la CI jusqu'au vert, merger.
- [ ] **Step 4: Reconstruire l'app et relancer le conteneur** depuis `origin/main` à jour ; vérifier que le conteneur répond.
- [ ] **Step 5: Mettre à jour le second cerveau** : `brain/outils/simatis-os-structure.md` et `brain/outils/simatis-os-feuille-de-route.md`, avec une ligne dans `log.md`. Rien n'est copié dans le dépôt.
- [ ] **Step 6: Expliquer à Marc**, pas à pas, comment tester : ouvrir le projet de son choix, étape Rapport, cocher la version finale de chacun des deux projets terminés, ouvrir le projet à refaire, « Produire le rapport ».
