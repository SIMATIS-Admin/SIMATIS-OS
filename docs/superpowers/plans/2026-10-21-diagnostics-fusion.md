# Diagnostics : fusion du Diagnostic et des Tests VMA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les entrées « Diagnostic » et « Tests VMA » du menu par une section « Diagnostics » où chaque entreprise regroupe son diagnostic et ses tests VMA, avec pagination, recherche et aperçu du résultat VMA.

**Architecture:** Une migration ajoute `entreprise_id` (facultatif) à `diagnostic_projets` ; un script de rapprochement, en simulation par défaut, rattache les projets existants. Côté web, le regroupement, la pagination, la recherche et l'aperçu VMA sont des fonctions pures testées à part ; un nouvel écran `Diagnostics` les assemble. L'écran projet existant (`Diagnostic.tsx`) et l'écran de création VMA (`TestsVma.tsx`) sont réutilisés, sans réécriture de leur contenu.

**Tech Stack:** TypeScript, Drizzle (PostgreSQL), Fastify, Vitest, React, Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-21-diagnostics-fusion-design.md`. Maquette : `maquettes/diagnostics-fusion.html`.

## Global Constraints

- Français pour l'interface et les messages ; code et identifiants techniques en français ou anglais, de façon cohérente avec le fichier modifié.
- Données de test uniquement fictives (noms du type « Entreprise Fictive A »). Aucun nom réel, aucun résultat réel dans le dépôt.
- Aucune suppression de données : la migration ne fait qu'ajouter une colonne facultative.
- Aucune écriture réelle sur un système tiers. Le rapprochement est en simulation par défaut.
- `npm run verify` vert avant chaque commit ; une PR par fonctionnalité, CI verte avant merge.
- Pas de `--no-verify`, pas de `push --force`, pas de `git add -A`.

## Review Focus

- Entreprise sans aucun diagnostic ni test VMA (ligne vide) : affichée avec « Pas encore lancé » et « Aucun », pas masquée.
- Diagnostic rattaché à une entreprise supprimée ou introuvable : affiché dans un groupe « Sans entreprise », jamais perdu.
- Recherche avec accents et majuscules (« Élodie » / « elodie ») : trouve la même entreprise.
- Recherche qui réduit la liste à moins d'une page alors que la page courante était la 3 : la pagination revient à une page valide.
- Un essai (type `essai`) ne doit jamais entrer dans le graphique d'évolution ni dans le calcul de l'écart.

---

### Task 1: Colonne `entreprise_id` sur les projets de diagnostic

**Files:**
- Modify: `src/diagnostic/schema.ts` (table `diagnosticProjets`, ajouter `entrepriseId` et un index)
- Create: `drizzle/0032_diagnostic_entreprise.sql` (généré par drizzle-kit, puis relu)
- Modify: `drizzle/meta/_journal.json` (ajout généré)
- Test: `src/diagnostic/service.test.ts` (ajouter un cas)

**Interfaces:**
- Consumes: `entreprises` depuis `src/crm/schema.ts`.
- Produces: `diagnosticProjets.entrepriseId: string | null` (uuid, référence `entreprises.id`, `onDelete: 'set null'`).

- [ ] **Step 1: Write the failing test**

Dans `src/diagnostic/service.test.ts`, ajouter dans le `describe` existant :

```ts
it('rattache un projet à une entreprise et la garde à la relecture', async () => {
  const entrepriseId = await creerEntrepriseFictive(t, simatis, 'Entreprise Fictive A');
  const projet = await createProjet(t.owner.db, simatis, {
    nom: 'Projet rattaché',
    activite: 'Conseil',
    entrepriseId,
  });
  const relu = (await listProjets(t.owner.db, simatis)).find((p) => p.id === projet.id);
  expect(relu?.entrepriseId).toBe(entrepriseId);
});
```

`creerEntrepriseFictive` est un helper à créer dans le même fichier de test : il insère une ligne `entreprises` (`nom`, `instanceId`) avec le client de `t.owner.db` et renvoie son id.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/diagnostic/service.test.ts -t "rattache"`
Expected: FAIL (`entrepriseId` absent du schéma ou de `createProjet`).

- [ ] **Step 3: Ajouter la colonne au schéma et générer la migration**

Dans `diagnosticProjets`, ajouter `entrepriseId: uuid('entreprise_id').references(() => entreprises.id, { onDelete: 'set null' })` et un index sur `entreprise_id`, en suivant le style de `vmaTests` (`src/vma/schema.ts`). Puis `npx drizzle-kit generate`. Relire le SQL généré : il ne doit contenir qu'un `ALTER TABLE ... ADD COLUMN` et un `CREATE INDEX`.

- [ ] **Step 4: Accepter `entrepriseId` dans `createProjet`**

