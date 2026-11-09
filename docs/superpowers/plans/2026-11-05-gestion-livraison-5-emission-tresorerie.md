# Gestion — Livraison 5 : émission, encaissement et trésorerie — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Émettre la facture d'un mandat (elle fige ses lignes), la marquer encaissée, et faire entrer les factures à émettre, émises et les IK refacturés dans la projection de trésorerie.

**Architecture:** Une table `gestion_factures` conserve la photographie d'une facture émise ; l'émission passe les recettes concernées à `emise` et marque les trajets IK par `facture_id`. La trésorerie reçoit deux entrées nouvelles (factures non encaissées, trajets IK refacturés non facturés) et date les recettes d'un mandat à la fin de mois d'émission plus le délai du mandat.

**Tech Stack:** Fastify, Drizzle (Postgres), zod 4, React + Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-05-gestion-factures-a-emettre-design.md` (sections 3.3, 6 et 7).

## Global Constraints

- Montants en centimes entiers, hors taxes pour les factures ; interface en français ; tests avec **données fictives** (dépôt public).
- Module réservé à une instance « propre » avec le module `gestion` (helper `dansGestion`).
- Émettre et encaisser s'exécutent dans la transaction de `dansGestion` : tout ou rien.
- Une facture émise ne change plus (ni lignes, ni total) ; seul son encaissement la fait évoluer.
- Une source n'est jamais facturée deux fois : recette à l'état `prevue` seulement, trajet sans `facture_id` seulement.
- Migration générée par `npm run db:generate`, jamais à la main ; vérifier que sa date `when` dépasse celle de la dernière migration appliquée.
- `npm run verify` avant chaque commit ; `git add` fichier par fichier, jamais `-A`.

## Review Focus

- Émettre deux fois de suite pour le même mandat : la seconde fois ne reprend rien et répond « Rien à facturer », sans doublon.
- Numéro de facture déjà utilisé, ou vide : refusé, rien n'est écrit (ni facture, ni changement d'état).
- Une ligne exclue (décochée) reste à émettre ; un trajet sans barème n'est ni facturé ni marqué facturé.
- Encaisser une facture déjà encaissée, ou avec une date antérieure à son émission : refusé.
- Trésorerie : une recette comptée dans une facture (prévue ou émise) n'apparaît qu'une fois ; une facture encaissée avant la date du solde n'est pas recomptée.

---

## File Structure

- Modify `src/gestion/schema.ts`, `src/db/metier-tables.ts` : table `gestionFactures`, colonne `factureId` des trajets.
- Create `drizzle/0077_*.sql` (générée).
- Modify `src/gestion/ik.ts` : extraire `trajetsRefacturables`.
- Modify `src/gestion/factures.ts` : option `jusqua`, trajets déjà facturés exclus.
- Create `src/gestion/factures-emission.ts` : émission, encaissement, lecture des factures émises.
- Modify `src/gestion/tresorerie.ts` : entrées factures et IK, dates des recettes d'un mandat.
- Modify `src/gestion/routes.ts` : trois routes.
- Modify `web/src/api.ts`, `web/src/pages/Gestion.tsx`, `web/src/pages/gestion/Factures.tsx`.
- Tests : `src/gestion/factures-emission.test.ts`, `src/gestion/tresorerie.test.ts`, `web/src/pages/gestion/Factures.test.tsx`, `web/src/pages/Gestion.test.tsx`.

---

### Task 1: Schéma et migration

**Files:**
- Modify: `src/gestion/schema.ts`, `src/db/metier-tables.ts`
- Create: `drizzle/0077_*.sql` (par `npm run db:generate`)

**Interfaces:**
- Produces: `gestionFactures` (`mandat: text`, `numero: text`, `dateEmission: date`, `totalHtCents: integer`, `delaiJours: integer | null`, `etat: 'emise' | 'encaissee'`, `dateEncaissement: date | null`, `lignes: jsonb` typé `LigneFigee[]`) ; `gestionIkTrajets.factureId: uuid | null` (clé étrangère vers `gestionFactures.id`) ; `type LigneFigee = { cle: string; sorte: 'recurrent' | 'commission' | 'frais' | 'ik'; libelle: string; date: string; montantHtCents: number; tvaCents: number | null }`.

- [ ] **Step 1: Ajouter `gestionFactures`** avec `...metierColumns()`, un index unique `gestion_factures_numero_idx` sur `(instanceId, numero)` et `instanceIsolation('gestion_factures')`, sur le modèle de `gestionMandatReglages` ; `etat` en `text` avec énumération `['emise', 'encaissee']` (constante `ETATS_FACTURE`) ; exporter le type `LigneFigee`. Déclarer la table **avant** `gestionIkTrajets`.
- [ ] **Step 2: Ajouter à `gestionIkTrajets` la colonne `factureId: uuid('facture_id').references(() => gestionFactures.id)`.**
- [ ] **Step 3: Enregistrer `gestionFactures` dans `src/db/metier-tables.ts`**, comme `gestionMandatReglages`.
- [ ] **Step 4: `npm run db:generate`** ; contrôler le SQL (table, RLS, politique d'isolation, colonne, clé étrangère, index unique) et la date du journal.
- [ ] **Step 5: `npx vitest run src/db`** ; attendu : PASS.
- [ ] **Step 6: Commit** : `git add src/gestion/schema.ts src/db/metier-tables.ts drizzle/` puis `feat(gestion): table des factures émises`.

---

### Task 2: Trajets refacturables extraits, limite d'émission

**Files:**
- Modify: `src/gestion/ik.ts`, `src/gestion/factures.ts`
- Test: `src/gestion/factures.test.ts`

**Interfaces:**
- Consumes: `gestionIkTrajets.factureId` (Task 1) ; `etatIkMois` (`ik.ts`).
- Produces: `trajetsRefacturables(tx: Executor, jusqua: string): Promise<IkRefacturable[]>` dans `ik.ts`, qui exclut les trajets archivés, non refacturés, sans mandat, déjà facturés (`factureId` non nul) ou datés après `jusqua` ; `type IkRefacturable` déplacé dans `ik.ts` (réexporté par `factures.ts`) ; `facturesParMandat(tx, aujourdhui?, jusqua?: string)` : `jusqua` remplace la date d'émission prévue comme limite des lignes (défaut : `dateEmissionPrevue(aujourdhui)`).

- [ ] **Step 1: Écrire les tests dans `factures.test.ts`** :
  - `un trajet déjà facturé n'est plus à émettre` : après avoir posé `facture_id` sur un trajet refacturé (insertion directe d'une ligne `gestion_factures` fictive), il n'est plus dans `facturesParMandat` ;
  - `jusqua limite les lignes` : une recette du 20 du mois est exclue avec `jusqua` au 15 et présente avec `jusqua` au 30.
