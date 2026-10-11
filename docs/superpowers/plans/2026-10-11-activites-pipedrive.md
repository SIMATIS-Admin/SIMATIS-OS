# Activités à la Pipedrive — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les tâches deviennent des activités à la Pipedrive : six types, heure facultative, « Et ensuite ? », liste filtrable par type et période, pastille de menu, grille horaire Jour / Semaine, signaux d'activité dans le Pipeline.

**Architecture:** Nouvelles colonnes sur `taches` (`type`, `type_choisi`, `avec_heure`, `duree_minutes`, `occupe`) avec `canal` dérivé du type ; `opportunites.derniere_activite` ; `preferences.options` ; `instances.config.inactiviteJours`. Le service `src/crm/taches.ts` et les écrans existants sont étendus, sans nouvelle table.

**Tech Stack:** TypeScript, Fastify, Drizzle, Zod, React 19, Vitest (testcontainers, jsdom).

**Spec:** `docs/superpowers/specs/2026-10-11-activites-pipedrive-design.md`

## Global Constraints

- Données de test fictives uniquement (domaines `.example`).
- Types : `appel | email | tache | reunion | echeance | dejeuner` ; libellés Appel, Email, Tâche, Réunion, Échéance, Déjeuner.
- `canal` = `appel` | `email` | `tache` (autres types → `tache`) ; Brief, routines, MCP inchangés.
- Vers HubSpot : `hs_task_type` `CALL` / `EMAIL` / `TODO` ; durée, occupé et type exact jamais envoyés.
- Heure de Paris pour tous les calculs de jour (helpers `web/src/pages/taches/creneaux.ts`, `src/pilotage/realisees.ts`).
- `npm run verify` vert avant chaque commit (conteneur Node 24 sur ce poste) ; une PR par livraison.

## Review Focus

