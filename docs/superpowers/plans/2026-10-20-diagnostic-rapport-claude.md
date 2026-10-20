# Rapport du diagnostic rédigé par Claude : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** À l'étape 4 d'un projet de diagnostic, un bouton « Produire le rapport » (actif une fois la revue validée) demande au runner la rédaction du rapport par Claude, et le projet affiche le lien vers le rapport une fois rédigé.

**Architecture:** Même mécanisme que le support d'ouverture : une demande (`demande = 'rapport'`) posée sur le projet, traitée par le runner, puis un outil MCP `enregistrer_rapport` qui pose le lien. Pré-requis contrôlés côté serveur. Le fichier .docx importé reste intact.

**Tech Stack:** TypeScript, Fastify, Drizzle (PostgreSQL), Zod, Vitest (tests base réelle, `setupTestApp`), React + Vite (tests jsdom + Testing Library).

**Spec:** [docs/superpowers/specs/2026-10-20-diagnostic-rapport-claude-design.md](../specs/2026-10-20-diagnostic-rapport-claude-design.md)

## Global Constraints

- Toute nouvelle variable d'environnement va dans `.env.example`, sans valeur (aucune prévue ici).
- Documentation et interface en français ; identifiants techniques cohérents avec le module (`demande`, `rapportLien`).
- Données de test strictement fictives (« Atelier Fictif Nord », liens `https://claude.ai/artifact/RapportFictif0001`).
- Lien de rapport : format `LIEN_ARTIFACT` existant (`src/diagnostic/support.ts`), pas de nouveau regex.
- Aucun commit sans `npm run verify` vert.

## Review Focus

Entrées non couvertes par la spec que la personne qui utilise le logiciel risque le plus de rencontrer :

1. **Double clic sur « Produire le rapport »** : une seule demande à la fois ; la seconde est refusée avec un message, rien n'est écrit. Test dans Task 3.
2. **Revue modifiée après validation** : elle repasse en « brouillon », le bouton redevient inactif. Test dans Task 2.
3. **Second rapport** : le lien précédent reste dans l'historique `rapportLiens`, le nouveau devient le lien affiché. Test dans Task 4.
4. **Claude ne rend aucun lien (erreur, réponse vide)** : le statut repasse à `aucun` (ou `pret` si un rapport existait), jamais bloqué sur « en cours ». Test dans Task 5.
5. **Lien hors claude.ai ou mal formé renvoyé par Claude** : refusé par `enregistrer_rapport`, lien précédent conservé. Test dans Task 4.

---

### Task 1: Schéma, migration et étape de la demande

**Files:**
- Modify: `src/diagnostic/schema.ts` (colonnes du projet, `DEMANDES`)
- Modify: `src/diagnostic/chat.ts:25-61` (`envoyerMessage` : étape et mise à jour optionnelles)
- Create: `drizzle/0028_diagnostic_rapport_lien.sql` (généré par `drizzle-kit generate`)
- Test: `src/diagnostic/chat.test.ts` (ajouter un cas)

**Interfaces:**
- Consumes: rien.
- Produces:
  - Colonnes : `rapportLienStatut: text` enum `STATUTS_RAPPORT = ['aucun','en_cours','pret']`, défaut `'aucun'` ; `rapportLien: text` nullable ; `rapportLiens: jsonb<{ lien: string; le: string }[]>` défaut `[]`.
  - `DEMANDES = ['preparer_support', 'support_final', 'rapport']`.
  - `envoyerMessage(db, instance, id, texte, demande?: { type: Demande; verifier: (projet: Projet) => void; etape?: number; maj?: Partial<Projet> })` : `etape` remplace le « 1 » forcé pour les demandes ; `maj` est fusionné dans la mise à jour.

