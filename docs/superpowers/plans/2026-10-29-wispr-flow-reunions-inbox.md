# Réunions Wispr Flow dans l'Inbox — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La routine Inbox lit les réunions Wispr Flow, les dépose dans l'Inbox à attribuer, garde le transcript complet des seules réunions critiques et relie une réunion à un « CR à faire » déjà présent.

**Architecture:** Le connecteur claude.ai de Wispr Flow est lu par Claude dans la routine Inbox (l'exécuteur perd `--strict-mcp-config` pour cette routine, ses outils restent listés un à un). L'OS reçoit les réunions par des outils MCP `simatis`, les range dans une table `reunions_wispr` liée à une entrée d'Inbox, et récupère le transcript d'une réunion critique au passage suivant de la routine (même schéma que `sujets_traites` / `marquer_reporte`).

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres, RLS par instance), React, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-wispr-flow-reunions-inbox-design.md`

## Global Constraints

- Dépôt public : tests, exemples et fixtures avec des données **fictives** uniquement (noms « Atelier Fictif », « Dupont Fictif »…). Aucun transcript, résumé ou jeton réel, aucun identifiant Wispr réel.
- Routine Inbox : lecture seule sur Wispr Flow. Outils Wispr autorisés, exactement : `mcp__claude_ai_Wispr_Flow__search_meetings`, `mcp__claude_ai_Wispr_Flow__get_meeting`, `mcp__claude_ai_Wispr_Flow__get_meeting_participants_enriched`. Aucun autre connecteur claude.ai (Gmail, HubSpot, Drive) autorisé.
- Défaut : « résumé seulement ». Le transcript n'est stocké que si `critique = true`.
- Une réunion Wispr = une seule entrée d'Inbox, pour toujours (clé stable = identifiant de la réunion Wispr).
- Toute nouvelle table : `instanceIsolation(...)` et inscription dans `src/db/metier-tables.ts` comme les autres tables métier.
- Interface et messages en français ; commentaires sur le pourquoi seulement ; commits fréquents ; `npm run verify` avant chaque commit.

## Review Focus

- Réunion sans aucun participant connu du CRM : l'entrée est quand même déposée, sans contact ni entreprise (Marc attribue).
- Même réunion relue à chaque passage : aucune entrée en double, aucun écrasement du choix de Marc (critique, rattachement).
- Réunion non critique : jamais de transcript stocké, même si la routine en fournit un.
- Marc décoche « critique » après stockage du transcript : le transcript est supprimé.
- Entrée `compte_rendu` déjà traitée (cochée) : non reliée, elle ne revient pas.
- Réunion d'une autre instance (id Wispr identique, instance différente) : aucune fuite entre instances.
- Transcript très long : refusé au-delà de la limite, sans casser le passage de la routine.

---

## File Structure

- Modifier `src/runner/runner.ts` — arguments Claude de la routine Inbox.
- Modifier `src/inbox/schema.ts` — origine `wispr`, table `reunionsWispr`.
- Créer `drizzle/NNNN_*.sql` (généré) et modifier `src/db/metier-tables.ts`.
- Créer `src/inbox/reunions.ts` — dépôt, rattachement, transcript.
- Modifier `src/inbox/outils-mcp.ts` — 4 outils MCP.
- Modifier `src/inbox/service.ts` (`SujetVue.reunion`) et `src/api/routes.ts` — lecture et attribution.
- Modifier `web/src/api.ts`, `web/src/pages/Inbox.tsx` — écran d'attribution.
- Hors dépôt (privé) : la skill `alimenter-inbox` du second cerveau.

### Task 1: L'exécuteur laisse passer Wispr Flow pour la routine Inbox

**Files:**
- Modify: `src/runner/runner.ts:108-129` (`argumentsClaude`)
- Test: `src/runner/runner.test.ts` (nouveau)

**Interfaces:**
- Produces: `WISPR_OUTILS_LECTURE: readonly string[]` (les 3 outils ci-dessus, exportée) ; `argumentsClaude(d, config, cerveau)` garde sa signature.

- [ ] **Step 1: Tests** (`argumentsClaude` avec un `Demande` fictif, `skill: 'alimenter-inbox'`) :
  - `inbox : pas de --strict-mcp-config, outils = simatis + les 3 outils Wispr, aucun mcp__claude_ai_Gmail ni HubSpot ni Drive`.
  - `autre routine : --strict-mcp-config conservé et aucun outil Wispr`.
  - `inbox avec second cerveau : les règles Read/Edit/Write du dossier sont conservées`.
- [ ] **Step 2:** Lancer `npx vitest run src/runner/runner.test.ts` — attendu : FAIL.
- [ ] **Step 3:** Dans `argumentsClaude`, si `d.skill === 'alimenter-inbox'`, retirer `--strict-mcp-config` et ajouter `WISPR_OUTILS_LECTURE` à la liste `--allowedTools` ; commentaire : en mode non interactif tout outil non listé est refusé, donc les autres connecteurs claude.ai restent inutilisables.
- [ ] **Step 4:** Relancer le test — attendu : PASS.
- [ ] **Step 5:** Commit `feat(runner): la routine Inbox peut lire les réunions Wispr Flow`.

### Task 2: Table des réunions Wispr

**Files:**
- Modify: `src/inbox/schema.ts` (`ORIGINES_SUJET` + `'wispr'`, table `reunionsWispr`), `src/db/metier-tables.ts`
- Create: `drizzle/NNNN_*.sql` via `npx drizzle-kit generate`
- Test: `src/db/isolation.test.ts` (déjà générique : doit couvrir la nouvelle table)

**Interfaces:**
- Produces: table `reunionsWispr` : `id uuid`, `...metierColumns()`, `wisprId text not null`, `sujetId uuid not null → sujets.id`, `titre text`, `debutAt timestamptz`, `participants jsonb<string[]>`, `resume text`, `critique boolean default false`, `transcript text null`, `transcriptAt timestamptz null`, contrainte unique `(instanceId, wisprId)`, `instanceIsolation('reunions_wispr')`. Type `ReunionWispr = typeof reunionsWispr.$inferSelect`.

- [ ] **Step 1:** Ajouter la table et l'origine ; inscrire la table dans `metier-tables.ts`.
- [ ] **Step 2:** `npx drizzle-kit generate`, relire le SQL (RLS, unique), nom de migration cohérent.
- [ ] **Step 3:** `npx vitest run src/db src/migrate.test.ts` — attendu : PASS (isolation et migration).
- [ ] **Step 4:** Commit `feat(inbox): table des réunions Wispr Flow`.

### Task 3: Dépôt et rattachement des réunions

**Files:**
- Create: `src/inbox/reunions.ts`
- Test: `src/inbox/reunions.test.ts`

**Interfaces:**
- Consumes: `deposerSujet(tx, DepotSujet)` ([depot.ts](../../../src/inbox/depot.ts)), `reunionsWispr`.
- Produces :
  - `deposerReunion(tx: Tx, r: { wisprId: string; titre: string; debutAt: Date; participants: string[]; resume: string | null; contactId?: string | null; entrepriseId?: string | null; sujetExistantId?: string | null }): Promise<{ statut: 'cree' | 'existant' | 'relie'; sujetId: string }>`
  - `attribuerReunion(tx: Tx, sujetId: string, a: { contactId: string | null; entrepriseId: string | null; critique: boolean }): Promise<void>`
  - `reunionsATranscrire(tx: Tx): Promise<{ wisprId: string; sujetId: string }[]>` (critique = true et transcript null)
  - `enregistrerTranscript(tx: Tx, wisprId: string, transcript: string): Promise<void>` ; refus si non critique ou plus de 500 000 caractères.
  - `class ReunionInvalide extends Error`.

- [ ] **Step 1: Tests** (base de test comme `depot.test.ts`, données fictives) :
  - `crée une entrée compte_rendu d'origine wispr, clé = wisprId, et la réunion`.
  - `relu : statut existant, une seule entrée, critique et rattachement de Marc intacts`.
  - `sujetExistantId : aucune nouvelle entrée, la réunion est reliée (statut relie)`.
  - `sujetExistantId déjà traité : refusé, une nouvelle entrée est créée à la place`.
  - `sans participant connu : entrée créée, contactId et entrepriseId null`.
  - `attribuerReunion critique=false après transcript : transcript et transcriptAt remis à null`.
  - `enregistrerTranscript sur réunion non critique : ReunionInvalide, rien stocké`.
  - `enregistrerTranscript au-delà de 500 000 caractères : ReunionInvalide`.
  - `contact d'une autre instance : SujetInvalide` (via `deposerSujet`) et même `wisprId` dans deux instances : deux entrées distinctes.