- [ ] **Step 2: Lancer `npx vitest run src/gestion/factures.test.ts` ; attendu : FAIL.**
- [ ] **Step 3: Déplacer la requête et le calcul d'indemnités de `facturesParMandat` dans `trajetsRefacturables`** (même logique : un appel à `etatIkMois` par couple véhicule et mois) ; l'utiliser dans `facturesParMandat` ; ajouter le filtre `isNull(gestionIkTrajets.factureId)` ; ajouter le paramètre `jusqua` qui sert de borne aux recettes et aux trajets.
- [ ] **Step 4: Relancer le fichier ainsi que `ik.refacturer.test.ts` ; attendu : PASS.**
- [ ] **Step 5: Commit** : `git add src/gestion/ik.ts src/gestion/factures.ts src/gestion/factures.test.ts` puis `refactor(gestion): trajets refacturables extraits, limite d'émission`.

---

### Task 3: Émission d'une facture

**Files:**
- Create: `src/gestion/factures-emission.ts`
- Modify: `src/gestion/routes.ts`
- Test: `src/gestion/factures-emission.test.ts`

**Interfaces:**
- Consumes: `facturesParMandat(tx, aujourdhui, jusqua)` (Task 2) ; `lireRevenu`, `modifierRevenu`, `modifierOccurrenceRevenu` (`revenus.ts`) ; `SLUG`.
- Produces :
  - `type FactureEmise = { id: string; mandat: string; numero: string; dateEmission: string; delaiJours: number | null; totalHtCents: number; etat: 'emise' | 'encaissee'; dateEncaissement: string | null; lignes: LigneFigee[] }`
  - `emettreSchema = z.object({ mandat: z.string().regex(SLUG), numero: z.string().trim().min(1).max(100), dateEmission: <jour>, exclure: z.array(z.string()).max(500).default([]) })`
  - `class FactureInvalide extends Error`, `class FactureIntrouvable extends Error`
  - `emettreFacture(tx: Executor, instanceId: string, e: z.infer<typeof emettreSchema>): Promise<FactureEmise>`
  - `lireFacturesEmises(tx: Executor): Promise<FactureEmise[]>` (récentes d'abord)
  - routes `POST /api/i/:slug/gestion/factures/emettre` (201) et `GET /api/i/:slug/gestion/factures/emises` ; `FactureInvalide` → 400, `FactureIntrouvable` → 404, comme `ImportInvalide`.

- [ ] **Step 1: Écrire `factures-emission.test.ts`** (instance fictive, mandat `emi-a`, recettes, barème et trajets fictifs, sur le modèle de `factures.test.ts`) :
  - `émet la facture d'un mandat` : une recette `refacturation` d'un jour passé du mois, une recette récurrente (série mensuelle, échéance du mois) et un trajet IK refacturé avec barème ; après `emettreFacture`, la facture contient les trois lignes, `totalHtCents` est la somme, `delaiJours` vaut le délai du mandat, la recette unique est à l'état `emise` avec `referenceFacture` égale au numéro, l'échéance récurrente a une exception `emise`, le trajet a son `factureId` ;
  - `une seconde émission ne reprend rien` : même appel → `FactureInvalide('Rien à facturer…')` et aucune nouvelle facture ;
  - `refuse un numéro vide ou déjà utilisé` sans rien modifier (l'état de la recette reste `prevue`) ;
  - `une ligne exclue reste à émettre` : exclure la clé du frais ; il reste `prevue` et réapparaît dans `facturesParMandat` ;
  - `un trajet sans barème n'est ni facturé ni marqué` (`factureId` reste nul) ;
  - `les lignes d'une facture émise sont figées` : modifier ensuite le montant de la recette n'altère pas `lignes` ;
  - `refuse un mandat sans lignes à émettre` ;
  - `lireFacturesEmises` renvoie la plus récente d'abord.
- [ ] **Step 2: Lancer le fichier ; attendu : FAIL (module absent).**
- [ ] **Step 3: Implémenter `emettreFacture`** : appeler `facturesParMandat(tx, e.dateEmission, e.dateEmission)` ; prendre la facture du mandat ; ôter les clés de `exclure` et les lignes sans montant ; refuser (`FactureInvalide`) s'il ne reste rien ou si le numéro est déjà pris dans l'instance ; insérer la ligne de `gestion_factures` (le délai effectif lu dans le calcul) ; pour une ligne `revenu:<id>|<date>` : `modifierRevenu(tx, id, { etat: 'emise', referenceFacture: numero })` si la recette n'est pas récurrente, sinon `modifierOccurrenceRevenu(tx, instanceId, id, date, { portee: 'cette', etat: 'emise', referenceFacture: numero })` ; pour une ligne `ik:<trajetId>` : renseigner `factureId` du trajet.
- [ ] **Step 4: Implémenter `lireFacturesEmises` et les deux routes** dans `routes.ts` (erreurs mappées comme celles de l'import, `logEvent` de niveau L2 à l'émission).
- [ ] **Step 5: Relancer le fichier ; attendu : PASS.**
- [ ] **Step 6: Commit** : `git add src/gestion/factures-emission.ts src/gestion/factures-emission.test.ts src/gestion/routes.ts` puis `feat(gestion): émission d'une facture de mandat`.

---

### Task 4: Encaissement d'une facture

**Files:**
- Modify: `src/gestion/factures-emission.ts`, `src/gestion/routes.ts`
- Test: `src/gestion/factures-emission.test.ts`

**Interfaces:**
- Consumes: `FactureEmise`, `FactureInvalide`, `FactureIntrouvable` (Task 3).
- Produces: `encaisserSchema = z.object({ dateEncaissement: <jour> })` ; `encaisserFacture(tx: Executor, instanceId: string, id: string, dateEncaissement: string): Promise<FactureEmise>` ; route `POST /api/i/:slug/gestion/factures/:id/encaisser`.

- [ ] **Step 1: Écrire les tests** :
  - `encaisser passe la facture et ses recettes à encaissée` : `etat: 'encaissee'`, `dateEncaissement` renseignée ; la recette unique est `encaissee` avec cette date, l'échéance récurrente aussi ;
  - `refuse d'encaisser deux fois` ; `refuse une date antérieure à l'émission` ; `404 pour une facture inconnue`.
- [ ] **Step 2: Lancer le fichier ; attendu : FAIL.**
- [ ] **Step 3: Implémenter `encaisserFacture`** : même parcours des lignes figées que l'émission, avec `etat: 'encaissee'` et la date ; les lignes IK ne touchent aucune autre table ; puis mettre à jour la facture. Ajouter la route (`:id` validé comme `idSchema`).
- [ ] **Step 4: Relancer ; attendu : PASS.**
- [ ] **Step 5: Commit** : `git add src/gestion/factures-emission.ts src/gestion/factures-emission.test.ts src/gestion/routes.ts` puis `feat(gestion): encaissement d'une facture de mandat`.

---

### Task 5: Factures et IK dans la trésorerie

**Files:**
- Modify: `src/gestion/tresorerie.ts`
- Test: `src/gestion/tresorerie.test.ts`, `src/gestion/tresorerie.routes.test.ts`

**Interfaces:**
- Consumes: `FactureEmise` (Task 3), `IkRefacturable`/`trajetsRefacturables` (Task 2), `dateEmissionPrevue` (`factures.ts`), `lireDelaisMandats` (`mandats.ts`).
- Produces :
  - `mouvementsRecettes(occ, p)` : `p` gagne `delaisMandat?: Map<string, number | null>` et `factures?: Map<string, { dateEmission: string; delaiJours: number | null }>` (clé = clé d'occurrence de recette) ;
  - `mouvementsFacturesIk(e: { ik: IkRefacturable[]; factures: FactureEmise[]; delaisMandat: Map<string, number | null>; scenario: Scenario; soldeDate: string | null; aujourdhui: string; delaiJours: number | null; retardJours: number }): Mouvement[]`.

Règles (spec §7) :
1. Recette `prevue` avec mandat : date de facturation = `dateEmissionPrevue(max(date, aujourdhui))` ; encaissement = cette date + délai du mandat, sinon délai général, + retard. Sans mandat : inchangé.
2. Recette dont la clé est dans `factures` (émise, non encaissée) : encaissement = `dateEmission` + `delaiJours` de la facture + retard.
3. `mouvementsFacturesIk` : un mouvement d'entrée « IK <mandat> » par trajet refacturé non facturé, à la date de facturation de règle 1 + délai du mandat + retard, dans tous les scénarios ; pour chaque facture émise non encaissée, un mouvement par ligne IK figée à `dateEmission` + `delaiJours` ; pour une facture encaissée, un mouvement à `dateEncaissement` seulement s'il dépasse `soldeDate`. Un trajet de montant inconnu ne produit rien.

- [ ] **Step 1: Écrire les tests purs dans `tresorerie.test.ts`** :
  - `une recette de mandat est datée fin de mois + délai du mandat` (ex. échéance le 10, fin de mois le 30, délai 45 j) ; `sans mandat, le comportement est inchangé` ;
  - `une recette déjà émise suit la date d'émission de sa facture + son délai figé` ;
  - `une recette prévue d'un jour passé est comptée à la fin du mois courant` ;
  - `mouvementsFacturesIk` : trajet à venir ; ligne IK d'une facture émise ; facture encaissée avant la date du solde (aucun mouvement) et après (un mouvement à sa date d'encaissement) ; trajet sans montant (aucun mouvement) ; même résultat dans les trois scénarios.
- [ ] **Step 2: Test de route** dans `tresorerie.routes.test.ts` : une facture émise fictive entre dans la projection `central` une seule fois (la recette liée n'est pas doublée par une ligne IK ou par un second mouvement).
- [ ] **Step 3: Lancer `npx vitest run src/gestion/tresorerie.test.ts src/gestion/tresorerie.routes.test.ts` ; attendu : FAIL.**
- [ ] **Step 4: Implémenter** les règles 1 et 2 dans `mouvementsRecettes` et `mouvementsFacturesIk` ; dans `projeter`, charger `lireDelaisMandats`, les factures émises (`lireFacturesEmises`) et `trajetsRefacturables(tx, fin)` ; construire la table `factures` à partir des lignes figées `revenu:…` ; ajouter les mouvements IK aux scénarios.
- [ ] **Step 5: Relancer les deux fichiers et `npx vitest run src/gestion` ; attendu : PASS.**
- [ ] **Step 6: Commit** : `git add src/gestion/tresorerie.ts src/gestion/tresorerie.test.ts src/gestion/tresorerie.routes.test.ts` puis `feat(gestion): factures de mandat dans la trésorerie`.

---

### Task 6: Émettre et encaisser depuis l'onglet Factures

**Files:**
- Modify: `web/src/api.ts`, `web/src/pages/Gestion.tsx`, `web/src/pages/gestion/Factures.tsx`
- Test: `web/src/pages/gestion/Factures.test.tsx`, `web/src/pages/Gestion.test.tsx`

**Interfaces:**
- Consumes: routes des Tasks 3 et 4.
- Produces: types miroirs `FactureEmise` et `LigneFigee` dans `web/src/api.ts` ; `fetchFacturesEmises(slug: string): Promise<FactureEmise[]>` ; `emettreFacture(slug: string, e: { mandat: string; numero: string; dateEmission: string; exclure: string[] }): Promise<FactureEmise>` ; `encaisserFacture(slug: string, id: string, dateEncaissement: string): Promise<FactureEmise>` ; `Factures` gagne `emises: FactureEmise[]`, `onEmettre(e: { mandat: string; numero: string; dateEmission: string; exclure: string[] }): void` et `onEncaisser(id: string, date: string): void`.

- [ ] **Step 1: Écrire les tests dans `Factures.test.tsx`** :
  - `émettre ouvre un formulaire avec numéro, date et une case par ligne` ; le bouton reste désactivé tant que le numéro est vide ;
  - `décocher une ligne l'envoie dans exclure` ; une ligne sans montant n'a pas de case ;
  - `valider appelle onEmettre avec mandat, numéro, date et exclure` ;
  - `la liste des factures émises montre numéro, date, total et état`, et `Marquer encaissée` appelle `onEncaisser` avec la date saisie (une facture encaissée n'a pas ce bouton).
- [ ] **Step 2: Mettre à jour `Gestion.test.tsx`** : le mock de `fetch` répond `[]` à `gestion/factures/emises` ; l'onglet Factures reste affiché.
- [ ] **Step 3: Lancer les deux fichiers ; attendu : FAIL.**
- [ ] **Step 4: Implémenter** : fonctions et types dans `api.ts` ; dans `Gestion.tsx`, charger `fetchFacturesEmises` avec le reste, appeler `emettreFacture` / `encaisserFacture` puis `charger()` ; `Factures.tsx` : formulaire d'émission par carte (numéro, date du jour par défaut, cases par ligne, erreurs serveur affichées) et section « Factures émises ».
- [ ] **Step 5: Relancer les deux fichiers ; attendu : PASS.**
- [ ] **Step 6: Commit** : `git add web/src/api.ts web/src/pages/Gestion.tsx web/src/pages/gestion/Factures.tsx web/src/pages/gestion/Factures.test.tsx web/src/pages/Gestion.test.tsx` puis `feat(gestion): émettre et encaisser une facture depuis l'onglet Factures`.

---

### Task 7: Vérification complète

- [ ] **Step 1: `npm run verify`** ; attendu : format, lint, types, tests et build au vert.
- [ ] **Step 2: Contrôle visuel** avec un banc de test à données fictives (supprimé ensuite) : carte avec formulaire d'émission, liste des factures émises.
- [ ] **Step 3: Pousser, ouvrir la PR, relecture indépendante, CI verte** ; pas de fusion sans la validation de Marc.