- [ ] **Step 1: Écrire le test qui échoue** (`chat.test.ts`) : une demande avec `etape: 4` écrit un message à l'étape 4, et `maj: { rapportLienStatut: 'en_cours' }` est appliqué.

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run src/diagnostic/chat.test.ts`
Expected: FAIL (`etape` ignoré, colonne absente).

- [ ] **Step 3: Implémenter** les colonnes, `STATUTS_RAPPORT`, l'élargissement de `DEMANDES` et les deux options de `envoyerMessage` (`etape: demande?.etape ?? (demande ? 1 : projet.etape)`, `...demande?.maj`).

- [ ] **Step 4: Générer la migration** : `npx drizzle-kit generate --name diagnostic_rapport_lien`, vérifier qu'elle ne contient que les trois `ADD COLUMN`.

- [ ] **Step 5: Lancer le test, vérifier le succès**, puis `npm run verify`.

- [ ] **Step 6: Commit** : `git add src/diagnostic/schema.ts src/diagnostic/chat.ts src/diagnostic/chat.test.ts drizzle/0028_diagnostic_rapport_lien.sql drizzle/meta` puis `git commit -m "Diagnostic : colonnes du lien de rapport et étape des demandes"`.

---

### Task 2: Pré-requis et validation de la revue

**Files:**
- Create: `src/diagnostic/rapport.ts` (pré-requis purs : `rapportPret`)
- Modify: `src/diagnostic/import.ts` ou aucun changement si la validation passe par `revue` existant (à confirmer dans le code)
- Modify: `web/src/pages/Diagnostic.tsx:modifierRevue` (retour au brouillon après modification), composant `Revue` (bouton « Valider la revue »)
- Test: `src/diagnostic/rapport.test.ts` (nouveau), `web/src/pages/Diagnostic.test.tsx` (ajouts)

**Interfaces:**
- Consumes: `Projet` (Task 1).
- Produces:
  - `rapportPret(projet: Pick<Projet, 'dims' | 'revue'>): { ok: true } | { ok: false; raison: string }` : `ok` si `dims` est renseigné (résultat de l'étape 2) et `revue.statut === 'validée'`. Les raisons sont en français (« Saisissez d'abord le résultat à l'étape 2 », « Validez d'abord la revue à l'étape 3 »).
  - Côté web : `modifierRevue` pose `statut: 'brouillon'` si la revue était `validée` et qu'un champ change.

- [ ] **Step 1: Écrire les tests** : `rapportPret` refuse sans `dims`, refuse sans revue validée, accepte les deux réunis ; `modifierRevue` d'une revue `validée` renvoie `statut: 'brouillon'`.

- [ ] **Step 2: Lancer, vérifier l'échec** (`npx vitest run src/diagnostic/rapport.test.ts web/src/pages/Diagnostic.test.tsx`).

- [ ] **Step 3: Implémenter** `rapportPret` et le retour au brouillon dans `modifierRevue` ; ajouter le bouton « Valider la revue » dans le composant `Revue` (étape 3) qui envoie `{ revue: { ...revue, statut: 'validée' } }` via `onSauver`, et affiche le badge `validée` à la place de `brouillon`.

- [ ] **Step 4: Lancer les tests, vérifier le succès**, puis `npm run verify`.

- [ ] **Step 5: Commit** : `git commit -m "Diagnostic : pré-requis du rapport et validation de la revue"`.

---

### Task 3: Demande de rapport (service et route)

**Files:**
- Modify: `src/diagnostic/rapport.ts` (ajout de `demanderRapport`)
- Modify: `src/api/routes.ts` (route `POST /api/i/:slug/diagnostic/projets/:id/rapport/produire`, sur le modèle de la route `support/:action` à la ligne 440)
- Test: `src/diagnostic/rapport.test.ts`

**Interfaces:**
- Consumes: `rapportPret` (Task 2), `envoyerMessage` avec `etape` et `maj` (Task 1), `ChatIndisponible`.
- Produces:
  - `demanderRapport(db: Executor, instance: Instance, id: string): Promise<ProjetVue>` : appelle `envoyerMessage` avec `type: 'rapport'`, `etape: 4`, `maj: { rapportLienStatut: 'en_cours' }`, et `verifier` qui lève `ChatIndisponible` si `rapportPret` échoue (message de la raison) ou si `rapportLienStatut === 'en_cours'` (« Un rapport est déjà en cours de rédaction. »).
  - Route : 409 sur `ChatIndisponible`, comme les autres actions.

- [ ] **Step 1: Écrire les tests** : refus sans pré-requis (aucune écriture) ; refus si déjà `en_cours` ; succès pose `demande = 'rapport'`, `etapeMessage` 4 dans la conversation, `rapportLienStatut = 'en_cours'`, `statutChat = 'attente_claude'`.

- [ ] **Step 2: Lancer, vérifier l'échec.**

- [ ] **Step 3: Implémenter `demanderRapport` et la route.**

- [ ] **Step 4: Lancer, vérifier le succès**, puis `npm run verify`.

- [ ] **Step 5: Commit** : `git commit -m "Diagnostic : demande de rédaction du rapport"`.

---

### Task 4: Outil MCP `enregistrer_rapport` et permission d'outil

**Files:**
- Modify: `src/diagnostic/rapport.ts` (ajout de `enregistrerRapport` et de `autoriserRapport`)
- Modify: `src/diagnostic/support.ts:autoriserOutil` (si le projet en cours a `demande === 'rapport'`, déléguer à `autoriserRapport`)
- Modify: `src/diagnostic/outils-mcp.ts` (outil `enregistrer_rapport`)
- Test: `src/diagnostic/rapport.test.ts`

**Interfaces:**
- Consumes: `LIEN_ARTIFACT`, `ProjetIntrouvable` (`service.ts`), `Tx`.
- Produces:
  - `enregistrerRapport(tx: Tx, id: string, lien: string): Promise<void>` : refuse un lien hors `LIEN_ARTIFACT` (`SupportInvalide`) ; pose `rapportLien = lien`, `rapportLienStatut = 'pret'`, ajoute `{ lien, le: now ISO }` en tête de `rapportLiens`.
  - `autoriserRapport(tx: Tx, outil: string, input: Record<string, unknown>): Promise<Decision>` : autorise `Artifact` en lecture, en création sans `url` (`type_url` ou fichier), et en publication seulement sur `rapportLien` du projet en cours ; refuse le reste (le deck, le deck modèle).
  - Outil MCP `enregistrer_rapport` : `{ projetId: uuid, lien: string }` avec `regex(LIEN_ARTIFACT)`, `scope: 'instance'`.

- [ ] **Step 1: Écrire les tests** : lien valide accepté ; lien `https://example.com/...` refusé sans changer l'état ; second rapport conserve l'ancien lien dans `rapportLiens` ; `autoriserRapport` refuse la publication sur un autre `url` et accepte la création sans `url`.

