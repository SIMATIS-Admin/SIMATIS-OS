# Gestion, livraison 1 : navigation et Mouvements — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ramener la section Gestion de 6 onglets à 3 (Pilotage, Mouvements, TVA & IK) et réunir dépenses et recettes dans une liste unique, sans changer les données ni l'API.

**Architecture:** Interface seulement (dossier `web/`). Une fonction pure fusionne dépenses et recettes en `Mouvement[]` ; un composant `Mouvements` affiche la liste et délègue les actions à `Gestion.tsx`, qui garde le chargement des données et les tiroirs. L'onglet Importer et le verdict de pilotage viennent aux livraisons 3 et 2.

**Tech Stack:** React, TypeScript, Vitest + Testing Library (jsdom), CSS global `web/src/styles.css`.

**Spec:** `docs/superpowers/specs/2026-11-03-gestion-refonte-design.md` (sections « Navigation », « Pilotage », « Mouvements », « TVA & IK »).

## Global Constraints

- Montants en centimes entiers, affichés par `eurCents` (`web/src/gestion.ts`) ; jamais de flottant stocké.
- Les dépenses sont en **TTC**, les recettes en **HT** : chaque ligne affiche sa base, jamais de somme mélangeant les deux.
- Données de test **fictives** uniquement ; aucun nom de client, montant ni solde réel (dépôt public).
- Interface en français, sentence case. Aucune modification de `src/` (serveur) ni de la base.
- Un seul agent travaille dans le dépôt : vérifier `git branch --show-current`, partir de `origin/main` à jour, jamais de travail sur `main`.
- Avant chaque commit : relire `git diff --staged`, ajouter les fichiers explicitement (pas de `git add -A`).
- `npm run verify` vert avant chaque commit ; CI verte avant merge.

## Review Focus

- Mois sans aucune dépense ni recette : message d'invitation à ajouter un mouvement, pas un tableau vide.
- Dépense et recette à la même date : ordre stable (date décroissante, puis dépenses avant recettes, puis libellé).
- Occurrence « ignorée » : visible, grisée, exclue du total affiché.
- Dépense payée par l'associé : mention « compte d'associé, sans sortie bancaire » conservée.
- Filtre « Dépenses » avec « Refacturables » actif : n'affiche aucune recette.

## Fichiers

- Create `web/src/pages/gestion/mouvements.ts` : type `Mouvement`, `fusionnerMouvements`, `filtrerMouvements` (purs).
- Create `web/src/pages/gestion/mouvements.test.ts`.
- Create `web/src/pages/gestion/Mouvements.tsx` : liste unique, filtres, totaux, panneau « Factures à émettre ».
- Create `web/src/pages/gestion/Mouvements.test.tsx`.
- Modify `web/src/pages/Gestion.tsx` : onglets, câblage, regroupement TVA & IK.
- Modify `web/src/pages/Gestion.test.tsx` : trois tests qui cliquent d'anciens onglets.
- Modify `web/src/styles.css` : classes `.g-mv-*` (près de `.g-onglets`, ligne ~5519).

---

### Task 1: Fusion et filtrage des mouvements

**Files:**
- Create: `web/src/pages/gestion/mouvements.ts`
- Test: `web/src/pages/gestion/mouvements.test.ts`

**Interfaces:**
- Consumes: `OccurrenceDepense`, `OccurrenceRevenu` de `web/src/api.ts`.
- Produces:
  - `type Mouvement = { cle: string; sens: 'depense' | 'recette'; date: string; libelle: string; detail: string; origine: 'Saisi' | 'Récurrent'; etat: 'payee' | 'prevue' | 'emise' | 'encaissee' | 'ignoree'; base: 'TTC' | 'HT'; montantCents: number /* signé : dépense < 0, recette > 0 */; depense?: OccurrenceDepense; recette?: OccurrenceRevenu }`
  - `fusionnerMouvements(depenses: OccurrenceDepense[], revenus: OccurrenceRevenu[]): Mouvement[]`
  - `type FiltreMouvement = 'tout' | 'depenses' | 'recettes' | 'prevus' | 'recurrents'`
  - `filtrerMouvements(m: Mouvement[], f: { type: FiltreMouvement; refacturables: boolean; recherche: string; affectation: string }, nomAff: (a: { cible: string; mandat?: string }) => string): Mouvement[]`

