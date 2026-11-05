# Gestion, livraison 3 : import des transactions Pennylane — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marc dépose l'export « Transactions bancaires » de Pennylane (.xlsx ou .csv), vérifie ce qui sera importé, puis valide : les sorties deviennent des dépenses payées, les entrées des recettes encaissées, sans doublon à la deuxième importation.

**Architecture:** Le serveur lit le fichier avec le lecteur existant (`src/base-vivante/lecture.ts`, `lireFichier`), calcule pour chaque ligne une clé stable, la compare à un registre `gestion_import_cles`, et propose un rapprochement avec une dépense ou recette déjà prévue. Deux routes sans état : `analyse` (n'écrit rien) et `valider` (relit le fichier, applique les décisions de Marc). L'interface ajoute l'onglet « Importer ».

**Tech Stack:** Fastify, Drizzle, zod, React, Vitest. Aucune nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-11-03-gestion-refonte-design.md` (section « Importer »).

## Ce que montre le vrai export (fichier de Marc, lu en local, jamais copié ici)

Une feuille « Transactions bancaires », 11 colonnes : `Date`, `Mois`, `Compte Bancaire`, `Libellé`, `Montant`, `Tiers`, `Justifié`, `Commentaires`, `État`, `Type`, `Plan de trésorerie`. Après `lireFichier` : dates en `AAAA-MM-JJ`, montants en texte décimal à point et **signés** (négatif = sortie). `État` vaut « Transaction finalisée » ; `Tiers`, `Type`, `Plan de trésorerie` sont vides ; **aucun identifiant de transaction ni solde** dans le fichier ; plusieurs paiements identiques le même jour sont possibles.

## Global Constraints

- Montants en centimes entiers ; une sortie = dépense **TTC** (`montantTtcCents` positif), une entrée = recette dont le montant bancaire est repris en `montantHtCents` avec `tvaCents` vide (TVA non renseignée, déjà signalée par la projection).
- Colonnes reconnues par leur nom normalisé (`normaliserEntete` de `base-vivante/colonnes.ts`) : `Date`, `Libellé`, `Montant` obligatoires ; `Compte Bancaire`, `État` facultatives. Colonne obligatoire absente : erreur qui nomme la colonne, rien d'écrit.
- Une ligne dont l'`État` n'est pas « finalisée » (contient `finalis`) est ignorée et comptée.
- Clé d'une ligne : `pennylane|<compte>|<date>|<montantCents signé>|<libellé normalisé>|<n>` où `n` est le rang (1, 2…) parmi les lignes identiques du même fichier : deux paiements identiques le même jour restent deux lignes, et un réimport redonne les mêmes clés.
- Rapprochement proposé, jamais appliqué sans validation : sortie ↔ occurrence de dépense « à venir » de la société, même montant TTC, date à ± 7 jours ; entrée ↔ recette « prévue » ou « facturée », même montant (HT + TVA), date à ± 45 jours ; une cible n'est proposée qu'à une seule ligne du fichier, la plus proche.
- Le fichier n'est pas conservé ; seules la clé et la décision le sont. Aucune écriture chez un tiers. Plafond 5 000 lignes. Corps de requête : `contenuBase64` en JSON, `bodyLimit` 14 Mo, comme les routes d'import existantes.
- Données de test **fictives** ; aucun nom, libellé bancaire ni montant réel dans le dépôt public.
- Branche `feature/gestion-import` depuis `origin/main` ; `npm run verify` vert avant chaque commit ; `git add` explicite.

## Review Focus

- Même fichier importé deux fois : zéro nouvelle ligne, aucune erreur.
- Deux paiements identiques le même jour : deux dépenses, puis rien au réimport.
- Fichier à colonnes en désordre, séparateur `;`, virgule décimale, montant « 1 234,50 » : lus correctement.
- Entrée sans recette prévue correspondante : « à vérifier », jamais importée en silence.
- Une dépense prévue récurrente rapprochée : seule cette occurrence passe à « payée » avec la date et le montant réels.

## Fichiers

- Create `src/gestion/import-pennylane.ts` (lecture et clés, pur), `src/gestion/import.ts` (analyse, rapprochement, validation), leurs tests.
- Modify `src/gestion/schema.ts` (table `gestionImportCles`), `drizzle/0069_*.sql` (générée), `src/gestion/routes.ts`.
- Modify `web/src/api.ts`, `web/src/pages/Gestion.tsx` ; create `web/src/pages/gestion/GestionImport.tsx` et son test ; modify `web/src/pages/Gestion.test.tsx`.

---

### Task 1: Registre des lignes importées

**Files:** `src/gestion/schema.ts`, `drizzle/0069_*.sql`.

**Interfaces:** Produces `gestionImportCles` : `id`, `instanceId`, `cle text`, `decision 'importee' | 'rapprochee' | 'ignoree'`, `cibleType 'depense' | 'recette' | null`, `cibleId uuid | null`, `createdAt` ; index unique `(instance_id, cle)` ; isolation par instance comme les autres tables Gestion.

- [ ] **Step 1:** ajouter la table, puis `npm run db:generate` ; relire le SQL (création seule, rien d'autre).
- [ ] **Step 2: Write the failing test** dans `src/gestion/import.test.ts` (créé ici) : `refuse deux fois la même clé dans la même instance` (insertion directe, la seconde viole l'index) et `autorise la même clé dans une autre instance`.
- [ ] **Step 3: Run** `npx vitest run src/gestion/import.test.ts` — Expected: PASS une fois la migration appliquée (le test échoue avant : table absente).
- [ ] **Step 4: Commit** `git add src/gestion/schema.ts drizzle src/gestion/import.test.ts && git commit -m "feat(gestion): registre des lignes importées"`.

### Task 2: Lecture du fichier et clés stables (pur)

**Files:** Create `src/gestion/import-pennylane.ts`, `src/gestion/import-pennylane.test.ts`.

**Interfaces:**
- Consumes: `Feuille` de `src/base-vivante/lecture.ts`, `normaliserEntete` de `src/base-vivante/colonnes.ts`.
- Produces: `type LigneImport = { rang: number; cle: string; date: string; libelle: string; montantCents: number; compte: string }` ; `class ImportInvalide extends Error` ; `lireTransactions(f: Feuille): { lignes: LigneImport[]; nonFinalisees: number }`.

- [ ] **Step 1: Write the failing tests** (lignes fictives) : colonnes en désordre reconnues ; `Montant` « -23.99 », « -23,99 » et « 1 234,50 » → `-2399`, `-2399`, `123450` ; colonne `Montant` absente → `ImportInvalide` dont le message contient « Montant » ; `État` « En attente » ignorée et comptée ; deux lignes identiques → clés distinctes `…|1` et `…|2` ; la même feuille relue donne les mêmes clés ; libellé normalisé (casse, espaces multiples, accents conservés) ; plus de 5 000 lignes → `ImportInvalide`.
- [ ] **Step 2: Run** `npx vitest run src/gestion/import-pennylane.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `lireTransactions`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/gestion/import-pennylane.ts src/gestion/import-pennylane.test.ts && git commit -m "feat(gestion): lecture des transactions Pennylane"`.

### Task 3: Analyse et rapprochement

**Files:** Create `src/gestion/import.ts`, extend `src/gestion/import.test.ts`.

**Interfaces:**
- Consumes: `LigneImport` (Task 2), `occurrencesDepenses`, `occurrencesRevenus`, `gestionImportCles`.
- Produces:
  - `type Rapprochement = { type: 'depense' | 'recette'; id: string; dateOrigine: string; libelle: string; date: string; montantCents: number }`
  - `type LigneAnalysee = LigneImport & { sens: 'sortie' | 'entree'; issue: 'nouvelle' | 'deja' | 'a_verifier'; raison: string | null; rapprochement: Rapprochement | null }`
  - `proposerRapprochements(lignes: LigneImport[], depenses: OccurrenceVue[], recettes: OccurrenceRevenu[]): Map<string, Rapprochement>` (pur)
  - `analyserImport(tx: Tx, f: Feuille): Promise<{ lignes: LigneAnalysee[]; compteurs: { nouvelles: number; deja: number; aVerifier: number; nonFinalisees: number }; avertissements: string[] }>`

- [ ] **Step 1: Write the failing tests** : `proposerRapprochements` — sortie 49 € / occurrence à venir de 49 € à 3 jours → rapprochée ; à 9 jours → non ; deux lignes identiques et une seule occurrence → la plus proche l'emporte, l'autre reste sans cible ; entrée 500 € ↔ recette prévue 500 € à 30 jours → rapprochée ; occurrence « ignorée » ou dépense de l'associé jamais proposée. `analyserImport` en base — clé déjà au registre → `deja` ; sortie sans cible → `nouvelle` ; sortie avec cible → `a_verifier` avec sa raison ; entrée sans cible → `a_verifier` (« Aucune recette prévue ne correspond ») ; compteurs exacts ; une analyse n'écrit rien (registre inchangé).
- [ ] **Step 2: Run** `npx vitest run src/gestion/import.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les deux fonctions (fenêtre de recherche des occurrences : de la plus ancienne date du fichier − 45 jours à la plus récente + 45 jours).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/gestion/import.ts src/gestion/import.test.ts && git commit -m "feat(gestion): analyse et rapprochement des transactions"`.

### Task 4: Validation et routes

**Files:** Modify `src/gestion/import.ts`, `src/gestion/routes.ts` ; tests `src/gestion/import.test.ts`, `src/gestion/import.routes.test.ts` (create).

**Interfaces:**
- Consumes: `analyserImport` (Task 3), `creerDepense`, `modifierOccurrence`, `modifierSerie`, `creerRevenu`, `modifierOccurrenceRevenu`, `logEvent`.
- Produces: `type Decision = 'importer' | 'rapprocher' | 'ignorer'` ; `validerImport(tx: Tx, instanceId: string, f: Feuille, decisions: Record<string, Decision>): Promise<{ importees: number; rapprochees: number; ignorees: number }>` ; `POST /api/i/:slug/gestion/import/analyse` et `…/valider` (corps `{ nomFichier, contenuBase64, decisions? }`).

- [ ] **Step 1: Write the failing tests** : une sortie « nouvelle » importée → une dépense `reelle`, `payeur: 'societe'`, `affectations: [{ cible: 'simatis' }]`, montant TTC en valeur absolue, date du fichier ; une entrée importée → une recette `autre`, `encaissee`, `dateEncaissement` = date ; `rapprocher` une sortie sur une occurrence récurrente → seule cette occurrence passe à « payée » avec la date et le montant réels, la série intacte ; `rapprocher` sur une dépense prévue non récurrente → elle passe à `reelle` ; `rapprocher` une entrée → recette `encaissee` ; `ignorer` enregistre la clé sans rien créer ; **idempotence** : valider deux fois le même fichier → aucune nouvelle ligne la seconde fois ; une décision `rapprocher` sans cible proposée → 400 ; routes — 403 hors « Mon activité », 400 colonne manquante avec le nom de la colonne, 200 et mêmes compteurs pour un CSV à `;` et virgule décimale (fictif).
- [ ] **Step 2: Run** `npx vitest run src/gestion/import.test.ts src/gestion/import.routes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `validerImport` (relit l'analyse, ignore toute décision absente : par défaut `nouvelle` → `importer`, `a_verifier` → rien) et les deux routes (`bodyLimit: 14_000_000`, `lireFichier`, `FichierIllisible` → 400, journal « Transactions importées »).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/gestion && git commit -m "feat(gestion): validation de l'import et routes"`.

### Task 5: Onglet Importer

**Files:** Modify `web/src/api.ts`, `web/src/pages/Gestion.tsx` ; create `web/src/pages/gestion/GestionImport.tsx`, `GestionImport.test.tsx` ; modify `web/src/pages/Gestion.test.tsx`.

**Interfaces:** Consumes les types serveur recopiés dans `api.ts` (`LigneAnalysee`, `Decision`) ; produces `GestionImport(props: { slug: string; onImporte: () => void })` et `analyserImport(slug, nomFichier, contenuBase64)`, `validerImport(slug, nomFichier, contenuBase64, decisions)` dans `api.ts`.

- [ ] **Step 1: Write the failing tests** : l'onglet « Importer » existe (quatre onglets : Pilotage, Mouvements, Importer, TVA & IK — mettre à jour le test existant) ; l'écran 1 affiche le chemin dans Pennylane (Gestion › Transactions › Exporter, puis Plus › Exports) ; choisir un fichier appelle `analyse` avec son contenu en base64 et affiche les compteurs (nouvelles, déjà présentes, à vérifier) ; chaque ligne « à vérifier » propose un choix (Rapprocher / Importer comme nouvelle / Ignorer) ; « Importer N lignes » appelle `valider` avec les décisions et affiche le résumé puis appelle `onImporte` ; une erreur serveur s'affiche en alerte sans changer d'écran ; le résumé rappelle de mettre à jour le solde au jour du dernier mouvement.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/gestion/GestionImport.test.tsx web/src/pages/Gestion.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** le composant en trois étapes (choisir, vérifier, importé), `FileReader` → base64, balisage et classes du reste de Gestion (`panel`, `tbl`, `chip`, `badge`).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add web/src && git commit -m "feat(gestion): onglet Importer"`.

### Task 6: Vérification, PR et suites

- [ ] **Step 1:** `npm run verify` — Expected: tout vert.
- [ ] **Step 2:** vérifier dans le navigateur sur un banc d'essai à données fictives (serveur en tâche de fond suivie, arrêté ensuite), puis un essai sur l'app locale avec le vrai export de Marc **après son accord**, en lecture d'abord (analyse seule).
- [ ] **Step 3:** ouvrir la PR, relecture indépendante, corriger, CI verte, merge après validation de Marc, reconstruire l'app depuis `origin/main`, puis vérifier la table `gestion_import_cles` et l'endpoint (voir la mémoire « migrations sautées »).
- [ ] **Step 4:** mettre à jour le second cerveau (`brain/outils/simatis-os-structure.md`, `brain/outils/simatis-os-feuille-de-route.md`, `log.md`) et la mémoire d'avancement.

## Hors périmètre (suites possibles)

Import des factures clients et fournisseurs ; liaison automatique affaire ↔ facture (mémoriser « Compter ») ; badge d'origine « Pennylane » dans Mouvements ; catégorisation automatique des libellés bancaires ; mémorisation d'une correspondance de colonnes personnalisée.