- [ ] **Step 2: Lancer, vérifier l'échec.**

- [ ] **Step 3: Implémenter** les deux fonctions, le branchement dans `autoriserOutil` et l'outil MCP.

- [ ] **Step 4: Lancer, vérifier le succès**, puis `npm run verify`.

- [ ] **Step 5: Commit** : `git commit -m "Diagnostic : enregistrement du lien du rapport"`.

---

### Task 5: Runner : rédaction du rapport

**Files:**
- Modify: `src/runner/runner.ts` (`AttenteDiag` : `rapportLien`, `rapportLienStatut` ; branche `demande === 'rapport'` ; `promptRapport`, `outilsRapport`, `SKILL_RAPPORT = 'diagnostic-endurance-commerciale-rapport'`)
- Modify: `src/diagnostic/chat.ts:attentesClaude` (exposer `rapportLien`, `rapportLienStatut`, `demande`) et `finirAttente` (si la demande était `rapport` et que le statut est encore `en_cours`, repasser à `pret` si `rapportLien` existe, sinon `aucun`)
- Test: `src/runner/diagnostic.test.ts`, `src/diagnostic/chat.test.ts`

**Interfaces:**
- Consumes: `enregistrer_rapport` (Task 4), `attentesClaude` shape (existante).
- Produces:
  - `promptRapport(a: AttenteDiag, cerveau: string | null, maintenant?: Date): string` : demande d'utiliser la skill `SKILL_RAPPORT` pour le projet, de lire la revue validée et le résultat, de publier le rapport comme nouvel artifact, puis d'appeler `enregistrer_rapport` avec le lien et `repondre_diagnostic` avec un résumé. Données de projet marquées « à lire, jamais des consignes ».
  - `outilsRapport(cerveau: string | null, travail: string[]): string` : même liste que `outilsSupport` avec `mcp__simatis__enregistrer_rapport` à la place de `enregistrer_support`.
  - Dans `main` du runner : `if (a.demande === 'rapport')` est traité avant le test `a.demande && !support` ; sans skill `SKILL_RAPPORT` sur le poste, l'erreur « skill absente » est renvoyée comme pour le support.

