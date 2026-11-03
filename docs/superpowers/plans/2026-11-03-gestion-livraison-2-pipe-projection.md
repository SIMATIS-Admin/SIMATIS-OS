# Gestion, livraison 2 : le pipe dans la projection — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les affaires ouvertes du Pipeline, pondérées par leur probabilité et datées par une signature estimée, alimentent les scénarios de trésorerie de Gestion ; un verdict en une phrase et un curseur « et si les signatures glissent ? » le rendent lisible.

**Architecture:** Un module serveur pur (`src/gestion/pipe.ts`) transforme les affaires en `Mouvement` de recette ; `projeter` les ajoute aux scénarios central et ambitieux. Une nouvelle colonne OS-only `signature_estimee` porte la date. Côté web, un verdict calculé, un tableau des affaires et le curseur s'ajoutent à l'onglet Pilotage.

**Tech Stack:** Fastify, Drizzle (Postgres), zod, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-gestion-refonte-design.md` (sections « Pilotage », « Décisions prises », « Données »).

## Global Constraints

- Montants en centimes entiers. `opportunites.montant` est en **euros** : ponctuel = euros une fois ; récurrent = euros par mois sur `dureeEngagementMois`. Conversion `× 100` dans `pipe.ts` uniquement.
- La signature estimée est un champ **OS-only** (jamais envoyé à HubSpot, éditable même en lecture seule), comme `probabiliteManuelle`. Repli : `echeance` (date de clôture HubSpot) quand elle est vide.
- Probabilité effective = `probabiliteManuelle ?? probabilité de l'étape` ; sans probabilité, l'affaire est exclue et signalée, jamais supposée.
- Une affaire sans montant, sans date de signature, clôturée (`clos` non nul) ou sans probabilité n'entre pas dans la projection ; chacune est listée avec sa raison.
- Aucune écriture chez un tiers. Données de test fictives uniquement (dépôt public).
- Règle d'encaissement : ponctuel = 50 % à signature + délai de paiement, 50 % 60 jours plus tard ; récurrent = une échéance par mois à partir de signature + délai de paiement. Délai = réglage `delaiPaiementJours` ; s'il est vide, 0 jour avec avertissement (comportement actuel pour les recettes).
- Scénarios : sécurisé = aucune affaire ; central = montant × probabilité ; ambitieux = en plus des recettes certaines et probables, les affaires à 50 % et plus à 100 %.
- Branche depuis `origin/main` à jour ; `npm run verify` vert avant chaque commit ; `git add` explicite.

## Review Focus

- Signature déjà passée sur une affaire encore ouverte : encaissement compté à la date du jour, avec une note.
- Affaire récurrente dont la durée dépasse l'horizon : seules les échéances dans l'horizon comptent.
- Décalage de signature de 6 mois : un encaissement qui sort de l'horizon disparaît, sans erreur.
- Affaire déjà facturée dans Gestion : possible double compte ; l'interrupteur « Compter » du tableau est le garde-fou (liaison automatique prévue à la livraison 3).
- Probabilité 0 % : l'affaire est comptée pour zéro dans le central, listée comme « à 0 % ».

## Fichiers

- Modify `src/crm/schema.ts` : colonne `signatureEstimee`. Create `drizzle/0068_signature_estimee.sql` (générée par `npm run db:generate`).
- Modify `src/crm/fiches.ts` (+ `src/api/routes.ts` schéma zod) : champ local `signatureEstimee`. Test : `src/crm/fiches.test.ts`.
- Create `src/gestion/pipe.ts`, `src/gestion/pipe.test.ts`.
- Modify `src/gestion/tresorerie.ts` (`projeter`, type `Projection`), `src/gestion/routes.ts` (paramètres), `src/gestion/tresorerie.test.ts`, `src/gestion/tresorerie.routes.test.ts`.
- Modify `web/src/api.ts` (types, `fetchTresorerie`, `patchFiche` déjà existant).
- Create `web/src/pages/gestion/verdict.ts` (+ test), `web/src/pages/gestion/GestionPipe.tsx` (+ test). Modify `web/src/pages/Gestion.tsx`, `web/src/pages/GestionTresorerie.tsx` (type `ParamsTresorerie`).

---

### Task 1: Colonne `signatureEstimee`, éditable en local

**Files:** `src/crm/schema.ts` (près de `probabiliteManuelle`, l. 80), `src/crm/fiches.ts` (`PatchFiche`, `CHAMPS.affaire`, `CHAMPS_LOCAUX`), `src/api/routes.ts` (`patchFicheSchema`), `drizzle/0068_signature_estimee.sql`.

**Interfaces:** Produces `opportunites.signatureEstimee: string | null` (date ISO) ; `patchFiche(slug, 'affaire', id, { signatureEstimee: string | null })` accepté, sans écriture HubSpot.