- [ ] **Step 1: Write the failing tests** in `mouvements.test.ts`, avec deux dépenses et deux recettes fictives (helpers `dep()` et `rec()` aux champs complets) :
  - `fusionne en signant les montants` : dépense 12 000 → `montantCents === -12000`, `base === 'TTC'` ; recette 50 000 → `+50000`, `base === 'HT'`.
  - `trie par date décroissante puis dépenses avant recettes puis libellé` : trois lignes à la même date, ordre attendu vérifié sur les `cle`.
  - `la date d'une recette encaissée est sa date d'encaissement`.
  - `origine Récurrent pour une occurrence récurrente, Saisi sinon`.
  - `l'état d'une dépense a_venir devient prevue ; payee reste payee`.
  - `filtre depenses n'inclut aucune recette, même avec refacturables`.
  - `filtre prevus garde les dépenses a_venir et les recettes prevue ou emise`.
  - `la recherche porte sur libellé, catégorie et affectations`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/pages/gestion/mouvements.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `mouvements.ts`. `detail` = catégorie (dépense, « Sans catégorie » si vide) ou type de recette lu dans `TYPES_REVENU` (`GestionRevenuTiroir.tsx`) ; pour une dépense de l'associé, ajouter « compte d'associé, sans sortie bancaire ».
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add web/src/pages/gestion/mouvements.ts web/src/pages/gestion/mouvements.test.ts && git commit -m "feat(gestion): fusionner dépenses et recettes en mouvements"`.

### Task 2: Composant Mouvements

**Files:**
- Create: `web/src/pages/gestion/Mouvements.tsx`
- Test: `web/src/pages/gestion/Mouvements.test.tsx` (en-tête `// @vitest-environment jsdom`, comme `Gestion.test.tsx`)

**Interfaces:**
- Consumes: `Mouvement`, `FiltreMouvement`, `filtrerMouvements` (Task 1) ; `eurCents`, `jourCourt` (`web/src/gestion.ts`) ; `OccurrenceRevenu`.
- Produces: `Mouvements(props: { mouvements: Mouvement[]; aFacturer: OccurrenceRevenu[]; bandeau: { label: string; valeur: string }[]; periode: ReactNode; mandats: string[]; nomAff: (a: { cible: string; mandat?: string }) => string; filtreInitial?: FiltreMouvement; onOuvrir(m: Mouvement): void; onDupliquer(m: Mouvement): void; onRetirer(m: Mouvement): void; onMarquerFacturee(r: OccurrenceRevenu): void; onAjouter(): void })`.

