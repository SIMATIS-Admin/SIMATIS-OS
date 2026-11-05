# Gestion — Livraison 4 : calcul des factures à émettre — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un onglet « Factures » dans Gestion qui, par mandat, calcule ce qu'il faut facturer (récurrent, commission, frais, IK), avec un délai de paiement par mandat. Lecture seule : l'émission et la trésorerie sont la livraison 5.

**Architecture:** Un calcul serveur `facturesParMandat` regroupe les échéances de recettes prévues du mandat (déjà alimentées par la refacturation des dépenses) et les trajets IK cochés « refacturer ». Un moteur pur `assemblerFactures` fait la mise en forme ; une fine couche base de données le nourrit. L'écran lit une route unique.

**Tech Stack:** Fastify, Drizzle (Postgres), zod 4, React + Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-05-gestion-factures-a-emettre-design.md`

## Global Constraints

- Montants en centimes entiers ; recettes et factures **hors taxes**.
- Documentation et interface en français ; tests avec **données fictives uniquement** (dépôt public).
- Module réservé à une instance « propre » avec le module `gestion` (helper `dansGestion` de `src/gestion/routes.ts`).
- Nouvelle table : `metierColumns()` + `instanceIsolation(...)`, enregistrée dans `src/db/metier-tables.ts`.
- Migration Drizzle : générée par `npm run db:generate`, jamais écrite à la main ; contrôler que sa date `when` dépasse celle de la dernière migration appliquée (une autre session peut en avoir ajouté).
- Cadence d'émission : fin du mois en cours, non stockée.
- Une recette sans mandat n'entre jamais dans une facture.
- `npm run verify` avant chaque commit ; `git add` fichier par fichier, jamais `-A`.

## Review Focus

- Mandat dont les seules lignes sont des trajets IK sans barème validé : total 0, ligne signalée, pas d'erreur.
- Recette prévue dont le mandat est `null` : listée dans `sansMandat`, absente de toute carte.
- Trajet déjà validé pour transmission (`statut` figé) : on peut quand même cocher ou décocher « refacturer ».
- Dernier jour du mois : la date d'émission prévue est ce jour même et inclut les échéances de ce jour.
- Mandat sans réglage et sans délai général : encaissement attendu `null`, avertissement, pas de crash.

---

## File Structure

- Modify `src/gestion/schema.ts` : colonne `refacturer` sur les trajets, table `gestionMandatReglages`.
- Modify `src/db/metier-tables.ts` : enregistrer la nouvelle table.
- Create `drizzle/0076_*.sql` (générée).
- Modify `src/gestion/ik.ts` : `refacturer` dans `trajetSchema`, règle « exige un mandat », toggle sur trajet figé, `LigneIk.refacturer`.
- Create `src/gestion/mandats.ts` : lecture et écriture des délais par mandat.
- Create `src/gestion/factures.ts` : `assemblerFactures`, `facturesParMandat`.
- Modify `src/gestion/routes.ts` : routes réglages de mandat et factures.
- Modify `web/src/api.ts`, `web/src/pages/Gestion.tsx`, `web/src/pages/GestionIk.tsx`, `web/src/pages/gestion/Mouvements.tsx` ; create `web/src/pages/gestion/Factures.tsx`.
- Tests : `src/gestion/ik.routes.test.ts`, `src/gestion/mandats.routes.test.ts`, `src/gestion/factures.test.ts`, `web/src/pages/gestion/Factures.test.tsx`, `web/src/pages/GestionIk.test.tsx`, `web/src/pages/Gestion.test.tsx`.

---

### Task 1: Schéma et migration

**Files:**
- Modify: `src/gestion/schema.ts`
- Modify: `src/db/metier-tables.ts`
- Create: `drizzle/0076_*.sql` (par `npm run db:generate`)

**Interfaces:**
- Produces: `gestionIkTrajets.refacturer: boolean` (défaut `false`) ; `gestionMandatReglages` (`mandat: text`, `delaiPaiementJours: integer | null`, unique `(instanceId, mandat)`).

- [ ] **Step 1: Ajouter à `gestionIkTrajets` la colonne `refacturer: boolean('refacturer').notNull().default(false)`.**
- [ ] **Step 2: Ajouter `gestionMandatReglages` (`pgTable('gestion_mandat_reglages')`)** avec `...metierColumns()`, `mandat: text('mandat').notNull()`, `delaiPaiementJours: integer('delai_paiement_jours')`, index unique `gestion_mandat_reglages_idx` sur `(instanceId, mandat)` et `instanceIsolation('gestion_mandat_reglages')`, sur le modèle de `gestionImportCles`.
- [ ] **Step 3: Importer et ajouter `gestionMandatReglages` aux deux listes de `src/db/metier-tables.ts`** (import et tableau), comme `gestionImportCles`.
- [ ] **Step 4: Générer la migration** : `npm run db:generate`. Vérifier que le SQL contient `ADD COLUMN "refacturer"`, `CREATE TABLE "gestion_mandat_reglages"`, l'activation RLS et la politique d'isolation, et que la valeur `when` du journal est postérieure à celle de la migration 0075.
- [ ] **Step 5: Lancer `npx vitest run src/db`** ; attendu : PASS (les tests d'isolation des tables métier couvrent la nouvelle table).
- [ ] **Step 6: Commit** : `git add src/gestion/schema.ts src/db/metier-tables.ts drizzle/` puis `feat(gestion): colonne refacturer des trajets et délais par mandat`.

---

### Task 2: Trajets IK refacturables

**Files:**
- Modify: `src/gestion/ik.ts`
- Test: `src/gestion/ik.routes.test.ts`

**Interfaces:**
- Consumes: `gestionIkTrajets.refacturer` (Task 1).
- Produces: `trajetSchema.refacturer: boolean` (défaut `false`) ; `LigneIk.refacturer: boolean` ; erreur `IkInvalide` quand `refacturer` est vrai sans mandat.

- [ ] **Step 1: Écrire les tests dans `ik.routes.test.ts`** (instances fictives du fichier : `ik-propre`, mandat `ik-mandat`) :
  - `refuse un trajet refacturer sans mandat` : POST `/ik/trajets` avec `refacturer: true` et sans `mandat` → 400.
  - `crée un trajet refacturable et l'expose dans l'état du mois` : avec `mandat: 'ik-mandat'`, `refacturer: true` ; `etat(mois).lignes[0]` contient `refacturer: true` et `mandat: 'ik-mandat'`.
  - `décoche refacturer sur un trajet validé pour transmission` : trajet validé (voir les tests de validation existants), PATCH `{ refacturer: false }` → 200 ; PATCH `{ km: 5 }` sur le même trajet → toujours refusé (400).
  - `refuse de retirer le mandat d'un trajet refacturable` : PATCH `{ mandat: null }` alors que `refacturer` est vrai → 400.
