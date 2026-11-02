# Enrichissement de listes par IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis la base vivante, enrichir en lot des fiches (trouver des contacts, compléter mails et téléphones) par l'API OpenAI avec recherche web, le profil recherché étant choisi par Marc à chaque lancement, et ne rien écrire sans sa validation.

**Architecture:** Nouveau module `src/enrichissement/` : un client OpenAI derrière une interface (faux dans les tests), un traitement de lot en arrière-plan (état gardé en base, un appel par fiche), des suggestions stockées avec source et confiance, puis une validation qui passe par les fonctions existantes de `src/base-vivante/integration.ts` (seul fichier autorisé à écrire dans `base_vivante`). L'interface s'ajoute à la barre de sélection de `BaseTable.tsx`.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres, RLS par instance), zod, vitest, React. API OpenAI Responses via `fetch`, sans nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-11-02-enrichissement-ia-design.md`

## Global Constraints

- Dépôt public : tests et exemples avec des données **fictives uniquement** (entreprises « Atelier Fictif », « Bureau Fictif », adresses en `.test`). Aucun nom, mail ou téléphone réel, aucune réponse réelle d'OpenAI dans un test, un commentaire ou un commit.
- Clé API : variable serveur `OPENAI_API_KEY`, ajoutée à `.env.example` **sans valeur** ; jamais dans les journaux, jamais dans l'image Docker.
- Chaque table métier : `...metierColumns()`, `instanceIsolation('<table>')`, ajoutée à `METIER_TABLES` dans `src/db/metier-tables.ts` (enfants avant parents).
- Seul `src/base-vivante/integration.ts` écrit dans `base_vivante` (test `integration.test.ts` le vérifie) : toute écriture de fiche passe par lui.
- Aucune écriture dans une fiche sans validation de Marc ; une valeur déjà présente n'est jamais écrasée.
- Mails construits par motif : mode `deduit`, jamais `trouve`. Une donnée sans URL source `https://` n'est jamais `trouve`.
- Plafonds appliqués côté serveur : taille de lot (`ENRICHISSEMENT_LOT_MAX`, défaut 10), jetons par lot (`ENRICHISSEMENT_BUDGET_JETONS`, défaut 400000), parallélisme 3.
- Interface en français ; commentaires : le pourquoi seulement ; style du fichier voisin.
- `npm run verify` vert avant chaque commit ; fichiers ajoutés explicitement (jamais `git add -A`), `git diff --staged` relu.

## Review Focus

- Réponse du modèle vide, refusée, non JSON ou hors schéma : la fiche passe en échec, rien n'est écrit (Task 3, Task 5).
- Mail ou téléphone sans source, ou mail au format invalide : jamais présenté comme « trouvé » (Task 3).
- Fiche supprimée, déjà enrichie, en opposition ou exclue (client, partenaire, concurrent) pendant ou avant le lot : ignorée avec sa raison (Task 5, Task 6).
- Quota ou clé refusée (401, 429, 5xx) : lot interrompu proprement, fiches restantes marquées, message clair, clé jamais affichée (Task 1, Task 5).
- Même personne proposée deux fois, ou déjà dans la base sous une autre fiche : doublon écarté, valeur existante gardée (Task 3, Task 6).

---

### Task 1: Configuration et client OpenAI

**Files:**

- Modify: `src/config.ts`, `src/config.test.ts`, `.env.example`
- Create: `src/enrichissement/client.ts`, `src/enrichissement/client.test.ts`

**Interfaces:**

