# Recherche dans les mandats — plan d'implémentation (livraison 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis SIMATIS, le super-administrateur cherche contacts, entreprises et affaires dans les mandats actifs (lecture seule) et copie ou déplace un résultat avec la pastille d'instance.

**Architecture:** la route de recherche existante gagne `portee=mandats` ; chaque mandat est lu dans sa propre transaction isolée avec le rôle restreint (aucune connexion propriétaire). La barre de recherche affiche les résultats par mandat avec `PastilleInstance` (flux de transfert déjà construit).

**Tech Stack:** TypeScript, Fastify, Drizzle (`withInstance`), React, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-recherche-mandats-design.md`

## Global Constraints

- Branche `feature/recherche-mandats` (depuis `origin/main`), jamais de commit sur `main`, pas de worktree ; vérifier `git branch --show-current` et `git status` avant chaque commit (une autre session peut travailler dans ce dossier : ne jamais commiter ses fichiers, ajouter les miens explicitement).
- Dépôt public : données de test uniquement fictives.
- Lecture seule : aucune écriture. Mandats actifs de type `mandat` seulement (ni `prospect`, ni archivés).
- Droit : `peutTransferer(UTILISATEUR_PILOTE, instance)` (`src/transfert/droits.ts`) ; sinon 403.
- Seuil de 2 caractères et 5 résultats par type et par mandat, comme la recherche existante.
- `npm run verify` vert avant la PR ; tests ciblés entre-temps.

## Review Focus

1. Mandat sans résultat : absent de la liste (pas de groupe vide).
2. Requête de moins de 2 caractères avec `portee=mandats` : réponse vide, aucun mandat interrogé.
3. `portee` inconnue : 400 ; sans le droit : 403, même avec une requête vide.
4. Un mandat dont la lecture échoue ne doit pas faire perdre les résultats des autres (pas de fuite du message d'erreur d'un mandat).
5. Fenêtre de transfert ouverte depuis un résultat : la liste de résultats ne doit pas se fermer.

---

### Task 1: Extraire `rechercherDans`

**Files:**
- Create: `src/crm/recherche.ts`
- Modify: `src/api/routes.ts` (route `/api/i/:slug/recherche`, ~ligne 1095)
- Test: `src/crm/recherche.test.ts`

**Interfaces:**
- Produces: `type ResultatsRecherche = { affaires: {id, titre, entreprise: string | null, clos: string | null}[]; personnes: {id, nom, entreprise: string | null}[]; organisations: {id, nom, ville: string | null}[] }` ; `rechercherDans(db: Executor, instance: Instance, q: string): Promise<ResultatsRecherche>` (5 résultats par type, `[]` partout si `q` fait moins de 2 caractères après `trim`).

- [ ] **Step 1: Write the failing test** — `recherche.test.ts` (`setupTestApp`, une instance, un contact, une entreprise, une affaire fictifs) : `rechercherDans` trouve les trois types ; `q = 'a'` renvoie trois listes vides ; plus de 5 contacts → 5 renvoyés.
- [ ] **Step 2: Run** `npx vitest run src/crm/recherche.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `rechercherDans` en déplaçant le corps actuel de la route (`rechercherOpportunites`, `searchContacts`, `searchEntreprises`, `slice(0, 5)`, mêmes champs) ; la route appelle `rechercherDans(db, i, q)`.
- [ ] **Step 4: Run** `npx vitest run src/crm/recherche.test.ts src/api` — Expected: PASS (la recherche ordinaire est inchangée).
- [ ] **Step 5: Commit** `refactor(recherche): extraire la recherche d'une instance`.

---

### Task 2: Route `portee=mandats`

**Files:**
- Modify: `src/crm/recherche.ts`, `src/api/routes.ts`
- Test: `src/api/recherche-mandats.routes.test.ts` (modèle : `src/transfert/routes.test.ts`, `creerMonde` et `fabrique` de `test/transfert.ts`)

**Interfaces:**
- Consumes: `rechercherDans`, `peutTransferer`, `UTILISATEUR_PILOTE`, `listInstances` (`src/instances/service.ts`).
- Produces: `rechercherMandats(db: Executor, q: string): Promise<{ instance: { slug: string; nom: string; couleur: string | null }; affaires; personnes; organisations }[]>` (mandats actifs de type `mandat`, ceux sans résultat omis) ; route `GET /api/i/:slug/recherche?q=&portee=mandats` → `{ mandats: ReturnType<typeof rechercherMandats> }`.

- [ ] **Step 1: Write the failing tests** (app construite avec le rôle restreint `t.app.db`) :
  - `trouve_dans_les_mandats`: un contact « Dupont » dans `mandat-a`, rien dans `mandat-b` → un seul groupe, `instance.slug = 'mandat-a'`, `instance.nom = 'Mandat A'`.
  - `jamais_les_demos_ni_les_archives`: même contact dans une démo et dans un mandat archivé → absents.
  - `isole`: un contact de `siege` n'apparaît pas dans `mandats` ; `mandat-a` ne voit pas `mandat-b` (noms distincts).
  - `droit`: depuis `mandat-a` → 403 ; depuis `siege` sans `portee` → réponse ordinaire inchangée (`affaires`, `personnes`, `organisations`).
  - `portee inconnue` → 400 ; `q` d'un caractère avec `portee=mandats` → `{ mandats: [] }`.
  - `un_mandat_en_panne`: `rechercherMandats` appelé avec un mandat dont la lecture lève une erreur (instance dont l'id n'existe plus entre-temps, simulée par une fonction de lecture injectée) → les autres résultats reviennent, le groupe en panne est omis.