- [ ] **Step 2: Lancer `npx vitest run src/gestion/ik.routes.test.ts`** ; attendu : FAIL.
- [ ] **Step 3: Implémenter dans `ik.ts`** : `refacturer: z.boolean().default(false)` dans `trajetSchema` (le `partial()` du patch ne réapplique pas le défaut) ; `LigneIk.refacturer` rempli par `etatIkMois` ; dans `creerTrajet`, refuser (`IkInvalide('Un trajet refacturé doit avoir un mandat.')`) si `refacturer` sans `mandat` ; dans `modifierTrajet`, calculer l'état final (`{...actuel, ...patch}`) avec la même règle, et laisser passer un patch composé uniquement de `refacturer` même si le trajet est dans `FIGES`.
- [ ] **Step 4: Relancer le fichier de tests ; attendu : PASS.**
- [ ] **Step 5: Commit** : `git add src/gestion/ik.ts src/gestion/ik.routes.test.ts` puis `feat(gestion): trajets IK refacturables à un mandat`.

---

### Task 3: Délai de paiement par mandat

**Files:**
- Create: `src/gestion/mandats.ts`
- Modify: `src/gestion/routes.ts`
- Test: `src/gestion/mandats.routes.test.ts`

**Interfaces:**
- Produces: `lireDelaisMandats(tx: Executor): Promise<Map<string, number | null>>` ; `ecrireDelaiMandat(tx: Executor, instanceId: string, mandat: string, delaiPaiementJours: number | null): Promise<void>` ; `delaiMandatSchema = z.object({ delaiPaiementJours: z.number().int().min(0).max(365).nullable() })` ; routes `GET /api/i/:slug/gestion/mandats/reglages` → `{ mandat: string; delaiPaiementJours: number | null }[]` et `PUT /api/i/:slug/gestion/mandats/:mandat/reglages`.