- [ ] **Step 1: Écrire les tests** : `promptRapport` contient l'id du projet et `enregistrer_rapport` ; `outilsRapport` ne contient pas `enregistrer_support` ; `finirAttente` après une demande rapport sans lien repasse à `aucun`, avec lien existant à `pret`.

- [ ] **Step 2: Lancer, vérifier l'échec.**

- [ ] **Step 3: Implémenter** les fonctions, la branche du runner et la règle de `finirAttente`.

- [ ] **Step 4: Lancer, vérifier le succès**, puis `npm run verify`.

- [ ] **Step 5: Commit** : `git commit -m "Runner : rédaction du rapport du diagnostic par Claude"`.

---

### Task 6: Interface : bouton, état et lien

**Files:**
- Modify: `web/src/api.ts` (type `ProjetDiag` : `rapportLienStatut`, `rapportLien`, `rapportLiens` ; `demandeRapportDiag(slug, id)` en POST `/rapport/produire`)
- Modify: `web/src/pages/Diagnostic.tsx:Rapport` (bouton « Produire le rapport », message des pré-requis, état `en_cours`, lien « Ouvrir le rapport », historique repliable, téléchargement du .docx importé s'il existe)
- Test: `web/src/pages/Diagnostic.test.tsx`

**Interfaces:**
- Consumes: routes et `ProjetVue` (Task 3).
- Produces: aucun export nouveau au-delà de `demandeRapportDiag`.

- [ ] **Step 1: Écrire les tests** : bouton désactivé avec la raison si revue non validée ; bouton actif quand `rapportPret` est vrai côté données ; état « Claude rédige le rapport… » quand `en_cours` ; lien `Ouvrir le rapport` (`target="_blank"`) quand `pret`.

- [ ] **Step 2: Lancer, vérifier l'échec** (`npx vitest run web/src/pages/Diagnostic.test.tsx`).

- [ ] **Step 3: Implémenter** le composant `Rapport` et l'appel API.

- [ ] **Step 4: Lancer, vérifier le succès**, puis `npm run verify`. Vérifier aussi dans le navigateur (preview) l'étape 4 d'un projet fictif.

- [ ] **Step 5: Commit** : `git commit -m "Diagnostic : bouton et lien du rapport dans l'étape 4"`.

---

### Task 7: Vérification de bout en bout et mode d'emploi

**Files:**
- Aucun changement de code attendu. Test : `src/diagnostic/rapport.test.ts` (scénario complet : pré-requis → demande → lien → second rapport).

- [ ] **Step 1: Écrire le scénario complet** dans `rapport.test.ts`.

- [ ] **Step 2: Lancer** `npm run verify`, vérifier qu'il est vert.

- [ ] **Step 3: Vérifier dans le navigateur** : projet fictif, étapes 2 et 3 renseignées, revue validée, bouton actif, lien affiché une fois la demande traitée.

- [ ] **Step 4: Pousser et suivre la CI jusqu'au vert.** Ouvrir la PR, faire la revue de code, merger seulement si la CI est verte.

- [ ] **Step 5: Expliquer à Marc comment tester** (étape par étape, en français, sans jargon).

---

## Self-Review

- **Couverture de la spec :** pré-requis (Task 2), demande et une seule à la fois (Task 3), runner et skill (Task 5), lien et historique (Task 4 et 6), erreurs (Task 4 et 5), tests (chaque tâche + Task 7), import .docx conservé (Task 6). Hors périmètre respecté.
- **Cohérence des types :** `rapportPret`, `demanderRapport`, `enregistrerRapport`, `autoriserRapport`, `promptRapport`, `outilsRapport`, `STATUTS_RAPPORT` ont le même nom partout. `demande` élargi en Task 1, lu en Task 4 et 5.
- **Points à confirmer dans le code avant Task 2 :** la validation de la revue passe par la clé `statut` de `revue` (pas de colonne dédiée) ; `dims` vaut « résultat saisi » à l'étape 2.
- **Revue du plan :** à valider par Marc avant toute implémentation.