- [ ] **Step 2:** `npx vitest run src/inbox/reunions.test.ts` — attendu : FAIL.
- [ ] **Step 3:** Implémenter ; le titre de l'entrée est « Compte rendu : {titre} », `priorite` par défaut, `lien` null ; `attribuerReunion` met aussi à jour `sujets.contactId` / `entrepriseId`.
- [ ] **Step 4:** Relancer — attendu : PASS.
- [ ] **Step 5:** Commit `feat(inbox): déposer et attribuer les réunions Wispr Flow`.

### Task 4: Outils MCP pour la routine

**Files:**
- Modify: `src/inbox/outils-mcp.ts`
- Test: `src/inbox/outils-mcp.test.ts`

**Interfaces:**
- Consumes: les fonctions de la Task 3.
- Produces (scope `instance`, `executionId` optionnel comme les autres) :
  - `deposer_reunion_wispr` : `{ wisprId, titre, debutAt (ISO avec fuseau), participants[], resume?, contactId?, entrepriseId?, sujetExistantId? }`
  - `comptes_rendus_en_attente` : sujets `compte_rendu` à traiter, `{ id, titre, contactId, entrepriseId, createdAt }[]`, pour que la routine repère le doublon.
  - `reunions_a_transcrire` : `{ wisprId, sujetId }[]`
  - `enregistrer_transcript` : `{ wisprId, transcript }`