- [ ] **Step 1: Écrire `mandats.routes.test.ts`** sur le modèle de `ik.routes.test.ts` (instance propre + un mandat fictif) :
  - `GET` renvoie une liste vide au départ ;
  - `PUT` avec `{ delaiPaiementJours: 45 }` puis `GET` renvoie `[{ mandat: 'ma-mandat', delaiPaiementJours: 45 }]` ;
  - `PUT` avec `null` efface le délai (le mandat reste listé avec `null`) ;
  - `PUT` avec `400` jours ou un slug invalide (`'Pas Un Slug'`) → 400 ;
  - un second `PUT` met à jour sans créer de doublon.
- [ ] **Step 2: Lancer le fichier ; attendu : FAIL (404).**
- [ ] **Step 3: Implémenter `mandats.ts`** : `ecrireDelaiMandat` fait un `insert … onConflictDoUpdate` sur `(instanceId, mandat)`. Dans `routes.ts`, enregistrer les deux routes via `dansGestion` (validation par `SLUG` et `delaiMandatSchema`, `invalide(reply)` sinon) ; la route `PUT` écrit un `logEvent` de niveau L2 comme la route des réglages de trésorerie.
- [ ] **Step 4: Relancer ; attendu : PASS.**
- [ ] **Step 5: Commit** : `git add src/gestion/mandats.ts src/gestion/routes.ts src/gestion/mandats.routes.test.ts` puis `feat(gestion): délai de paiement par mandat`.

---

### Task 4: Calcul des factures à émettre

**Files:**
- Create: `src/gestion/factures.ts`
- Modify: `src/gestion/routes.ts`
- Test: `src/gestion/factures.test.ts`

**Interfaces:**
- Consumes: `OccurrenceRevenu` et `occurrencesRevenus(tx, de, a)` (`src/gestion/revenus.ts`) ; `etatIkMois(tx, mois, vehiculeId)` et `LigneIk` (`ik.ts`) ; `lireDelaisMandats` (Task 3) ; `lireReglages(tx)` (`tresorerie.ts`, champ `delaiPaiementJours`) ; `ajouterJours` (`dates.ts`).
- Produces :
  - `type SorteLigne = 'recurrent' | 'commission' | 'frais' | 'ik'`
  - `type LigneFacture = { cle: string; sorte: SorteLigne; libelle: string; date: string; montantHtCents: number | null; tvaCents: number | null; certitude: 'certaine' | 'probable' | 'hypothese' | null; avertissement: string | null }`
  - `type FactureAEmettre = { mandat: string; emissionPrevue: string; delaiJours: number | null; encaissementAttendu: string | null; totalHtCents: number; lignes: LigneFacture[]; avertissements: string[] }`
  - `type FacturesAEmettre = { factures: FactureAEmettre[]; sansMandat: LigneFacture[] }`
  - `type IkRefacturable = { trajetId: string; mandat: string; date: string; libelle: string; indemniteCents: number | null }`
  - `dateEmissionPrevue(aujourdhui: string): string` (dernier jour du mois de `aujourdhui`)
  - `assemblerFactures(e: { recettes: OccurrenceRevenu[]; ik: IkRefacturable[]; delaisMandat: Map<string, number | null>; delaiGeneral: number | null; aujourdhui: string }): FacturesAEmettre` (pur)
  - `facturesParMandat(tx: Executor, aujourdhui?: string): Promise<FacturesAEmettre>` ; route `GET /api/i/:slug/gestion/factures`.