`src/diagnostic/service.ts:61` : ajouter `entrepriseId?: string | null` à l'`input` et le passer dans `.values(...)`. `vue()` le renvoie déjà (le type `Projet` vient du schéma).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/diagnostic/service.test.ts`
Expected: PASS (tous les cas, dont l'ancien).

- [ ] **Step 6: Commit**

```bash
git add src/diagnostic/schema.ts src/diagnostic/service.ts src/diagnostic/service.test.ts drizzle/0032_diagnostic_entreprise.sql drizzle/meta
git commit -m "Diagnostic : colonne entreprise_id facultative sur les projets"
```

---

### Task 2: Rapprochement des projets existants (simulation par défaut)

**Files:**
- Create: `src/diagnostic/rapprochement.ts` (fonction pure)
- Create: `src/diagnostic/rapprochement.test.ts`
- Modify: `src/admin/cli.ts` (commande `diagnostic:rattacher`, simulation par défaut, `--appliquer` pour écrire)

**Interfaces:**
- Produces:
  ```ts
  type Proposition =
    | { projetId: string; statut: 'exact'; entrepriseId: string; entrepriseNom: string }
    | { projetId: string; statut: 'ambigu'; candidates: { entrepriseId: string; entrepriseNom: string }[] }
    | { projetId: string; statut: 'aucun' };
  export function proposerRapprochements(
    projets: { id: string; nom: string }[],
    entreprises: { id: string; nom: string }[],
  ): Proposition[];
  ```
  Normalisation : minuscules, accents retirés, espaces réduits, ponctuation retirée.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { proposerRapprochements } from './rapprochement.js';

const entreprises = [
  { id: 'e1', nom: 'Entreprise Fictive A' },
  { id: 'e2', nom: 'Atelier Fictif B' },
  { id: 'e3', nom: 'Atelier Fictif B SARL' },
];

it('rapproche un nom identique à la casse et aux accents près', () => {
  expect(proposerRapprochements([{ id: 'p1', nom: 'entreprise fictive a' }], entreprises)).toEqual([
    { projetId: 'p1', statut: 'exact', entrepriseId: 'e1', entrepriseNom: 'Entreprise Fictive A' },
  ]);
});

it('signale une ambiguïté au lieu de choisir', () => {
  const doublons = [
    { id: 'e2', nom: 'Atelier Fictif B' },
    { id: 'e4', nom: 'atelier fictif b' },
  ];
  const [p] = proposerRapprochements([{ id: 'p2', nom: 'Atelier Fictif B' }], doublons);
  expect(p).toEqual({
    projetId: 'p2',
    statut: 'ambigu',
    candidates: [
      { entrepriseId: 'e2', entrepriseNom: 'Atelier Fictif B' },
      { entrepriseId: 'e4', entrepriseNom: 'atelier fictif b' },
    ],
  });
});

it('laisse sans proposition un nom sans correspondance', () => {
  expect(proposerRapprochements([{ id: 'p3', nom: 'Inconnue' }], entreprises)).toEqual([
    { projetId: 'p3', statut: 'aucun' },
  ]);
});
```

Ajouter un cas où deux entreprises ont le même nom normalisé (`'Atelier Fictif B'` et `'atelier fictif b'`) : la proposition doit être `ambigu` avec les deux candidats.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/diagnostic/rapprochement.test.ts`
Expected: FAIL (module absent).

- [ ] **Step 3: Implement `proposerRapprochements`**

Normaliser les deux côtés, puis : une seule entreprise de même nom normalisé → `exact` ; plusieurs → `ambigu` ; aucune → `aucun`. Le module ne touche pas à la base.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/diagnostic/rapprochement.test.ts`
Expected: PASS.

- [ ] **Step 5: Ajouter la commande dans `src/admin/cli.ts`**

`diagnostic:rattacher <slug>` : charge les projets sans `entrepriseId` et les entreprises de l'instance, affiche les propositions (exact / ambigu / aucun) et ne fait aucune écriture. Avec `--appliquer`, n'écrit que les propositions `exact`. Les `ambigu` et `aucun` restent à traiter à la main. Vérification : la commande sans option ne modifie aucune ligne (compter les `entreprise_id` avant et après sur la base de test).

- [ ] **Step 6: Commit**

```bash
git add src/diagnostic/rapprochement.ts src/diagnostic/rapprochement.test.ts src/admin/cli.ts
git commit -m "Diagnostic : rapprochement des projets existants, simulation par défaut"
```

---

### Task 3: Fonctions pures de l'écran Diagnostics

**Files:**
- Create: `web/src/pages/diagnostics/grouper.ts`
- Create: `web/src/pages/diagnostics/grouper.test.ts`

**Interfaces:**
- Consumes: types `ProjetDiag`, `TestVma` depuis `web/src/api.ts`.
- Produces:
  ```ts
  export type LigneEntreprise = {
    id: string | null;           // null = groupe « Sans entreprise »
    nom: string;
    diag: ProjetDiag | null;
    tests: TestVma[];            // triés par date d'envoi, du plus récent au plus ancien
  };
  export function grouper(
    entreprises: { id: string; nom: string; secteur: string | null }[],
    projets: ProjetDiag[],
    tests: TestVma[],
  ): LigneEntreprise[];
  export function filtrer(lignes: LigneEntreprise[], recherche: string): LigneEntreprise[];
  export function paginer<T>(liste: T[], page: number, parPage: number): { items: T[]; page: number; pages: number };
// Appelée avec parPage = 5 ; la page renvoyée est bornée à [1, pages].
  export type ResumeVma = {
    dernier: { type: TestVma['type']; date: string; vma: number } | null;
    evolution: { date: string; vma: number }[]; // premiers tests uniquement, ordre chronologique
    ecart: { euros: number; pourcentage: number } | null; // premier -> dernier premier test
  };
  export function resumerVma(tests: TestVma[]): ResumeVma;
  ```

- [ ] **Step 1: Write the failing tests**

Cas minimum, avec données fictives :

```ts
it('range un diagnostic et plusieurs tests sous une même entreprise', () => { /* 1 entreprise, 1 projet rattaché, 2 tests → 1 ligne avec diag et 2 tests */ });
it('met les projets sans entreprise dans une ligne « Sans entreprise » (id null)', () => { /* ... */ });
it('garde une entreprise sans diagnostic ni test', () => { /* diag null, tests [] */ });
it('filtre sans accents ni casse', () => { /* filtrer(lignes, 'elodie') trouve 'Élodie Fictive' */ });
it('paginer 5 par page et borne la page demandée', () => {
  // 6 éléments, page 9 → page 2 ; page 0 → page 1 ; 0 élément → pages 1, items []
});
it("resumerVma ignore les essais dans l'évolution et l'écart", () => {
  // premiers : 3400 (14/04), 4150 (02/10) ; essai : 2100 (15/10)
  // evolution = 2 points ; ecart = { euros: 750, pourcentage: 22 } ; dernier.type = 'essai'
});
it('resumerVma sans résultat renvoie dernier null et evolution vide', () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/src/pages/diagnostics/grouper.test.ts`
Expected: FAIL (module absent).

- [ ] **Step 3: Implement the functions**

Pur TypeScript, sans React. `filtrer` normalise (minuscules, `normalize('NFD')` puis retrait des diacritiques). `resumerVma` ne prend que les tests dont `resultat` est renseigné ; `dernier` est le plus récent tous types confondus ; `evolution` et `ecart` ne prennent que `type === 'premier'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/src/pages/diagnostics/grouper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/diagnostics/grouper.ts web/src/pages/diagnostics/grouper.test.ts
git commit -m "Diagnostics : regroupement, recherche, pagination et résumé VMA (fonctions pures)"
```

---

### Task 4: Accepter le rattachement côté client et côté route

**Files:**
- Modify: `web/src/api.ts` (`creerProjetDiag` accepte un `entrepriseId` facultatif)
- Modify: `src/diagnostic/routes.ts` (ou le fichier qui enregistre `POST /diagnostic/projets` ; chercher `creerProjetDiag` côté serveur) : transmettre `entrepriseId` à `createProjet`, valider qu'il appartient à la même instance.
- Test: `src/diagnostic/api.test.ts` (cas : entreprise d'une autre instance → 400)

**Interfaces:**
- Consumes: `createProjet` (Task 1).
- Produces: `creerProjetDiag(slug, nom, activite, entrepriseId?)`.

- [ ] **Step 1: Write the failing test** — une requête `POST` avec un `entrepriseId` d'une autre instance renvoie 400 et ne crée rien.
- [ ] **Step 2: Run** `npx vitest run src/diagnostic/api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** — vérifier l'appartenance avec une requête sur `entreprises` filtrée par `instanceId` ; passer `entrepriseId` à `createProjet`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Diagnostic : rattachement d'un projet à une entreprise à la création"`.

---

### Task 5: Écran Diagnostics (liste, pagination, recherche, vue étendue)

**Files:**
- Create: `web/src/pages/Diagnostics.tsx`
- Create: `web/src/pages/Diagnostics.test.tsx`
- Modify: `web/src/pages/Diagnostic.tsx` (exporter le contenu du projet pour qu'il s'ouvre depuis la ligne, sans son ancienne liste)

**Interfaces:**
- Consumes: `grouper`, `filtrer`, `paginer`, `resumerVma` (Task 3) ; `fetchProjetsDiag`, `fetchTestsVma`, `fetchEntreprises` (api) ; `Diagnostic` (projet).
- Produces: `export function Diagnostics({ slug }: { slug: string })`.

- [ ] **Step 1: Write the failing tests** (Testing Library, mocks `../api.js` comme `Diagnostic.test.tsx`)

```tsx
it('affiche au plus 5 entreprises et une pagination', () => { /* 6 entreprises → 5 lignes, « Entreprises 1 à 5 sur 6 » */ });
it('ouvre une ligne au clic sur « Détail ▾ » et la referme sur « Réduire ▴ »', () => {});
it('affiche le bouton « Résultat complet » désactivé', () => {});
it('la recherche revient à la page 1', () => {});
it('un essai n\'apparaît pas dans le graphique d\'évolution', () => {});
```

- [ ] **Step 2: Run** `npx vitest run web/src/pages/Diagnostics.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement**
  - Ligne fermée : nom, secteur, colonne « Diagnostic » (étape x sur 5 ou « Pas encore lancé »), colonne « Tests VMA » (nombre et reçus), libellé « Détail ▾ » / « Réduire ▴ ».
  - Ligne ouverte : deux blocs de même poids (diagnostic, tests VMA), ordre comme dans la maquette.
  - Pour l'écran projet, réutiliser le composant `Diagnostic` existant en lui passant l'identifiant du projet ; ne pas réécrire ses sections.
  - Pour la création, réutiliser les formulaires existants (`creerProjetDiag`, `creerTestVma`).
  - Pour le CSS, reprendre les règles de la maquette `maquettes/diagnostics-fusion.html` dans le fichier de styles du projet, sans les dupliquer dans le composant.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Diagnostics : écran fusionné (liste par entreprise, pagination, recherche)"`.

---

### Task 6: Création depuis la section (point à trancher)

**Files:**
- Modify: `web/src/pages/Diagnostics.tsx`
- Test: `web/src/pages/Diagnostics.test.tsx`

**Point à trancher avant cette tâche** : une entreprise qui a déjà un diagnostic en cours. La spec recommande de proposer une nouvelle année (option 2). Ce choix doit être confirmé avant de coder ; la tâche suit l'option choisie.

- [ ] **Step 1: Write the failing tests** — « Nouveau diagnostic » sur une entreprise avec diagnostic en cours (option 2 : une nouvelle année est créée et l'ancien reste dans l'historique) ; « Nouveau test VMA » pré-remplit l'entreprise ; un nom saisi crée l'entreprise avant le test (ou refuse : à trancher avec la même question).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** — dialogues calqués sur la maquette ; validation côté client (champs obligatoires), erreurs renvoyées par l'API affichées telles quelles.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Diagnostics : création d'un diagnostic ou d'un test VMA depuis la section"`.

---

### Task 7: Menu et routes

**Files:**
- Modify: `web/src/nav.ts` (remplacer `diagnostic` et `tests-vma` par une seule entrée `diagnostics`, `BUILT` mis à jour)
- Modify: `web/src/nav.ts` `vueCanonique` : `'diagnostic'` et `'tests-vma'` redirigent vers `'diagnostics'`
- Modify: `web/src/App.tsx` (route `diagnostics` ; les anciennes ids restent résolues par `vueCanonique`)
- Test: `web/src/nav.test.ts` (créer s'il n'existe pas) : une seule entrée Diagnostics, anciennes ids redirigées

**Interfaces:**
- Produces: `NAV` contient `item('diagnostics', 'Diagnostics', 'radar', 'diagnostic')`.

- [ ] **Step 1: Write the failing test** — `allItems().filter(i => i.id.startsWith('diag') || i.id === 'tests-vma')` vaut une seule entrée ; `vueCanonique('tests-vma') === 'diagnostics'`.
- [ ] **Step 2: Run** `npx vitest run web/src/nav.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the nav and route changes.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Menu : une seule entrée Diagnostics"`.

---

### Task 8: Vérification complète et navigateur

- [ ] **Step 1:** `npm run verify` — Expected: tout vert (format, lint, types, tests, build).
- [ ] **Step 2:** Lancer l'instance de démonstration, ouvrir la section Diagnostics, et vérifier : pagination à 5, recherche, ligne ouverte, aperçu VMA d'une entreprise avec deux premiers tests, création d'un test VMA. Vérifier aussi la vue en téléphone (largeur 375 px).
- [ ] **Step 3:** Rapport à Marc : étapes simples pour tester (voir AGENTS.md, « Marc est débutant »).
- [ ] **Step 4:** PR, revue de code, CI verte, merge dans `main` ; ne pas merger sur une CI rouge.