- [ ] **Step 2: Run** `npx vitest run src/api/recherche-mandats.routes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `rechercherMandats` dans `src/crm/recherche.ts` (`Promise.allSettled` sur les mandats, lecture via `rechercherDans`, une panne n'efface pas les autres, erreur non renvoyée au client) et la route : `portee` validée (`undefined` ou `mandats`), contrôle du droit avant toute lecture.
- [ ] **Step 4: Run** `npx vitest run src/api src/crm` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(recherche): recherche dans les mandats, en lecture seule`.

---

### Task 3: Interface — case « Inclure les mandats » et résultats par mandat

**Files:**
- Modify: `web/src/api.ts` (type `Recherche` : champ optionnel `mandats`, paramètre `portee` de `fetchRecherche`), `web/src/shell/Barre.tsx`, `web/src/pages/transfert/PastilleInstance.tsx` (clic de la pastille ne déclenche pas le résultat parent), `web/src/styles.css`
- Test: `web/src/shell/Barre.test.tsx` (ajouts)

**Interfaces:**
- Consumes: route de la Task 2 ; `fetchDroitTransfert(slug)`, `PastilleInstance` (`web/src/pages/transfert/`), qui prend `instance: { slug, nom?, couleur? }`, `objet: { type, id }`, `onTransfere`.
- Produces: `type RechercheMandat = { instance: { slug: string; nom: string; couleur: string | null }; affaires; personnes; organisations }` ; `fetchRecherche(slug: string, q: string, portee?: 'mandats'): Promise<Recherche & { mandats?: RechercheMandat[] }>`.

- [ ] **Step 1: Write the failing tests** (le `fakeFetch` répond à `/transfert/droit` et à `portee=mandats`) :
  - `case_absente_sans_le_droit` ; `case_presente_avec_le_droit`, décochée au départ, et la première requête n'a pas `portee`.
  - `coche_les_resultats_des_mandats_arrivent_groupes_par_mandat` : titre « Mandat A », ligne du contact, pastille « Mandat A » ; la requête contient `portee=mandats`.
  - `clic_sur_un_resultat_de_mandat_ouvre_la_fiche_du_mandat` : `location.hash` vaut `#/mandat-a/fiche/contact/<id>`.
  - `la_pastille_ouvre_le_transfert_sans_ouvrir_la_fiche` : clic sur la pastille → menu des instances, `location.hash` inchangé ; l'aperçu est demandé avec `instanceOrigine: 'mandat-a'`, la liste de résultats reste affichée.
  - `apres_un_transfert_la_recherche_est_relancee`.
- [ ] **Step 2: Run** `npx vitest run web/src/shell/Barre.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** : état `mandats: boolean` et droit chargé une fois par `slug` dans `Barre` ; `fetchRecherche` envoyé avec `portee` quand la case est cochée ; groupes de mandats rendus sous ceux de l'instance courante ; compteur de relance incrémenté à la fin d'un transfert (dépendance de l'effet de recherche) ; `PastilleInstance` accepte une prop `onClickCapture` ou stoppe la propagation du clic de son bouton (au choix de l'implémenteur, tant que le clic ne remonte pas au résultat).
- [ ] **Step 4: Run** `npx vitest run web` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(recherche): résultats des mandats dans la barre de recherche`.

---

### Task 4: Documentation, vérification complète, PR

**Files:**
- Modify: `docs/plan.md` (ligne 38 : règle de lecture entre instances)

**Interfaces:** aucune.

- [ ] **Step 1: Edit** `docs/plan.md` : « Aucune ne lit les données d'une autre, SIMATIS compris » devient : aucune instance ne lit les données d'une autre, sauf SIMATIS qui lit ses mandats actifs en lecture seule, pour le super-administrateur (Inbox agrégée, recherche dans les mandats) ; le portefeuille croise toujours par compteurs.
- [ ] **Step 2: Run** `npm run verify` — Expected: exit 0 (si des modifications d'une autre session perturbent le lint ou les types, le dire dans la PR et vérifier avec la CI).
- [ ] **Step 3: Vérification navigateur** sur base jetable aux données fictives (comme pour la livraison 1) : cocher la case, trouver un contact d'un mandat, ouvrir son menu de pastille, voir l'aperçu de copie ; arrêter serveur et base ensuite.
- [ ] **Step 4: Commit** `docs(plan): SIMATIS lit ses mandats en lecture seule`, push, PR, CI verte, merge, reconstruction de l'app depuis `origin/main` (`git archive` + `docker build` + `docker compose up -d --no-build app`).
