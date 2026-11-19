# Devis, livraison A : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Un devis rattaché à une affaire, créé en un clic depuis la fiche de l'affaire ou depuis la liste des devis, édité en 4 étapes (mission, prix, conditions, envoi) avec aperçu à l'écran, verrouillé à la validation, versionnable.

**Architecture :** On étend la table `devis` et le module `src/conversion/devis.ts` (pas de nouveau module). Le contenu d'un devis (mission, prix, clauses) est validé par un schéma zod unique ; les montants sont calculés par une fonction pure côté serveur et recalculés en direct côté interface. L'écran `Devis.tsx` est découpé en quatre composants. Le PDF, les Paramètres du devis, la relance et le suivi accepté/refusé sont hors de cette livraison (B et C).

**Tech Stack :** TypeScript, Fastify, Drizzle (Postgres), zod, React, Vitest.

**Spec :** `docs/superpowers/specs/2026-11-19-devis-design.md` ; maquette `maquettes/devis.html`.

## Global Constraints

- Dépôt public : fixtures et tests uniquement fictifs (sociétés « Exemple », « Démo »…). Aucune clause, aucun tarif réel.
- L'OS ne propose jamais de prix : une ligne créée depuis l'affaire a `prixUnitaire: null` ; le montant de l'affaire n'apparaît que dans `prixPropose`, repris par un clic de Marc.
- Module `devis` réservé à l'instance « Mon activité » (`devisActif`), 404 ailleurs (comportement actuel).
- Un devis non brouillon est verrouillé : toute modification renvoie `DevisRefuse` (HTTP 400).
- Statuts en base inchangés : `brouillon | valide | transmis` ; l'interface affiche « Envoyé » pour `transmis`. Accepté / refusé arrivent en livraison C.
- Numérotation `DEV-AAAA-NNN` ; nouvelle version : `<numéro de base>-V<n>`. TVA unique 20 %. Validité par défaut 30 jours, acompte par défaut 0 %.
- Interface en français ; commentaires de code : le pourquoi seulement. Pas de `.md` non demandé.
- Branche : `feature/devis-a` créée depuis `origin/main` à jour. Commits au fil de l'eau, `npm run verify` avant chaque commit. Ne jamais `git add -A`.
- Migration : `npm run db:generate`, puis vérifier la colonne et l'endpoint après le rebuild (une autre session peut avoir appliqué des migrations plus récentes).

## Review Focus

- Une affaire a déjà un devis non refusé : « Préparer un devis » ouvre l'existant, ne crée pas de doublon.
- Affaire sans entreprise ni contact : la création réussit, champs vides, aperçu sans plantage.
- Affaire sans montant, ou récurrente avec durée d'engagement : `prixPropose` null ou mensuel × durée, jamais appliqué.
- Remise 100 %, acompte 100 %, quantités ou prix à 0 : totaux sans NaN ni négatif.
- Deux « nouvelle version » successives : numéros `…-V2`, `…-V3`, jamais de collision ; l'ancienne version reste intacte.
- Devis déjà validé reçu par PATCH : refusé, contenu inchangé.

## Structure des fichiers

- Modifier `src/conversion/schema.ts` : colonnes et types du devis.
- Créer `src/conversion/devis-contenu.ts` : schéma zod du contenu, fonction de calcul des montants.
- Modifier `src/conversion/devis.ts` : création depuis l'affaire, mise à jour du contenu, nouvelle version, validation.
- Modifier `src/api/routes.ts` : routes devis.
- Créer `src/conversion/devis.test.ts` ; modifier `src/conversion/conversion.test.ts` (tests devis existants).
- Créer `drizzle/NNNN_*.sql` (généré).
- Créer `web/src/devis.ts` (+ `devis.test.ts`) : types et calcul côté interface.
- Modifier `web/src/api.ts` : fonctions d'appel.
- Réécrire `web/src/pages/Devis.tsx` ; créer `web/src/pages/DevisListe.tsx`, `DevisAffaire.tsx`, `DevisEditeur.tsx`, `DevisApercu.tsx` (+ tests).
- Modifier `web/src/pages/Fiche.tsx` (bouton) et `web/src/App.tsx` (route `devis` avec `ouvrir`).
- Modifier `docs/plan.md`, `maquettes/os-commercial/LISEZ-MOI.md` si l'écran Devis y est décrit comme obsolète.

---

### Task 1 : Modèle de données et calcul des montants

**Files:**
- Modify: `src/conversion/schema.ts`
- Create: `src/conversion/devis-contenu.ts`, `src/conversion/devis-contenu.test.ts`, migration `drizzle/`