- [ ] **Step 1: Écrire les tests purs dans `factures.test.ts`** (`describe('assemblerFactures')`, recettes fictives construites avec un helper `recette(o: Partial<OccurrenceRevenu>)`) :
  - `dateEmissionPrevue('2026-11-12')` vaut `'2026-11-30'`, `('2026-11-30')` vaut `'2026-11-30'`, `('2026-02-10')` vaut `'2026-02-28'`.
  - `range les recettes par sorte` : types `abonnement` → `recurrent`, `commission` et `autre` → `commission`, `refacturation` → `frais`.
  - `exclut ce qui n'est pas prévu` : états `emise`, `encaissee`, `ignoree` et certitude `hypothese` sont absents.
  - `exclut les échéances après la date d'émission prévue` (une échéance au 1er du mois suivant).
  - `regroupe par mandat et additionne le total hors taxes`, deux mandats séparés, ordre alphabétique des mandats.
  - `met les recettes sans mandat à part` dans `sansMandat`.
  - `calcule l'encaissement attendu` : délai du mandat 45 j → émission + 45 ; sans délai de mandat, repli sur `delaiGeneral` ; ni l'un ni l'autre → `encaissementAttendu: null` et un avertissement dans `avertissements`.
  - `signale une ligne dont la TVA est inconnue` : `tvaCents: null` sur une recette `refacturation` → `avertissement: 'TVA à renseigner'`, montant conservé.
  - `ajoute les trajets IK au montant du barème` ; `un trajet sans barème a un montant null, un avertissement, et n'entre pas dans le total`.
  - `un mandat avec seulement des IK sans barème a un total de 0` sans erreur.
- [ ] **Step 2: Écrire le test base de données** (`describe('facturesParMandat')`, instance fictive comme dans `ik.routes.test.ts`) : créer un mandat, une recette `refacturation` prévue, un trajet `refacturer: true` avec un barème validé, un trajet non refacturable et une recette sans mandat ; vérifier le contenu de `facturesParMandat(tx, '2026-11-12')` et que `GET /gestion/factures` renvoie la même structure.
- [ ] **Step 3: Lancer `npx vitest run src/gestion/factures.test.ts` ; attendu : FAIL.**
- [ ] **Step 4: Implémenter `assemblerFactures` et `dateEmissionPrevue`** : filtres sur `etat === 'prevue'`, `certitude !== 'hypothese'`, `date <= emissionPrevue` ; clé de ligne `revenu:<cle de l'occurrence>` pour les recettes et `ik:<trajetId>` pour les trajets ; total = somme des montants non nuls.
- [ ] **Step 5: Implémenter `facturesParMandat`** : recettes via `occurrencesRevenus(tx, <aujourd'hui − 2 ans>, emissionPrevue)` comme le fait `facturesAEmettre` de `revenus.ts` ; trajets `refacturer` avec mandat et date ≤ émission, regroupés par `(vehiculeId, mois)` pour appeler `etatIkMois` une fois par groupe et lire `indemniteCents` des lignes concernées ; délais via `lireDelaisMandats` et `lireReglages`.
- [ ] **Step 6: Ajouter la route `GET /api/i/:slug/gestion/factures`** dans `routes.ts` via `dansGestion`.
- [ ] **Step 7: Relancer le fichier ; attendu : PASS.**
- [ ] **Step 8: Commit** : `git add src/gestion/factures.ts src/gestion/routes.ts src/gestion/factures.test.ts` puis `feat(gestion): calcul des factures à émettre par mandat`.

---

### Task 5: Onglet Factures

**Files:**
- Modify: `web/src/api.ts`, `web/src/pages/Gestion.tsx`, `web/src/pages/gestion/Mouvements.tsx`
- Create: `web/src/pages/gestion/Factures.tsx`
- Test: `web/src/pages/gestion/Factures.test.tsx`, `web/src/pages/Gestion.test.tsx`

**Interfaces:**
- Consumes: la route `GET /gestion/factures` et `PUT /gestion/mandats/:mandat/reglages` (Tasks 3 et 4).
- Produces: types miroirs `LigneFacture`, `FactureAEmettre`, `FacturesAEmettre` dans `web/src/api.ts` ; `fetchFactures(slug: string): Promise<FacturesAEmettre>` ; `poserDelaiMandat(slug: string, mandat: string, delaiPaiementJours: number | null): Promise<{ ok: true }>` ; composant `Factures({ factures, mandats, onDelai }: { factures: FacturesAEmettre; mandats: { slug: string; nom: string }[]; onDelai: (mandat: string, jours: number | null) => void })`.

- [ ] **Step 1: Écrire `Factures.test.tsx`** (données fictives) :
  - `affiche une carte par mandat avec son total HT, sa date d'émission prévue et la date d'encaissement attendue` ;
  - `détaille les lignes par sorte (Récurrent, Commission, Frais, IK)` ;
  - `affiche les avertissements d'une ligne et d'une facture` (ex. « TVA à renseigner », encaissement inconnu) ;
  - `liste à part les recettes sans mandat` ;
  - `saisir un délai appelle onDelai avec le nombre de jours` (champ « Délai de paiement (jours) » validé à la sortie du champ) ;
  - `sans aucune facture, affiche « Rien à facturer »`.