- [ ] **Step 1: Tests** (comme les tests d'outils existants) : chaque outil appelle bien la fonction, valide ses entrées (`debutAt` sans fuseau refusé), et `comptes_rendus_en_attente` exclut les entrées traitées.
- [ ] **Step 2:** FAIL attendu, puis **Step 3:** enregistrer les 4 outils avec `registerTool`, descriptions en français disant quand les appeler. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(inbox): outils MCP des réunions Wispr Flow`.

### Task 5: API d'attribution et lecture

**Files:**
- Modify: `src/inbox/service.ts` (`SujetVue` + champ `reunion: { critique: boolean; transcriptStocke: boolean; participants: string[]; dejaRelie: boolean } | null`), `src/api/routes.ts`
- Test: `src/api/routes.test.ts` ou nouveau `src/api/reunions.routes.test.ts`

**Interfaces:**
- Consumes: `attribuerReunion`, `surSujet` (routes.ts).
- Produces: `POST /api/i/:slug/sujets/:id/reunion` avec corps strict `{ contactId: uuid|null, entrepriseId: uuid|null, critique: boolean }` ; 404 si le sujet n'est pas une réunion Wispr de cette instance ; 400 si corps invalide.

- [ ] **Step 1: Tests :** attribution valide met à jour l'entrée ; corps avec champ inconnu → 400 ; sujet d'une autre instance → 404 ; `listInbox` renvoie `reunion` pour une entrée wispr et `null` sinon.
- [ ] **Step 2:** FAIL, **Step 3:** implémenter, **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(inbox): attribuer une réunion Wispr Flow depuis l'API`.

### Task 6: Écran d'attribution dans l'Inbox

**Files:**
- Modify: `web/src/api.ts` (`attribuerReunion(slug, id, corps)`), `web/src/pages/Inbox.tsx`
- Test: `web/src/pages/Inbox.test.tsx`

**Interfaces:**
- Consumes: `SujetVue.reunion`, endpoint de la Task 5, `marquerTraite` existant.

- [ ] **Step 1: Tests :** une entrée avec `reunion` affiche un choix de contact/entreprise et une case « Réunion critique : garder le transcript complet » décochée par défaut ; valider appelle `attribuerReunion` avec les bons arguments ; une entrée `dejaRelie` affiche « Compte rendu trouvé dans Wispr Flow » et un bouton « Clore » qui appelle `marquerTraite`.
- [ ] **Step 2:** FAIL, **Step 3:** implémenter dans le style de l'écran existant (classes `panel`, `btn`, `small muted`), **Step 4:** PASS.
- [ ] **Step 5:** Vérifier dans le navigateur avec une entrée fictive (`preview_start`), puis `npm run verify`.
- [ ] **Step 6:** Commit `feat(inbox): attribuer une réunion Wispr Flow depuis l'écran Inbox`.

### Task 7: Skill de la routine et essai de bout en bout

**Files:**
- Hors dépôt : `~/.claude/skills/alimenter-inbox/SKILL.md` (lien vers le second cerveau). Rien de ce contenu ne va dans git.

- [ ] **Step 1:** Ajouter à la skill : lire les réunions Wispr récentes (`search_meetings`), appeler `comptes_rendus_en_attente`, rapprocher par participant et par jour, appeler `deposer_reunion_wispr` (avec `sujetExistantId` si doublon), puis `reunions_a_transcrire` → `get_meeting` → `enregistrer_transcript`.
- [ ] **Step 2:** Marc : « Lancer maintenant » la routine Inbox ; vérifier dans l'Inbox qu'une réunion récente apparaît, sans que rien ne soit écrit dans Wispr Flow.
- [ ] **Step 3:** Rebuild de l'app depuis `origin/main` après merge (voir mémoire « reconstruire l'app »), PR, revue, CI verte, merge.