**Interfaces:**
- Produces:
  - `type LigneDevis = { libelle: string; unite: 'forfait'|'jour'|'mois'|'personne'|'heure'; quantite: number; prixUnitaire: number | null; prixPropose?: number | null }`
  - `type Clause = { titre: string; texte: string; active: boolean }`
  - `contenuSchema` (zod) : `{ titre, contexte, objectifs, inclus, exclu, livrables, debut: string|null (YYYY-MM-DD), duree, lignes, remisePct (0-100), acomptePct (0-100), frais: 'refactures'|'inclus', validiteJours (1-365), clauses }`
  - `calculer(c: { lignes: LigneDevis[]; remisePct: number; acomptePct: number }, tvaPct = 20): { brut: number; remise: number; ht: number; tva: number; ttc: number; acompte: number; prixManquant: boolean }` (montants en euros, arrondis au centime)
  - Colonnes `devis` ajoutées : `version int not null default 1`, `titre`, `contexte`, `objectifs`, `inclus`, `exclu`, `livrables`, `duree` (text not null default ''), `debut date null`, `remise_pct int default 0`, `acompte_pct int default 0`, `frais text default 'refactures'`, `validite_jours int default 30`, `clauses jsonb default '[]'`.
  - Les lignes existantes (sans `unite`) restent lisibles : `unite` vaut `'forfait'` par défaut au parsing.