- [ ] **Step 1: Write the failing test** dans `src/crm/fiches.test.ts` : `modifie la signature estimée sans écrire dans HubSpot, même en lecture seule` — sur une affaire HubSpot en lecture seule, `updateFiche(..., { signatureEstimee: '2027-02-01' })` renvoie la fiche avec cette date et `writeVia` n'est pas appelé ; `null` l'efface ; `'pas une date'` est refusé par le schéma de l'API (400).
- [ ] **Step 2: Run** `npx vitest run src/crm/fiches.test.ts` — Expected: FAIL (champ inconnu).
- [ ] **Step 3: Implement** : colonne `signature_estimee date` nullable ; l'ajouter à `PatchFiche`, `CHAMPS.affaire` et `CHAMPS_LOCAUX` ; zod `z.iso.date().nullable()` ; `npm run db:generate` pour la migration.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/crm/schema.ts src/crm/fiches.ts src/crm/fiches.test.ts src/api/routes.ts drizzle && git commit -m "feat(crm): signature estimée propre à l'OS"`.

### Task 2: Moteur pur `pipe.ts`

**Files:** Create `src/gestion/pipe.ts`, `src/gestion/pipe.test.ts`.

**Interfaces:**
- Consumes: `Mouvement`, `Scenario`, `ajouterJours`/`ajouterMois` de `tresorerie.ts` (exporter `ajouterJours` si besoin).
- Produces:
  - `type OppPipe = { id: string; titre: string; entreprise: string | null; etape: string; clos: 'gagne' | 'perdu' | null; montant: number | null; modeFacturation: 'spot' | 'recurrent'; dureeEngagementMois: number; probabiliteManuelle: number | null; signatureEstimee: string | null; echeance: string | null }`
  - `type AffairePipe = { id: string; titre: string; entreprise: string | null; probabilite: number | null; totalCents: number; recurrent: boolean; mensuelCents: number | null; signature: string | null; statut: 'comptee' | 'sans_date' | 'sans_montant' | 'sans_probabilite' }`
  - `affairesPipe(opps: OppPipe[], probaEtape: Map<string, number | null>): AffairePipe[]` (affaires ouvertes uniquement ; `signature = signatureEstimee ?? echeance`)
  - `mouvementsPipe(affaires: AffairePipe[], p: { scenario: Scenario; delaiJours: number | null; decalageMois: number; exclus: Set<string>; aujourdhui: string; fin: string }): Mouvement[]` (`nature: 'recette'`, `ref: 'pipe:<id>'`, `estime: true`, `note` « Pipe : <probabilité> % de <titre> »)

- [ ] **Step 1: Write the failing tests** (affaires fictives, `aujourdhui = '2026-11-12'`) :
  - `central pondère : ponctuel 10 000 € à 60 %, signé le 2027-01-15, délai 30 j → 3 000 € le 2027-02-14 et 3 000 € le 2027-04-15` (en centimes).
  - `récurrent 2 500 €/mois à 70 %, 12 mois, signé 2026-12-10, délai 30 j → 1 750 € par mois à partir du 2027-01-09, 12 échéances` ; avec `fin` à 6 mois, seules celles de l'horizon.
  - `sécurisé : aucun mouvement`.
  - `ambitieux : 100 % des affaires à 50 % et plus, rien pour une affaire à 30 %`.
  - `décalage de 3 mois repousse chaque date de 3 mois` ; `exclus` retire l'affaire.
  - `statut : sans date, sans montant, sans probabilité ; une affaire clôturée n'apparaît pas`.
  - `signature passée : comptée à la date du jour avec une note`.
- [ ] **Step 2: Run** `npx vitest run src/gestion/pipe.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les deux fonctions, en réutilisant `ajouterJours`/`ajouterMois`. Seuil « chaude » : constante `SEUIL_AFFAIRE_CHAUDE = 50`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/gestion/pipe.ts src/gestion/pipe.test.ts src/gestion/tresorerie.ts && git commit -m "feat(gestion): moteur du pipe dans la projection"`.

### Task 3: `projeter` et l'API

**Files:** `src/gestion/tresorerie.ts` (`projeter`, `Projection`), `src/gestion/routes.ts` (l. ~375-395), tests `tresorerie.test.ts` et `tresorerie.routes.test.ts`.

**Interfaces:**
- Consumes: `affairesPipe`, `mouvementsPipe` (Task 2) ; `getPipeline`/`pipelineSource` de `src/crm/pipeline.ts` pour les probabilités d'étape.
- Produces: `projeter(tx, { …, decalageMois?: number; exclus?: string[] })` ; `Projection.pipe: { affaires: AffairePipe[]; decalageMois: number }` ; `GET gestion/tresorerie?decalage=0..6&exclus=<id,id>`.