- Synchronisation HubSpot après un type choisi ou une heure précise fixés dans l'OS : ni le type ni `avec_heure` ne reviennent en arrière.
- « Et ensuite ? » déclenché par « Tout reporter à aujourd'hui » : ne doit pas s'ouvrir (ce n'est pas « faite »).
- Pastille du menu sur une instance sans tâches ou sur le Portefeuille : 0, pas d'erreur.
- Deux activités qui se chevauchent dans la grille : côte à côte, aucune masquée.
- Opportunité close : pas d'icône d'état ni de bordure d'inactivité.

---

## Livraison 1 (PR 1)

### Task 1: Modèle et types

**Files:**
- Modify: `src/crm/schema.ts`, `src/crm/type-tache.ts`, `src/crm/type-tache.test.ts`, `src/preferences/schema.ts`
- Create: migration `drizzle/0015_activites.sql` (`npm run db:generate -- --name activites`, puis ajout à la main de `UPDATE "taches" SET "type" = "canal";` avant le `SET NOT NULL`, ou colonne créée avec `DEFAULT 'tache'` puis mise à jour)

**Interfaces:**
- Produces: `export type TypeActivite = 'appel' | 'email' | 'tache' | 'reunion' | 'echeance' | 'dejeuner'` ; `typeActivite(titre: string, typeHubspot?: string | null): TypeActivite` ; `canalDe(type: TypeActivite): Canal` ; `typeTache` conservé (= `canalDe(typeActivite(...))`).
- Colonnes : `taches.type` text not null default `'tache'`, `taches.type_choisi` bool default false, `taches.avec_heure` bool default false, `taches.duree_minutes` int null, `taches.occupe` bool default false, `opportunites.derniere_activite` timestamptz null, `preferences.options` jsonb not null default `'{}'`.

- [ ] **Step 1: Tests** — `typeActivite('Déjeuner avec Agathe')` → `'dejeuner'` ; `'RDV Fonderie'`, `'Réunion de lancement'` → `'reunion'` ; `'Échéance devis'`, `'Date limite dossier'` → `'echeance'` ; `'Appeler pour caler la réunion'` → `'appel'` (Téléphone d'abord, puis Email, puis Réunion, Déjeuner, Échéance) ; `canalDe('reunion')` → `'tache'`, `canalDe('email')` → `'email'`. Les tests `typeTache` existants restent verts.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Implémenter** — mots : Réunion `reunion, rdv, rendez, visio, meeting` ; Déjeuner `dejeuner, dej, diner, cafe` ; Échéance `echeance, limite, deadline`. Colonnes + migration (lignes existantes : `type = canal`).
- [ ] **Step 4: Lancer, vérifier le succès** (inclut les tests de migration via la suite).
- [ ] **Step 5: Commit.**

### Task 2: Copie et écritures HubSpot

**Files:**
- Modify: `src/connecteurs/hubspot/mapping.ts` (`mapTask` → `type`, `canal` ; `PROPRIETES.deals` + `notes_last_updated` ; `mapDeal` → `derniereActivite`), `src/connecteurs/hubspot/sync.ts` (tâches : ne pas écraser `type`/`canal` si `type_choisi`, ne jamais toucher `avec_heure`, `duree_minutes`, `occupe`), `src/connecteurs/hubspot/write.ts` (`task.create` / `task.update` : `hs_task_type` d'après `d.type`)
- Test: `src/connecteurs/hubspot/hubspot.test.ts`

- [ ] **Step 1: Tests**
  - Copie : tâche « Déjeuner avec Romain » (`TODO`) → `type: 'dejeuner'`, `canal: 'tache'`.
  - Après `update taches set type='reunion', type_choisi=true, avec_heure=true where source_id='401'`, une synchro (tâche 401 modifiée côté portail) laisse `type='reunion'`, `avec_heure=true`.
  - Transaction avec `notes_last_updated: '2026-10-01T09:00:00Z'` → `derniere_activite` en base.
  - `task.update { tacheId, type: 'appel' }` armé → `{ properties: { hs_task_type: 'CALL' } }` ; `type: 'dejeuner'` → `TODO` ; `dureeMinutes` / `occupe` dans `data` n'apparaissent jamais dans la requête.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Implémenter** — dans `syncHubspot`, pour les tâches existantes, lire `type_choisi` (une requête sur les ids) et retirer `type`/`canal` des valeurs quand il est vrai.
- [ ] **Step 4: Lancer, vérifier le succès.**
- [ ] **Step 5: Commit.**

### Task 3: Service, API et préférences

**Files:**
- Modify: `src/crm/taches.ts`, `src/crm/taches.test.ts`, `src/api/routes.ts`, `src/preferences/service.ts`
- Test: `src/crm/taches.test.ts`, `src/api` via `buildApp`

**Interfaces:**
- `TacheVue` + `type: TypeActivite; avecHeure: boolean; dureeMinutes: number | null; occupe: boolean; opportunite: { id; titre; clos: 'gagne' | 'perdu' | null } | null`.
- `createTache` / `updateTache` acceptent `type?`, `avecHeure?`, `dureeMinutes?` (15–480), `occupe?`. `type` fourni → `type_choisi = true`, `canal = canalDe(type)` ; sinon type d'après l'intitulé (et repli HubSpot comme aujourd'hui).
- `updateTache({ fait: true })` sur une tâche liée à une opportunité → `opportunites.derniere_activite = now()`.
- `compterAFaire(db, instance, maintenant?): Promise<number>` (non faites, échéance avant la fin du jour de Paris) ; route `GET /api/i/:slug/taches/compteur` → `{ n }`.
- `listTaches` accepte aussi `{ du, au }` d'une période de liste (≤ 92 jours) — inchangé côté signature.
- `getOptions(db, utilisateur)` / `setOptions(db, utilisateur, { ensuite?: boolean })` ; routes `GET /api/preferences` (ajoute `options`) et `PUT /api/preferences/options`.

- [ ] **Step 1: Tests** — création avec `type: 'reunion', avecHeure: true, dureeMinutes: 60, occupe: true` → vue conforme, aucune de ces valeurs dans la requête HubSpot ; création sans type « Appeler X » → `type: 'appel'`, `type_choisi` faux ; `fait: true` sur tâche liée → `derniere_activite` renseignée ; `compterAFaire` : en retard + aujourd'hui comptés, demain et faites exclues ; `dureeMinutes: 5` → 400 ; options : défaut `{ ensuite: true }`, `PUT { ensuite: false }` relu.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer, vérifier le succès.**
- [ ] **Step 5: Commit.**

### Task 4: Fenêtre d'activité et « Et ensuite ? »

**Files:**
- Modify: `web/src/api.ts`, `web/src/pages/Taches.tsx`, `web/src/pages/taches/commun.ts` (`TYPES` à 6 entrées : icône, libellé), `web/src/icons.tsx` (icônes `users` réunion, `flag` échéance, `sun` déjeuner réutilisées si suffisantes)
- Create: `web/src/pages/taches/Ensuite.tsx`
- Test: `web/src/pages/Taches.test.tsx`

**Interfaces:**
- Produces: `EditionTache` (rangée de 6 boutons de type `aria-pressed`, case « Heure précise » montrant `Heure`, `Durée`, `Occupé`), `Ensuite({ apres: TacheVue, onPlanifier, onFermer })`.

- [ ] **Step 1: Tests**
  - Saisir « Déjeuner avec Agathe » pré-sélectionne Déjeuner ; cliquer Appel puis changer l'intitulé garde Appel ; `POST` contient `type: 'appel'` seulement quand un type a été cliqué.
  - « Heure précise » décochée : pas de champ heure, `avecHeure: false` ; cochée : `avecHeure: true`, `dureeMinutes`, `occupe`.
  - Cocher « faite » dans la liste ouvre « Et ensuite ? » pré-rempli (même type, date = aujourd'hui + 7 j) ; « Planifier » → `POST` avec `contactId`/`opportuniteId` de la tâche faite ; « Pas maintenant » ferme ; « Ne plus me proposer » → `PUT /api/preferences/options { ensuite: false }`.
  - Options `ensuite: false` ou opportunité `clos: 'perdu'` : rien ne s'ouvre. « Aujourd'hui » de la colonne En retard : rien ne s'ouvre.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer, vérifier le succès.**
- [ ] **Step 5: Commit.**

### Task 5: Liste à la Pipedrive et pastille du menu

**Files:**
- Modify: `web/src/pages/Taches.tsx` (composant `Liste`), `web/src/shell/Sidebar.tsx`, `web/src/App.tsx`, `web/src/api.ts`
- Create: `web/src/pages/taches/periodes.ts`, `web/src/pages/taches/periodes.test.ts`
- Test: `web/src/pages/Taches.test.tsx`, `web/src/shell/Sidebar.test.tsx`

**Interfaces:**
- `periode(cle: 'retard' | 'aujourdhui' | 'demain' | 'semaine' | 'prochaine', maintenant: Date): { du: string; au: string } | 'retard'`.
- `Sidebar` reçoit `compteurs?: Record<string, number>` ; `App` charge `GET …/taches/compteur` au changement d'écran et toutes les 5 minutes.

- [ ] **Step 1: Tests**
  - `periode('demain', 2026-10-31)` → `{ du: '2026-11-01', au: '2026-11-01' }` ; `'prochaine'` le dimanche 11 octobre → `{ du: '2026-10-12', au: '2026-10-18' }` ; `'semaine'` → lundi … dimanche courant.
  - Liste : boutons-icônes de type (« Tous » remet tout) ; « Demain » charge `taches?du=…&au=…` du lendemain ; « En retard » n'affiche que `enRetard` ; Plage avec deux dates.
  - Sidebar : `compteurs={{ taches: 7 }}` affiche une pastille « 7 » sur Tâches ; 0 → pas de pastille.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer, vérifier le succès**, `npm run verify`, vérification navigateur (instance `demo`), PR, CI verte, merge.

---

## Livraison 2 (PR 2) — Grille horaire

### Task 6: Vues Jour et Semaine en grille

**Files:**
- Create: `web/src/pages/taches/Grille.tsx`, `web/src/pages/taches/placement.ts`, `web/src/pages/taches/placement.test.ts`
- Modify: `web/src/pages/Taches.tsx` (bascule Jour · Semaine · Par jour · Liste), `web/src/styles.css`, `web/src/pages/Taches.test.tsx`

**Interfaces:**
- `placer(items: { id: string; debut: string; minutes: number }[]): Map<string, { ligne: number; hauteur: number; colonne: number; colonnes: number }>` — lignes de 30 min depuis 7 h (0 … 27), chevauchements répartis en colonnes.
- `versCreneau(jour: string, ligne: number): string` (ISO UTC, heure de Paris).

- [ ] **Step 1: Tests** — `placer` : 9 h 00 / 60 min → `{ ligne: 4, hauteur: 2, colonne: 0, colonnes: 1 }` ; deux activités 10 h–11 h et 10 h 30–11 h 30 → `colonnes: 2`, colonnes 0 et 1 ; 6 h → ligne 0 ; 22 h → ligne 27. Écran : bande « Journée » « 12 activités » sur un jour à 12 tâches sans heure, ouverte au clic ; glisser sur 14 h 00 → `PATCH { echeance, avecHeure: true }` ; glisser sur la bande → `PATCH { avecHeure: false }` sans `echeance` si même jour.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer, vérifier le succès**, `npm run verify`, navigateur, PR, CI verte, merge.

---

## Livraison 3 (PR 3) — Pipeline

### Task 7: État d'activité et inactivité

**Files:**
- Modify: `src/crm/pipeline.ts` (par opportunité : `prochaine: { echeance: string; enRetard: boolean } | null`, `derniereActivite`, `inactiviteJours`), `src/api/routes.ts` (`PATCH /api/i/:slug/pipeline/reglages { inactiviteJours: 1..90 }` → `instances.config.inactiviteJours`, sans toucher `ecrituresReelles`), `web/src/pages/Pipeline.tsx` (icône d'état, bordure et « N j sans activité »), `web/src/pages/Parametres.tsx` (réglage), tests associés.

- [ ] **Step 1: Tests** — `getPipeline` : opportunité avec tâche future non faite → `prochaine.enRetard: false` ; tâche passée non faite → `true` ; aucune → `null` ; `derniere_activite` il y a 20 jours avec seuil 14 → carte « 20 j sans activité » ; opportunité close → ni icône ni bordure ; `PATCH reglages { inactiviteJours: 0 }` → 400, `{ inactiviteJours: 21 }` relu et `ecrituresReelles` inchangé.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer, vérifier le succès**, `npm run verify`, navigateur, PR, CI verte, merge.