- [ ] **Step 1: Tests de `calculer` dans `devis-contenu.test.ts`.** Cas : (a) deux lignes 1×1800 et 2×450, remise 10 %, acompte 30 % → `brut 2700, remise 270, ht 2430, tva 486, ttc 2916, acompte 874.8` ; (b) une ligne à `prixUnitaire: null` → `prixManquant: true` et `brut` compte 0 pour cette ligne ; (c) remise 100 % → `ht 0, ttc 0` ; (d) liste vide → tout à 0. Plus : `contenuSchema` refuse une remise de 101 et une liste de lignes vide, accepte une ligne ancienne sans `unite`.
- [ ] **Step 2: Lancer** `npx vitest run src/conversion/devis-contenu.test.ts` ; attendu : échec (module absent).
- [ ] **Step 3: Implémenter** `devis-contenu.ts` (arrondi au centime avec `Math.round(x*100)/100`), étendre `schema.ts`, remplacer le type `LigneDevis` existant (garder l'ancien nom `libelle/quantite/prixUnitaire`, ajouter `unite` optionnelle côté lecture). Générer la migration avec `npm run db:generate` et vérifier qu'elle ne contient que des `ADD COLUMN` avec valeurs par défaut.
- [ ] **Step 4: Relancer** le test ; attendu : PASS. Lancer `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(devis): modèle de données étendu et calcul des montants`.

---

### Task 2 : Services du devis

**Files:**
- Modify: `src/conversion/devis.ts`
- Test: `src/conversion/devis.test.ts` (nouveau, mêmes outils que `conversion.test.ts` : `setupTestApp`, `buildApp`, `seedDemoIfEmpty`, requêtes via `app.inject`, instance `simatis`)

**Interfaces:**
- Consumes: `contenuSchema`, `calculer`, `Clause`, `LigneDevis` (Task 1).
- Produces (toutes `(db: Executor, instance: Instance, …)` sauf mention) :
  - `creerDepuisAffaire(db, instance, opportuniteId: string): Promise<{ devis: Devis; existant: boolean }>` : si l'affaire a déjà un devis dont le statut n'est pas supplanté par une version plus récente, renvoie sa dernière version avec `existant: true`. Sinon crée un brouillon pré-rempli : `titre` = titre de l'affaire ; une ligne `{ libelle: titre, unite: 'mois' si récurrente sinon 'forfait', quantite: durée d'engagement si récurrente sinon 1, prixUnitaire: null, prixPropose: montant de l'affaire ou null }` ; `clauses` = clauses du devis le plus récent de l'instance, sinon `[]` ; `validiteJours` 30 ; numéro `DEV-AAAA-NNN` (NNN = nombre de devis de l'instance + 1, sur 3 chiffres, première version seulement).
  - `modifierContenu(db, instance, id: string, contenu: z.infer<typeof contenuSchema>): Promise<Devis>` : refuse si statut ≠ `brouillon`.
  - `validerDevis(db, instance, id)` : existant, durcir : refuse aussi si `inclus` est vide ou si `prixManquant`.
  - `nouvelleVersion(db, instance, id: string): Promise<Devis>` : copie le contenu, `version + 1`, statut `brouillon`, numéro `<base>-V<version>` où base = numéro sans suffixe `-V\d+`, refuse si la source n'est pas la dernière version de la chaîne.
  - `listerDevis` : renvoie en plus `version`, `titre`, `opportuniteId`, `totaux: ReturnType<typeof calculer>`, `entreprise`, `contact`, et ne garde pour chaque numéro de base que la dernière version, plus `versions: number`.
  - `lireDevis(db, instance, id): Promise<Devis & { entreprise, contact, opportunite, totaux }>`.
  - `preparerDevis` et `modifierLignes` sont supprimés (remplacés).

- [ ] **Step 1: Écrire les tests**, un `it` par comportement, avec une affaire fictive du jeu de démo : (1) `creerDepuisAffaire` sur une affaire à 900 €/mois récurrente sur 6 mois donne une ligne `unite 'mois', quantite 6, prixUnitaire null, prixPropose 900` et `totaux.prixManquant === true` ; (2) deuxième appel sur la même affaire : `existant: true`, même id, pas de nouvelle ligne en base ; (3) affaire sans montant : `prixPropose` null ; affaire sans entreprise : création réussie ; (4) clauses héritées du devis précédent (créer un devis, lui poser une clause, en créer un autre sur une autre affaire) ; (5) `modifierContenu` sur un devis validé lève `DevisRefuse` et le contenu en base est inchangé ; (6) `validerDevis` refuse sans prix, refuse avec `inclus` vide, accepte sinon ; (7) `nouvelleVersion` deux fois de suite : numéros `DEV-2026-001-V2` puis `-V3` (année lue via `new Date().getFullYear()`), l'original reste `valide` ; (8) `listerDevis` ne montre que la dernière version avec `versions: 3`.
- [ ] **Step 2: Lancer** `npx vitest run src/conversion/devis.test.ts` ; attendu : échec.
- [ ] **Step 3: Implémenter** les fonctions ci-dessus dans `devis.ts`. Toutes les écritures passent par `withInstance` ; chaque création, validation et nouvelle version écrit une ligne `logEvent` (acteur `os` pour la création, `pilote` pour la validation et la version), comme les fonctions actuelles. L'enchaînement de versions se retrouve par le numéro de base (même base, même instance).
- [ ] **Step 4: Relancer** ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(devis): création depuis l'affaire, contenu complet et versions`.

---

### Task 3 : Routes de l'API

**Files:**
- Modify: `src/api/routes.ts` (bloc devis, autour des lignes 2169-2215), `src/conversion/conversion.test.ts` (tests devis)

**Interfaces:**
- Consumes: services de la Task 2.
- Produces (toutes sous `/api/i/:slug/devis`, gardées par `surDevis`) :
  - `GET /` → liste (voir `listerDevis`) ; `GET /:id` → `lireDevis`.
  - `POST /` corps `{ opportuniteId }` → `{ ...devis, existant: boolean }` (200 dans les deux cas).
  - `PUT /:id` corps `contenuSchema` → devis modifié (remplace l'ancien `PATCH` sur les lignes ; l'ancien `PATCH` est supprimé).
  - `POST /:id/valider`, `POST /:id/version`, `POST /:id/transmettre` (inchangé).

- [ ] **Step 1: Adapter les tests de `conversion.test.ts`** au nouveau comportement (une seule ligne créée avec `prixUnitaire: null`, `PUT` au lieu de `PATCH`, `total` lu dans `totaux.ttc`/`totaux.ht`) et ajouter : `POST /devis` deux fois sur la même affaire renvoie le même `id` avec `existant: true` ; `PUT` sur un devis validé → 400 ; `POST /:id/version` → 200 avec `version: 2` ; `GET /:id` d'un identifiant inconnu → 400 `Devis introuvable` ; instance `helioval` → 404 sur chaque route.
- [ ] **Step 2: Lancer** `npx vitest run src/conversion/conversion.test.ts` ; attendu : échec.
- [ ] **Step 3: Implémenter** les routes en réutilisant `surDevis`. Le corps de `PUT` est validé par `contenuSchema` ; une erreur zod reste un 400 « Demande invalide ».
- [ ] **Step 4: Relancer** les deux fichiers de test devis ; attendu : PASS. Lancer `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(devis): routes de l'API (contenu complet, version, lecture)`.

---

### Task 4 : Types et calcul côté interface

**Files:**
- Create: `web/src/devis.ts`, `web/src/devis.test.ts`
- Modify: `web/src/api.ts` (section devis, lignes 1324-1345)

**Interfaces:**
- Produces:
  - Types miroirs `LigneDevis`, `Clause`, `ContenuDevis`, `DevisItem` (liste), `DevisDetail` (lecture), exportés depuis `web/src/api.ts` comme aujourd'hui.
  - `calculer(contenu, tvaPct = 20)` identique au serveur, dans `web/src/devis.ts` (le serveur et l'interface ne partagent pas de code : le test ci-dessous pin les mêmes valeurs des deux côtés).
  - `problemesAvantEnvoi(c: ContenuDevis): string[]` : messages « Un ou plusieurs prix restent à fixer », « Le périmètre inclus est vide », « Aucune exclusion indiquée : à confirmer ».
  - `eur` déjà dans `web/src/crm.ts`, à réutiliser.
  - Fonctions d'appel : `fetchDevis(slug)`, `fetchDevisDetail(slug, id)`, `creerDevis(slug, opportuniteId): Promise<DevisDetail & { existant: boolean }>`, `enregistrerDevis(slug, id, contenu)`, `validerDevis(slug, id)`, `nouvelleVersionDevis(slug, id)`, `transmettreDevis(slug, id)`. Les anciens `preparerDevis` et `saveLignesDevis` sont supprimés.

- [ ] **Step 1: Test** `web/src/devis.test.ts` : mêmes cas (a) à (d) que la Task 1 avec les mêmes résultats attendus ; `problemesAvantEnvoi` renvoie trois messages pour un contenu vide et aucun pour un contenu complet.
- [ ] **Step 2: Lancer** `npx vitest run web/src/devis.test.ts` ; attendu : échec.
- [ ] **Step 3: Implémenter** `devis.ts` et les fonctions d'appel dans `api.ts`.
- [ ] **Step 4: Relancer** ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(devis): calcul et appels côté interface`.

---

### Task 5 : Écran Devis (liste, choix de l'affaire, éditeur, aperçu)

**Files:**
- Modify: `web/src/pages/Devis.tsx` (devient l'aiguillage), `web/src/App.tsx`
- Create: `web/src/pages/DevisListe.tsx`, `DevisAffaire.tsx`, `DevisEditeur.tsx`, `DevisApercu.tsx`, `Devis.test.tsx`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - `Devis({ slug, ouvrir?: string, affaire?: string })` : `ouvrir` = identifiant d'un devis à ouvrir ; `affaire` = identifiant d'une affaire pour laquelle créer (ou rouvrir) le devis tout de suite. Sans paramètre : la liste.
  - `DevisListe({ slug, onOuvrir, onNouveau })` : quatre indicateurs (en attente, acceptés laissé à 0 jusqu'à la livraison C et masqué, prix à fixer), tableau (n°, client, mission, date, statut « Brouillon / Validé / Envoyé », montant HT ou badge « prix à fixer »).
  - `DevisAffaire({ slug, onChoisir })` : recherche dans les affaires ouvertes (`fetchPipeline`), affaires à l'étape Proposition en tête, badge « devis existant » ; un clic appelle `creerDevis` puis ouvre l'éditeur sur l'étape Prix.
  - `DevisEditeur({ slug, id })` : 4 onglets (Mission, Prix, Conditions de vente, Envoi) ; enregistrement automatique du brouillon après 800 ms sans frappe (`enregistrerDevis`) ; bouton « Reprendre X € » sur une ligne qui a un `prixPropose` et pas de prix ; bouton « Valider » désactivé tant que `problemesAvantEnvoi` bloque (prix manquants) ; devis non brouillon : champs désactivés, boutons « Nouvelle version » ; onglet Envoi : contrôles, bouton « Demander l'envoi » (`transmettreDevis`, proposition L2 existante). Pas de PDF ni de brouillon Gmail dans cette livraison : le bouton d'envoi reprend l'existant.
  - `DevisApercu({ contenu, numero, client, contact, date })` : la page de devis de la maquette (`maquettes/devis.html`, fonction `apercu`) en composant, en lecture seule.

- [ ] **Step 1: Tests `Devis.test.tsx`** (Testing Library, `fetch` simulé comme dans les autres tests de pages) : (1) la liste affiche le numéro, le client et le badge « prix à fixer » d'un devis brouillon ; (2) `DevisAffaire` filtre par la saisie et place l'affaire à l'étape Proposition en premier ; clic sur « Préparer le devis » appelle `POST /devis` avec l'identifiant de l'affaire ; (3) dans l'éditeur, saisir un prix met à jour le total TTC de l'aperçu sans appel réseau, et déclenche un `PUT` après la temporisation (horloge simulée) ; (4) « Reprendre 5 100 € » remplit le prix de la ligne ; (5) « Valider » est désactivé avec un prix manquant et actif sinon ; (6) un devis `valide` a tous ses champs désactivés ; (7) `Devis` avec `affaire` ouvre directement l'éditeur de l'existant si la réponse porte `existant: true`.
- [ ] **Step 2: Lancer** `npx vitest run web/src/pages/Devis.test.tsx` ; attendu : échec.
- [ ] **Step 3: Implémenter** les composants. Réutiliser les classes de `web/src/styles.css` (`panel`, `btn`, `badge`, `tbl`, `input`, `alert`, `chip`) ; les rares styles propres (page A4 de l'aperçu, disposition éditeur/aperçu en deux colonnes, bloc de clause) vont dans `web/src/styles.css` en reprenant ceux de la maquette (`.d-page`, `.d-edit`). Mobile : une colonne sous 1100 px. Dans `App.tsx`, passer `ouvrir` et `affaire` depuis la route (`#/<slug>/devis/<id>` pour `ouvrir`, `#/<slug>/devis/affaire/<id>` pour `affaire`).
- [ ] **Step 4: Relancer** ; attendu : PASS. Puis `npm run typecheck`.
- [ ] **Step 5: Vérifier dans le navigateur** (`preview_start` sur `web-dev` et `api-dev`) : liste, création depuis l'affaire, saisie d'un prix, aperçu qui suit, validation, nouvelle version. Capturer la liste et l'éditeur.
- [ ] **Step 6: Commit** `feat(devis): écran Devis (liste, création depuis l'affaire, éditeur en 4 étapes)`.

---

### Task 6 : Entrée « Préparer un devis » dans la fiche de l'affaire

**Files:**
- Modify: `web/src/pages/Fiche.tsx` (fiche affaire, route `#/<slug>/fiche/affaire/<id>`), son test `Fiche.test.tsx`

**Interfaces:**
- Consumes: route `#/<slug>/devis/affaire/<id>` (Task 5).
- Produces: dans l'en-tête de la fiche d'une affaire, uniquement dans une instance où le module devis est actif, un bouton « Préparer un devis » (ou « Ouvrir le devis » si un devis existe déjà pour cette affaire, d'après `fetchDevis`), qui navigue vers la route ci-dessus.

- [ ] **Step 1: Test** dans `Fiche.test.tsx` : instance avec le module devis → le bouton est présent et amène à `#/simatis/devis/affaire/<id>` ; instance sans le module → pas de bouton ; affaire ayant déjà un devis → libellé « Ouvrir le devis ».
- [ ] **Step 2: Lancer** `npx vitest run web/src/pages/Fiche.test.tsx` ; attendu : échec.
- [ ] **Step 3: Implémenter** le bouton en suivant la façon dont `Fiche.tsx` sait déjà quels modules l'instance active (même mécanisme que `nav.ts` pour l'entrée Devis).
- [ ] **Step 4: Relancer** ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(devis): bouton Préparer un devis dans la fiche de l'affaire`.

---

### Task 7 : Vérification, documentation, livraison

**Files:**
- Modify: `docs/plan.md` (ligne 90 : Devis), second cerveau (hors dépôt)

- [ ] **Step 1: `npm run verify`** ; attendu : format, lint, types, tests et build au vert.
- [ ] **Step 2: Garde-fou confidentialité** : relire `git diff --staged` et `git diff origin/main --stat` ; aucune donnée réelle, uniquement des noms fictifs.
- [ ] **Step 3: Mettre à jour `docs/plan.md`** (Devis : mission, prix, conditions, versions ; PDF et Paramètres en B, envoi Gmail et suivi en C).
- [ ] **Step 4: Pousser, ouvrir la PR, faire la revue de code** (corriger ce qui sort), suivre la CI jusqu'au vert, puis merger (`ccd_pr` : `get_status` puis `bind_pr` si besoin).
- [ ] **Step 5: Reconstruire l'application et relancer le conteneur depuis `origin/main`**, puis vérifier la colonne `devis.version` en base et l'endpoint `GET /api/i/simatis/devis`.
- [ ] **Step 6: Second cerveau** : mettre à jour `brain/outils/simatis-os-structure.md` et `brain/outils/simatis-os-feuille-de-route.md` dans `~/Second Cerveau`, noter dans `log.md`, `git pull --rebase`, `git add` des fichiers modifiés, commit, `git push` sur `main`.
- [ ] **Step 7: Expliquer à Marc, pas à pas, comment tester** : ouvrir une affaire, « Préparer un devis », fixer un prix, valider, créer une nouvelle version.