- Produces (config) : `Config.enrichissement: { cle: string; modele: string; lotMax: number; budgetJetons: number } | null` ; `null` sans `OPENAI_API_KEY`. Variables : `OPENAI_API_KEY`, `ENRICHISSEMENT_MODELE` (défaut `gpt-5-mini`, à confirmer à l'essai de la Task 9), `ENRICHISSEMENT_LOT_MAX` (défaut 10, entier 1–50), `ENRICHISSEMENT_BUDGET_JETONS` (défaut 400000).
- Produces (client) :
  - `type DemandeIA = { consigne: string; entree: string; schema: object }`
  - `type ReponseIA = { json: unknown; jetons: number }`
  - `interface ClientIA { demander(d: DemandeIA): Promise<ReponseIA> }`
  - `class ErreurIA extends Error { constructor(message: string, readonly fatale: boolean) }` (`fatale` = clé refusée ou quota : arrête tout le lot)
  - `creerClientOpenAI(cfg: { cle: string; modele: string }, fetchFn?: FetchLike): ClientIA`

- [ ] **Step 1: Tests de configuration (`config.test.ts`)** : sans `OPENAI_API_KEY`, `enrichissement` vaut `null` ; avec clé, valeurs par défaut `lotMax 10`, `budgetJetons 400000`, `modele 'gpt-5-mini'` ; `ENRICHISSEMENT_LOT_MAX=0` ou `51` lève « Configuration invalide ».
- [ ] **Step 2: Tests du client (`client.test.ts`, faux `fetch`)** :
  - envoie un POST sur `https://api.openai.com/v1/responses` avec `Authorization: Bearer <cle>`, `tools: [{ type: 'web_search' }]` et un format de sortie JSON strict reprenant `schema` ; renvoie `{ json, jetons }` lus dans le corps (texte de sortie parsé, jetons = entrée + sortie) ;
  - HTTP 401 et 429 → `ErreurIA` avec `fatale: true` ; 500 → `fatale: false` ; corps non JSON → `fatale: false` ;
  - le message d'erreur ne contient jamais la clé (assertion `not.toContain(cle)`).
- [ ] **Step 3: Lancer les tests** (`npx vitest run src/config.test.ts src/enrichissement/client.test.ts`) : attendu FAIL.
- [ ] **Step 4: Implémenter** la config (zod, même style que `VMA_OS_TOKEN`, préprocesseur `vide`) et le client. Une tentative de nouvel essai (1 seconde) sur 5xx seulement.
- [ ] **Step 5: Lancer les tests** : attendu PASS. Ajouter les quatre variables à `.env.example`, sans valeur.
- [ ] **Step 6: Commit** `feat(enrichissement): configuration et client OpenAI`.

### Task 2: Tables et migration

**Files:**

- Modify: `src/db/metier-tables.ts`
- Create: `src/enrichissement/schema.ts`, `src/enrichissement/schema.test.ts`, migration `drizzle/0065_enrichissement.sql` (générée)

**Interfaces:**

- Produces (`schema.ts`) :
  - `TYPES_ENRICHISSEMENT = ['contacts', 'completer'] as const`
  - `ETATS_TACHE = ['en_cours', 'terminee', 'interrompue'] as const`
  - `ETATS_LIGNE = ['attente', 'en_cours', 'terminee', 'echec', 'ignoree'] as const`
  - `ETATS_SUGGESTION = ['a_valider', 'acceptee', 'refusee'] as const`
  - `enrichissementTaches` : `id`, `metierColumns`, `type`, `profil` (jsonb `string[]`), `maxParEntreprise` (int), `etat`, `jetons` (int, défaut 0), `erreur` (text, nullable)
  - `enrichissementLignes` : `id`, `metierColumns`, `tacheId` (FK taches, cascade), `ficheId` (FK `baseVivante.id`, cascade), `etat`, `raison` (text, nullable)
  - `enrichissementSuggestions` : `id`, `metierColumns`, `tacheId` (FK, cascade), `ficheId` (FK `baseVivante.id`, cascade), `prenom`, `nom`, `fonction`, `email`, `telephone` (text, nullables), `sourceUrl` (text, nullable), `confiance` (`'haute'|'moyenne'|'basse'`), `modeEmail` (`'trouve'|'deduit'`, nullable), `etat`
  - types `Tache`, `Ligne`, `Suggestion` (`$inferSelect`)

- [ ] **Step 1: Test (`schema.test.ts`)** sur une base de test (`setupTestApp`) : une suggestion créée dans l'instance A est invisible depuis l'instance B (`withInstance`), et supprimer la fiche supprime lignes et suggestions.
- [ ] **Step 2: Lancer** : attendu FAIL.
- [ ] **Step 3: Écrire `schema.ts`** dans le style de `src/prospection/schema.ts` ; ajouter les trois tables à `METIER_TABLES` (suggestions, lignes, tâches, avant `baseVivante`).
- [ ] **Step 4: Générer la migration** (`npm run db:generate`), relire le SQL, vérifier la présence des politiques RLS comme dans `0061`/`0063`.
- [ ] **Step 5: Lancer** `npx vitest run src/enrichissement/schema.test.ts src/migrate.test.ts src/db` : attendu PASS.
- [ ] **Step 6: Commit** `feat(enrichissement): tables des tâches, lignes et suggestions`.

### Task 3: Consigne, schéma de réponse et analyse

**Files:**

- Create: `src/enrichissement/analyse.ts`, `src/enrichissement/analyse.test.ts`

**Interfaces:**

- Consumes : `Suggestion` (Task 2).
- Produces :
  - `type Candidat = Pick<Suggestion, 'prenom' | 'nom' | 'fonction' | 'email' | 'telephone' | 'sourceUrl' | 'confiance' | 'modeEmail'>`
  - `type FicheAEnrichir = { entreprise: string; domaine: string | null; prenom: string | null; nom: string | null; fonction: string | null; email: string | null; telephone: string | null }`
  - `SCHEMA_REPONSE: object` (JSON Schema strict : `contacts[]` de `{ prenom, nom, fonction, email, telephone, sourceUrl, confiance, modeEmail }`, champs inconnus à `null`)
  - `consigne(type: TypeEnrichissement, profil: string[], maxParEntreprise: number): string` : texte générique, cite les fonctions saisies, exige une URL source par donnée, interdit d'inventer, demande `modeEmail: 'deduit'` pour une adresse construite par motif.
  - `entree(fiche: FicheAEnrichir): string` : entreprise, domaine, et pour `completer` le contact connu.
  - `analyserReponse(json: unknown, max: number): Candidat[]` : jette `ErreurAnalyse` si hors schéma.

- [ ] **Step 1: Tests (`analyse.test.ts`)**, entreprises fictives :
  - `consigne` contient chaque fonction saisie (« responsable achats ») et ne contient aucune consigne figée de décideur quand le profil est autre ;
  - réponse valide à 2 contacts → 2 candidats, tronqués à `max` ;
  - réponse vide `{ contacts: [] }` → `[]` ; JSON hors schéma, chaîne, `null` → `ErreurAnalyse` ;
  - e-mail sans `sourceUrl` ou avec `sourceUrl` en `http://` → `modeEmail: 'deduit'` et `confiance: 'basse'` ; téléphone sans source → `null` ;
  - e-mail invalide (`jean@`, `a b@x.test`) → `null` ;
  - même personne (même prénom+nom, casse et accents ignorés) deux fois → un seul candidat, celui qui a le plus de champs.
- [ ] **Step 2: Lancer** : FAIL. **Step 3: Implémenter**, zod pour la validation, le schéma JSON écrit à la main. **Step 4: Lancer** : PASS.
- [ ] **Step 5: Commit** `feat(enrichissement): consigne, schéma de réponse et analyse`.

### Task 4: Application d'une suggestion dans la base

**Files:**

- Modify: `src/base-vivante/integration.ts`, `src/base-vivante/integration.test.ts`

**Interfaces:**

- Consumes : `enrichir(tx, instanceId, id, apport)`, `integrerFiches(tx, instanceId, items)`, `Apport` (existants).
- Produces : `appliquerContact(tx: Tx, instanceId: string, ficheId: string, apport: Apport): Promise<{ id: string; zone: Zone; creee: boolean }>` :
  - si la fiche n'a ni nom ni prénom : appelle `enrichir` (elle devient la fiche du contact) ;
  - sinon, si `apport.nom` désigne la même personne que la fiche (même clé de doublon) : complète **seulement** les champs vides, jamais un champ rempli ;
  - sinon : crée, via `integrerFiches`, une nouvelle fiche de la même entreprise, provenance `Enrichissement IA`, qui fusionne avec un doublon existant.

- [ ] **Step 1: Tests (`integration.test.ts`)**, avec `insererFiche` :
  - fiche « Atelier Fictif » sans contact + apport complet → même fiche, zone `prospectable`, `creee: false` ;
  - fiche avec contact « Claire Martin » sans téléphone + apport même personne avec téléphone et un autre e-mail → téléphone ajouté, e-mail **inchangé** ;
  - fiche avec contact + apport d'une autre personne → nouvelle fiche, même entreprise, `creee: true`, la première intacte ;
  - apport d'une personne déjà présente sous une autre fiche de l'entreprise → pas de doublon (`creee: false`) ;
  - le test existant « seul integration.ts écrit dans base_vivante » reste vert.
- [ ] **Step 2: Lancer** : FAIL. **Step 3: Implémenter** `appliquerContact` dans `integration.ts`. **Step 4: Lancer** : PASS.
- [ ] **Step 5: Commit** `feat(enrichissement): application d'un contact trouvé dans la base`.

### Task 5: Traitement d'un lot

**Files:**

- Create: `src/enrichissement/lot.ts`, `src/enrichissement/lot.test.ts`

**Interfaces:**

- Consumes : `ClientIA`, `ErreurIA` (Task 1), tables (Task 2), `consigne`, `entree`, `analyserReponse`, `SCHEMA_REPONSE` (Task 3), `withInstance`.
- Produces :
  - `type ParamsLot = { type: TypeEnrichissement; profil: string[]; maxParEntreprise: number; ficheIds: string[] }`
  - `type ReglagesLot = { lotMax: number; budgetJetons: number; parallelisme: number }`
  - `class LotRefuse extends Error` (lot vide, trop grand, profil vide pour `contacts`, tâche déjà en cours sur l'instance)
  - `lancerLot(db: Executor, client: ClientIA, reglages: ReglagesLot, instanceId: string, p: ParamsLot): Promise<Tache>` : valide, crée la tâche et les lignes (`attente`, ou `ignoree` avec raison pour fiche absente, en opposition, exclue, ou, pour `contacts`, qui a déjà un contact complet), répond tout de suite, traite en arrière-plan et renvoie une promesse de fin via `attendreLot(tacheId): Promise<void>` (utilisée par les tests) ;
  - `etatLot(db, instanceId, tacheId): Promise<{ tache: Tache; lignes: Ligne[] }>` ;
  - `reprendreLotsInterrompus(db: Executor): Promise<void>` : au démarrage, les lignes `en_cours` repassent `attente` et les tâches `en_cours` sont relancées.

- [ ] **Step 1: Tests (`lot.test.ts`)**, faux `ClientIA` scriptable :
  - 3 fiches, réponses valides → tâche `terminee`, lignes `terminee`, suggestions `a_valider` créées avec `tacheId` et `ficheId` ;
  - une réponse hors schéma → cette ligne `echec` avec raison, les autres terminent ;
  - `ErreurIA` fatale (401) à la deuxième fiche → tâche `interrompue`, lignes restantes `ignoree` avec raison « Clé refusée ou quota atteint », aucune suggestion pour la ligne en cause ;
  - budget : le faux client renvoie 300 jetons, budget 500 → après dépassement les lignes non commencées passent `ignoree` (« Budget du lot atteint ») ;
  - lot de 11 fiches avec `lotMax: 10` → `LotRefuse` ; `ficheIds: []` → `LotRefuse` ; `profil: []` avec `type: 'contacts'` → `LotRefuse` ;
  - fiche en `opposition`, fiche `exclusion: 'client'`, fiche supprimée avant le lancement → `ignoree` avec raison ; le client n'est **pas** appelé pour elles ;
  - `parallelisme: 3` : jamais plus de 3 appels simultanés (compteur dans le faux client) ;
  - un second `lancerLot` sur la même instance pendant qu'un lot tourne → `LotRefuse` ;
  - `reprendreLotsInterrompus` relance une tâche laissée `en_cours` avec une ligne `en_cours` ;
  - la clé n'apparaît dans aucune raison ni erreur stockée.
- [ ] **Step 2: Lancer** : FAIL. **Step 3: Implémenter** (file simple avec 3 travailleurs ; un travail = un appel `client.demander`, jetons additionnés dans la tâche). **Step 4: Lancer** : PASS.
- [ ] **Step 5: Commit** `feat(enrichissement): traitement des lots en arrière-plan`.

### Task 6: Validation des suggestions

**Files:**

- Create: `src/enrichissement/validation.ts`, `src/enrichissement/validation.test.ts`

**Interfaces:**

- Consumes : `appliquerContact` (Task 4), `Suggestion` (Task 2).
- Produces :
  - `suggestionsDeLaTache(db, instanceId, tacheId): Promise<(Suggestion & { entreprise: string; contactExistant: string | null })[]>` (état `a_valider` d'abord) ;
  - `valider(db: Executor, instanceId: string, tacheId: string, accepter: string[], refuser: string[]): Promise<{ appliquees: number; creees: number }>` : applique chaque suggestion acceptée par `appliquerContact`, passe les états, ne touche jamais une suggestion déjà traitée ; atomique par suggestion.

- [ ] **Step 1: Tests (`validation.test.ts`)** :
  - accepter une suggestion sur fiche « à enrichir » → fiche `prospectable`, suggestion `acceptee` ;
  - refuser → fiche inchangée, suggestion `refusee` ;
  - une suggestion non cochée reste `a_valider` ;
  - valider deux fois la même suggestion → deuxième fois sans effet ;
  - identifiant d'une autre instance ou d'une autre tâche → ignoré sans erreur ;
  - suggestion dont la fiche a été supprimée entre-temps (cascade) → absente, pas d'erreur ;
  - un e-mail `deduit` accepté est écrit tel quel mais `suggestionsDeLaTache` l'expose avec `modeEmail: 'deduit'`.
- [ ] **Step 2: Lancer** : FAIL. **Step 3: Implémenter.** **Step 4: Lancer** : PASS.
- [ ] **Step 5: Commit** `feat(enrichissement): validation des suggestions par Marc`.

### Task 7: Routes et branchement dans l'application

**Files:**

- Create: `src/enrichissement/routes.ts`, `src/enrichissement/routes.test.ts`
- Modify: `src/app.ts`, `src/server.ts` (reprise des lots au démarrage)

**Interfaces:**

- Consumes : `lancerLot`, `etatLot`, `suggestionsDeLaTache`, `valider`, `Config.enrichissement`.
- Produces (toutes sous `/api/i/:slug/base/enrichissement`, même garde `surInstance` que `base-vivante/routes.ts`) :
  - `GET /` → `{ disponible: boolean; lotMax: number; tacheEnCours: string | null }` ;
  - `POST /` corps `{ type, profil: string[], maxParEntreprise (1–5), ficheIds: string[] }` → 202 `Tache` ; 409 `{ error: 'Clé OpenAI absente' }` sans configuration ; 400 sur `LotRefuse` ;
  - `GET /:tacheId` → `{ tache, lignes }` ;
  - `GET /:tacheId/suggestions` → liste ;
  - `POST /:tacheId/valider` corps `{ accepter: string[]; refuser: string[] }` → `{ appliquees, creees }`.
  - `registerEnrichissementRoutes(app, { db, enrichissement: Config['enrichissement'], client?: ClientIA })`.

- [ ] **Step 1: Tests (`routes.test.ts`)**, faux client injecté : parcours complet lancer → attendre → lire suggestions → valider → fiche mise à jour ; sans configuration `GET /` → `disponible: false` et `POST /` → 409 ; `ficheIds` en dehors de l'instance ignorés ; identifiant invalide → 400 ; instance inconnue → 404 ; réponses sans clé API.
- [ ] **Step 2: Lancer** : FAIL. **Step 3: Implémenter**, brancher dans `app.ts` et appeler `reprendreLotsInterrompus` au démarrage dans `server.ts`. **Step 4: Lancer** : PASS.
- [ ] **Step 5: Commit** `feat(enrichissement): routes et branchement`.

### Task 8: Interface : lancement et panneau de validation

**Files:**

- Modify: `web/src/api.ts`, `web/src/pages/BaseTable.tsx`, `web/src/pages/Bases.test.tsx`, `web/src/styles.css`
- Create: `web/src/pages/EnrichissementIA.tsx`, `web/src/pages/EnrichissementIA.test.tsx`

**Interfaces:**

- Consumes : routes de la Task 7.
- Produces : fonctions `api.ts` `etatEnrichissement(slug)`, `lancerEnrichissement(slug, p)`, `lireEnrichissement(slug, tacheId)`, `suggestionsEnrichissement(slug, tacheId)`, `validerEnrichissement(slug, tacheId, accepter, refuser)` ; composants `<LancerEnrichissement slug fichesIds onFermer onLance />` (fenêtre) et `<SuggestionsEnrichissement slug tacheId onFini />` (panneau).

- [ ] **Step 1: Tests (`EnrichissementIA.test.tsx`, fetch simulé)** :
  - fenêtre : choix du type, champ « Fonctions recherchées » (saisie libre, plusieurs valeurs, suggestions « Dirigeant », « DRH », « Responsable achats »), nombre max par entreprise, mention « les noms d'entreprises sont envoyés à OpenAI » ; bouton Lancer désactivé sans fonction pour `contacts` ; envoie le corps attendu ;
  - panneau : lignes groupées par entreprise, source cliquable (`target="_blank"`, `rel="noopener noreferrer"`), badge « déduit » sur un e-mail déduit, rien de coché par défaut pour un e-mail déduit, bouton « Valider la sélection » n'envoie que les cochés ;
  - fiches ignorées ou en échec listées avec leur raison ;
  - `disponible: false` : le bouton « Enrichir » est absent (test dans `Bases.test.tsx`), et présent quand disponible.
- [ ] **Step 2: Lancer** : FAIL. **Step 3: Implémenter** : bouton « Enrichir » dans `bv-selection` (`BaseTable.tsx`), sondage de la tâche toutes les 2 secondes tant que `en_cours`, styles dans le style existant. **Step 4: Lancer** : PASS.
- [ ] **Step 5: Vérifier dans le navigateur** (serveur de dev lancé en tâche de fond, faux client activé par configuration de test) : lancement sur 3 fiches fictives, panneau, validation ; capture d'écran jointe au résumé.
- [ ] **Step 6: Commit** `feat(enrichissement): lancement et validation dans la base`.

### Task 9: Essai réel et réglage du lot (avec Marc)

**Files:** aucun fichier du dépôt avec des données réelles ; seul le défaut `ENRICHISSEMENT_LOT_MAX` peut changer dans `src/config.ts`.

- [ ] **Step 1:** Marc crée sa clé sur la plateforme développeur OpenAI, la colle dans son `.env` local (`OPENAI_API_KEY`), l'app est reconstruite et relancée depuis `origin/main` après merge.
- [ ] **Step 2:** Lancer l'enrichissement sur 5 fiches de la base de Marc, noter : durée, jetons utilisés (champ `jetons` de la tâche), part de contacts avec source, mails « déduits », erreurs. Puis 10 fiches. Rien de réel n'est écrit dans le dépôt : seuls des chiffres agrégés sont rapportés.
- [ ] **Step 3:** Fixer `ENRICHISSEMENT_LOT_MAX` et le modèle par défaut d'après les mesures ; relancer `npm run verify` ; commit `chore(enrichissement): taille de lot et modèle par défaut`.
- [ ] **Step 4:** Fin de feature (consignes du dépôt) : PR, revue, CI verte, merge, reconstruction du conteneur ; mise à jour du second cerveau (`brain/outils/simatis-os-structure.md`, `simatis-os-feuille-de-route.md`, note dans `log.md`), sans rien copier dans le dépôt ; explication pas à pas pour tester, destinée à Marc.