- [ ] **Step 1: Write the failing tests**, props passées directement (pas de réseau) :
  - `affiche dépenses en neutre et recettes en vert avec leur base` : « − 120 € » et « TTC » pour la dépense, « + 500 € » et « HT » pour la recette.
  - `les puces filtrent la liste` : cliquer « Recettes » masque la dépense.
  - `une ligne ignorée est grisée et exclue du total affiché` : la classe `muted` est présente et le total ne la compte pas.
  - `liste vide : invite à ajouter un mouvement` : cliquer le lien appelle `onAjouter`.
  - `cliquer une ligne appelle onOuvrir avec le mouvement ; Dupliquer n'apparaît que sur une dépense`.
  - `le panneau Factures à émettre n'apparaît que s'il y en a, et Marquer facturée appelle onMarquerFacturee`.
  - `filtreInitial recettes s'applique au premier rendu`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/pages/gestion/Mouvements.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** `Mouvements.tsx` en reprenant le balisage actuel de `Gestion.tsx` (tableau `tbl`, `g-lib`, `g-act`, panneau « Factures à émettre », texte d'aide « Cliquer une ligne… ») ; colonnes Date, Mouvement, Origine, État, Montant. Puces : Tout, Dépenses, Recettes, Prévus, Récurrents ; en plus : sélecteur d'affectation, puce Refacturables, recherche (comportement actuel). Le total affiché ne mélange pas les bases : deux totaux, « Dépenses TTC » et « Recettes HT ».
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add web/src/pages/gestion/Mouvements.tsx web/src/pages/gestion/Mouvements.test.tsx && git commit -m "feat(gestion): liste unique des mouvements"`.

### Task 3: Navigation à trois onglets

**Files:**
- Modify: `web/src/pages/Gestion.tsx` (`ONGLETS` l. 42-49 ; `vue` ; `depenses` et `revenus` à retirer ; rendu l. 762-)
- Modify: `web/src/pages/Gestion.test.tsx` (l. 174, 238, 248, 271)
- Modify: `web/src/styles.css` (classes `.g-mv-sens`, `.g-mv-neg`, `.g-mv-pos` : montant vert pour une recette, couleur d'encre pour une dépense)

**Interfaces:**
- Consumes: `Mouvements` (Task 2), `fusionnerMouvements` (Task 1), `GestionTresorerie`, `GestionTva`, `GestionIk` (inchangés).
- Produces: `type Onglet = 'pilotage' | 'mouvements' | 'tva'` ; onglets « Pilotage », « Mouvements », « TVA & IK ».

- [ ] **Step 1: Update the tests first** (ils échouent tant que la navigation n'a pas changé) :
  - l. 174 (création d'une dépense, clic sur l'onglet « Dépenses ») → onglet « Mouvements ».
  - l. 238 et 248 (projection, seuil) : retirer le clic sur « Trésorerie » ; la projection est dans « Pilotage », onglet par défaut.
  - l. 271 (TVA) → onglet « TVA & IK » puis bouton « TVA » du sélecteur interne.
  - Ajouter `propose exactement trois onglets` : `getAllByRole('tab')` renvoie « Pilotage », « Mouvements », « TVA & IK ».
  - Ajouter `Voir les recettes ouvre Mouvements filtré sur les recettes`.
  - Ajouter `TVA & IK : un sélecteur bascule entre TVA et IK sans quitter l'onglet`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/pages/Gestion.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** dans `Gestion.tsx` :
  - `Onglet` à trois valeurs ; état `filtreMouvement` transmis à `Mouvements` via `filtreInitial` et `key`.
  - **Pilotage** : la `vue` actuelle (cartes, graphique des dépenses 12 mois), puis `GestionTresorerie`, puis le tableau « Revenus par mandat » déplacé ici. Les liens des cartes : « Voir les récurrentes » → `mouvements` filtre `recurrents` ; « Voir les recettes » → filtre `recettes` ; « Voir la TVA » → `tva` ; « Voir la projection » supprimé (la projection est dessous).
  - **Mouvements** : `Mouvements` alimenté par `fusionnerMouvements(donnees.occurrences, recettes.revenus)`. Les callbacks reprennent `ouvrir`, `ouvrirRevenu`, `ignorer`, `retirerRevenu`, `ouvrir(o, true)` selon `m.sens`. Bandeau : payé, à venir, à encaisser (certain), encaissé.
  - **TVA & IK** : deux boutons-puces « TVA » et « IK & compte associé » au-dessus de `GestionTva` / `GestionIk` (état local `sousOnglet`, défaut `tva`).
  - Boutons « + Dépense » et « + Recette » et la touche N : inchangés.
  - Supprimer le code devenu inutilisé (`depenses`, `revenus`, `filtre`, `Filtre`, `visibles`) sans autre refactoring.
- [ ] **Step 4: Run** `cd web && npx vitest run src/pages/Gestion.test.tsx src/pages/gestion` — Expected: PASS.
- [ ] **Step 5: Commit** `git add web/src/pages/Gestion.tsx web/src/pages/Gestion.test.tsx web/src/styles.css && git commit -m "feat(gestion): trois onglets, mouvements unifiés"`.

### Task 4: Vérification, PR et mémoire

**Files:** aucune modification de code attendue.

- [ ] **Step 1:** `npm run verify` à la racine — Expected: format, lint, types, tests et build verts.
- [ ] **Step 2: Vérifier dans le navigateur** (serveur de dev lancé en tâche de fond suivie, jamais avec `&`) : ouvrir Gestion, parcourir les trois onglets, créer une dépense et une recette, filtrer, ouvrir un tiroir, vérifier la console sans erreur. Largeur mobile (375 px) : pas de défilement horizontal de la page. Arrêter le serveur ensuite.
- [ ] **Step 3:** ouvrir la PR, faire la revue de code, corriger, attendre la CI verte, merger (processus de `AGENTS.md`). Reconstruire l'app et relancer le conteneur depuis `origin/main`.
- [ ] **Step 4:** mettre à jour dans le second cerveau `brain/outils/simatis-os-structure.md` et `brain/outils/simatis-os-feuille-de-route.md`, noter dans `log.md`, sans rien copier dans le dépôt.
- [ ] **Step 5:** expliquer à Marc, pas à pas, comment tester (Gestion › Pilotage, Mouvements, TVA & IK).