- [ ] **Step 2: Mettre à jour `Gestion.test.tsx`** : l'onglet « Factures » existe (5 onglets) et un clic charge la liste.
- [ ] **Step 3: Lancer `npx vitest run --root web web/src/pages/gestion/Factures.test.tsx` (ou la commande du `web/package.json`) ; attendu : FAIL.**
- [ ] **Step 4: Implémenter** : types et fonctions dans `api.ts` (sur le modèle de `fetchFacturesAEmettre`) ; `Factures.tsx` (une carte par mandat, nom lu dans `mandats`, montants formatés comme dans `Mouvements.tsx`) ; dans `Gestion.tsx`, ajouter `'factures'` au type `Onglet` et à `ONGLETS` après « Mouvements », charger `fetchFactures` dans `charger()` et appeler `poserDelaiMandat` puis recharger ; dans `Mouvements.tsx`, remplacer la liste « Factures à émettre (30 prochains jours) » par un lien vers l'onglet Factures.
- [ ] **Step 5: Relancer les deux fichiers de tests ; attendu : PASS.**
- [ ] **Step 6: Commit** : `git add web/src/api.ts web/src/pages/Gestion.tsx web/src/pages/gestion/Mouvements.tsx web/src/pages/gestion/Factures.tsx web/src/pages/gestion/Factures.test.tsx web/src/pages/Gestion.test.tsx` puis `feat(gestion): onglet Factures à émettre`.

---

### Task 6: Mandat et case « refacturer » sur les trajets IK

**Files:**
- Modify: `web/src/api.ts`, `web/src/pages/GestionIk.tsx`, `web/src/pages/Gestion.tsx`
- Test: `web/src/pages/GestionIk.test.tsx`

**Interfaces:**
- Consumes: `trajetSchema.refacturer` et `LigneIk.refacturer`/`mandat` (Task 2).
- Produces: `creerTrajetIk` accepte `mandat?: string | null` et `refacturer?: boolean` ; `modifierTrajetIk(slug: string, id: string, patch: { refacturer?: boolean; mandat?: string | null }): Promise<unknown>` ; `LigneIk` (web) expose `mandat: string | null` et `refacturer: boolean` ; `GestionIk` reçoit `mandats: { slug: string; nom: string }[]`.

- [ ] **Step 1: Écrire les tests dans `GestionIk.test.tsx`** :
  - `le formulaire de trajet propose un mandat et une case « Refacturer »` ; la case est désactivée tant qu'aucun mandat n'est choisi ;
  - `créer un trajet refacturable envoie mandat et refacturer` (vérifier l'appel à `creerTrajetIk`) ;
  - `cocher « Refacturer » sur une ligne existante appelle modifierTrajetIk` avec `{ refacturer: true }`, case désactivée si la ligne n'a pas de mandat.
- [ ] **Step 2: Lancer le fichier ; attendu : FAIL.**
- [ ] **Step 3: Implémenter** : champs `mandat` et `refacturer` dans l'état `traj` du formulaire, `<select>` des mandats (option vide « Aucun mandat ») et case à cocher ; colonne « Refacturer » dans le tableau des trajets ; ajouter `modifierTrajetIk` (PATCH `gestion/ik/trajets/:id`) et les champs manquants aux types de `api.ts` ; passer `mandats` de `Gestion.tsx` à `GestionIk`.
- [ ] **Step 4: Relancer ; attendu : PASS.**
- [ ] **Step 5: Commit** : `git add web/src/api.ts web/src/pages/GestionIk.tsx web/src/pages/Gestion.tsx web/src/pages/GestionIk.test.tsx` puis `feat(gestion): refacturer un trajet IK à un mandat`.

---

### Task 7: Vérification complète

- [ ] **Step 1: `npm run verify`** ; attendu : format, lint, types, tests et build au vert.
- [ ] **Step 2: Contrôle dans le navigateur** (serveur de dev lancé en tâche de fond suivie, arrêté ensuite) : onglet Factures avec un mandat fictif, délai saisi, trajet IK coché « refacturer » visible dans la carte.
- [ ] **Step 3: Pousser la branche, ouvrir la PR, relecture indépendante, CI verte** ; ne pas fusionner sans la validation de Marc.