- [ ] **Step 1: Write the failing tests** : routes — `le central inclut le pipe pondéré et le sécurisé non` (insérer une affaire fictive avec montant, étape et `signature_estimee`) ; `decalage=3 déplace l'encaissement` ; `exclus retire l'affaire` ; `decalage=9` ou `exclus` mal formé → 400 ; `la réponse liste les affaires avec leur statut` ; la projection sans affaire reste identique à celle d'aujourd'hui (non-régression).
- [ ] **Step 2: Run** `npx vitest run src/gestion/tresorerie.routes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : charger les affaires ouvertes de l'instance ; ajouter `mouvementsPipe` aux entrées de chaque scénario ; avertissement « N affaire(s) du pipe sans date ou sans probabilité : non comptée(s) » ; paramètres validés par zod (`decalage` entier 0 à 6, `exclus` liste d'UUID).
- [ ] **Step 4: Run** `npx vitest run src/gestion` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/gestion && git commit -m "feat(gestion): le pipe alimente les scénarios de trésorerie"`.

### Task 4: Verdict et paramètres côté web

**Files:** `web/src/api.ts` (`ProjectionTresorerie.pipe`, `fetchTresorerie` avec `decalage` et `exclus`), `web/src/pages/GestionTresorerie.tsx` (`ParamsTresorerie`), create `web/src/pages/gestion/verdict.ts`, `verdict.test.ts`.

**Interfaces:** Produces `verdictProjection(p: ProjectionTresorerie, decalageMois: number): { niveau: 'bon' | 'attention' | 'alerte' | 'inconnu'; titre: string; texte: string }` ; `ParamsTresorerie` gagne `decalage: number; exclus: string[]`.

- [ ] **Step 1: Write the failing tests** : `bon` quand aucun scénario n'alerte ; `attention` quand seul le sécurisé alerte, avec le mois de franchissement en toutes lettres ; `alerte` quand le central alerte ; `inconnu` (« Renseignez le solde et le seuil ») sans solde ni seuil ; le texte cite le nombre d'affaires comptées et, si `decalageMois > 0`, le retard.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/gestion/verdict.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `verdictProjection` (pur) et l'URL de `fetchTresorerie`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add web/src && git commit -m "feat(gestion): verdict de trésorerie"`.

### Task 5: Tableau des affaires, curseur et verdict dans Pilotage

**Files:** create `web/src/pages/gestion/GestionPipe.tsx`, `GestionPipe.test.tsx` ; modify `web/src/pages/Gestion.tsx` (Pilotage : verdict en tête, `GestionPipe` sous la projection), `web/src/styles.css`.

**Interfaces:** Consumes `AffairePipe`, `verdictProjection`, `patchFiche`. Produces `GestionPipe(props: { affaires: AffairePipe[]; decalage: number; exclus: string[]; onDecalage(n: number): void; onExclus(ids: string[]): void; onDate(id: string, date: string | null): void })`.

- [ ] **Step 1: Write the failing tests** : le tableau montre probabilité, montant, signature, pondéré et un total qui ignore les affaires exclues ; une affaire sans date est signalée et grisée ; changer la date appelle `onDate` ; le curseur (0 à 6) appelle `onDecalage` ; dans `Gestion.test.tsx`, `modifier la date d'une affaire envoie signatureEstimee à la fiche et recharge la projection` et `le verdict s'affiche en tête de Pilotage`.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/gestion/GestionPipe.test.tsx web/src/pages/Gestion.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** le composant (balisage de la maquette `maquette-gestion.html`, section « Ce que le pipe apporte ») ; dans `Gestion.tsx`, `onDate` appelle `patchFiche(slug, 'affaire', id, { signatureEstimee })` puis `charger()` ; `decalage` et `exclus` vivent dans `paramsTreso` (calcul d'affichage, rien n'est écrit).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add web/src && git commit -m "feat(gestion): tableau du pipe, curseur de signature et verdict"`.

### Task 6: Vérification, PR et mémoire

- [ ] **Step 1:** `npm run verify` — Expected: tout vert (les tests serveur demandent Docker).
- [ ] **Step 2:** vérifier dans le navigateur sur un banc d'essai à données fictives (serveur en tâche de fond suivie, arrêté ensuite) : verdict, curseur, changement de date, exclusion d'une affaire, mobile 375 px.
- [ ] **Step 3:** ouvrir la PR, activer le suivi de la CI, corriger, attendre le vert ; merge après validation de Marc ; reconstruire l'app depuis `origin/main` (`git archive`, `docker build`, `docker compose up -d --no-build app`, `curl localhost:4300/health`).
- [ ] **Step 4:** mettre à jour le second cerveau (`brain/outils/simatis-os-structure.md`, `brain/outils/simatis-os-feuille-de-route.md`, `log.md`) et la mémoire d'avancement.
