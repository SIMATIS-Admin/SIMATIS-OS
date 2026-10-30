# Prospection, livraison 1 : socle et chiffres

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, choisi par Marc) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer dans l'OS réel la section Prospection (accueil avec compteur du jour et statistiques), le panneau « Prospection du jour » du Brief, et la gestion des signatures et de l'objectif quotidien dans Paramètres.

**Architecture:** Nouveau module `src/prospection/` (schéma Drizzle avec Row-Level Security, services, routes Fastify sous `/api/i/:slug/prospection`), puis page React `Prospection.tsx`, onglet Paramètres et panneau du Brief. Les occurrences (un mail de campagne = une ligne) sont créées par les livraisons suivantes ; en livraison 1 les compteurs partent donc de zéro, et les cartes « Relancer des tâches » et « Prospecter à froid » sont visibles mais marquées « Bientôt ».

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres), React, vitest. Tests de base : `setupTestApp` (`test/database.ts`).

**Spec:** `docs/superpowers/specs/2026-10-30-prospection-design.md` ; maquette de référence : `maquettes/os-commercial/js/v-prospection.js`. Découpage complet : livraison 1 socle (ce plan), 2 relance de tâches, 3 froid, 4 envoi direct, 5 Inbox.

## Global Constraints

- Dépôt public : fixtures et exemples **fictifs uniquement** ; aucune image de signature réelle dans le dépôt (les tests génèrent de petits PNG en mémoire).
- Toute table métier : `metierColumns()` et `instanceIsolation(nom)` ; toute requête filtre aussi explicitement sur `currentInstance`.
- Jour = jour calendaire Europe/Paris (`jourDe` de `src/pilotage/realisees.ts`) ; « semaine » = 7 derniers jours avec aujourd'hui.
- Objectif quotidien : 30 par défaut, réglable de 0 à 500 ; objectif 0 : aucune jauge, aucun pourcentage (pas de division par zéro) ; jauge plafonnée à 100 %.
- Signature : PNG ou JPEG, 400 Ko maximum décodés, nom de 1 à 60 caractères unique dans l'instance ; au plus une signature par défaut ; supprimer la signature par défaut laisse « aucune » par défaut.
- Chaque modification (signature, objectif) est tracée par `logEvent` (acteur `pilote`).
- Interface en français, style du fichier voisin ; migration générée par `npm run db:generate` (jamais écrite à la main) ; `npm run verify` vert avant tout commit ; commits explicites, jamais `git add -A`.
- Node : `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`.

## Review Focus

- Occurrence créée à 23 h 59 (heure de Paris) puis relue à 00 h 01 : comptée dans la bonne journée.
- Occurrence au statut `brouillon` : jamais comptée dans le jour ni la semaine.
- Une instance ne voit jamais les occurrences ni les signatures d'une autre.
- Image non PNG/JPEG, trop lourde ou base64 invalide : refusée avec un message clair.
- Nom de signature en doublon ou vide : refusé ; suppression de la signature par défaut : plus aucune par défaut.
- Instance sans aucune donnée : accueil et panneau du Brief s'affichent avec des zéros, sans erreur.

## File Structure

- Create `src/prospection/schema.ts` : tables `prospectionOccurrences`, `prospectionSignatures`, `prospectionReglages`.
- Create `src/prospection/stats.ts` : `statsProspection`.
- Create `src/prospection/signatures.ts` : CRUD des signatures et de l'objectif.
- Create `src/prospection/routes.ts` : `registerProspectionRoutes`.
- Modify `src/app.ts` (enregistrement), `src/db/metier-tables.ts` si le registre des tables métier l'exige (vérifier par `isolation.test.ts`), `drizzle/` (migration générée).
- Create `web/src/pages/Prospection.tsx` (+ test), `web/src/pages/parametres/ProspectionReglages.tsx` (+ test).
- Modify `web/src/api.ts`, `web/src/nav.ts` (`BUILT`), `web/src/App.tsx`, `web/src/pages/Parametres.tsx` (onglet), `web/src/pages/Brief.tsx` (panneau).

---

### Task 1: Schéma, migration et statistiques

**Files:** Create `src/prospection/schema.ts`, `src/prospection/stats.ts`, test `src/prospection/stats.test.ts` ; generate migration ; modify `src/db/metier-tables.ts` si nécessaire.

**Interfaces:**
- Produces (schema.ts) : `ETATS_OCCURRENCE = ['brouillon','envoye','reponse','rdv'] as const` ; `prospectionOccurrences` (colonnes : `id uuid`, `metierColumns()`, `mode text enum ['relance','froid']`, `contactId uuid null → contacts`, `contactNom text not null`, `societe text null`, `theme text not null`, `touche integer not null default 1`, `etat text enum ETATS_OCCURRENCE`, `threadId text null`, `envoyeAt timestamptz null`, `lot text null`) ; `prospectionSignatures` (`id`, `metierColumns()`, `nom text not null`, `defaut boolean default false`, `typeMime text not null`, `image text not null` (base64), unique `(instanceId, nom)`) ; `prospectionReglages` (`instanceId uuid pk → instances`, `objectifJour integer not null default 30`, RLS comme les autres).
- Produces (stats.ts) : `statsProspection(tx: Executor, maintenant?: Date): Promise<StatsProspection>` avec `StatsProspection = { jour: number; objectif: number; semaine: number; reponses: number; rdv: number; parTheme: Record<string, number>; parTouche: Record<string, number>; relancesFaites: number; relancesRestantes: number; aConfirmer: number }` (`aConfirmer` vaut 0 jusqu'à la livraison 3 ; `relancesFaites` = tâches canal `email` faites aujourd'hui ; `relancesRestantes` = tâches canal `email` non faites dont l'échéance est aujourd'hui ou avant).

- [ ] **Step 1: Write the failing test** `src/prospection/stats.test.ts` (base de test via `setupTestApp`, instance `prosp-stats`, occurrences insérées sous `withInstance`) :
  `it('compte les mails envoyés aujourd'hui, jamais les brouillons')` : 3 `envoye` datés maintenant + 2 `brouillon` → `jour === 3`.
  `it('range un mail de 23 h 59 à Paris dans son jour')` : occurrence à `2026-11-03T22:59:00Z` (23 h 59 à Paris), `maintenant = 2026-11-03T23:30:00Z` → `jour === 1` ; `maintenant = 2026-11-04T05:00:00Z` → `jour === 0`, `semaine === 1`.
  `it('calcule semaine, réponses, rendez-vous, par thème et par touche')` : 5 occurrences sur 5 jours (états `envoye`, `reponse`, `rdv`), thèmes « Test de VMA » ×3 et « Diagnostic » ×2 → `semaine === 5`, `reponses === 2` (réponse + rdv), `rdv === 1`, `parTheme`, `parTouche`.
  `it('renvoie des zéros pour une instance vide et l'objectif par défaut')` → `jour 0`, `objectif 30`.
  `it('ne voit pas les occurrences d'une autre instance')`.
- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run src/prospection/stats.test.ts`. Expected: FAIL (module absent).
- [ ] **Step 3: Implement** le schéma (motif de `src/vma/schema.ts` et `src/crm/schema.ts`, `instanceIsolation` sur chaque table), générer la migration (`npm run db:generate`, nom explicite si l'outil le permet), enregistrer les tables dans le registre métier si `isolation.test.ts` l'exige, puis `statsProspection` (agrégation SQL ou en mémoire sur les 7 derniers jours ; jour calculé par `jourDe(at)` ; objectif lu dans `prospectionReglages`, 30 si absent).
- [ ] **Step 4: Run** `npx vitest run src/prospection/stats.test.ts src/db/isolation.test.ts src/migrate.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(prospection): occurrences et statistiques du jour` (fichiers listés explicitement, y compris `drizzle/`).

### Task 2: Signatures et objectif quotidien

**Files:** Create `src/prospection/signatures.ts`, test `src/prospection/signatures.test.ts`.

**Interfaces:**
- Consumes: tables de la tâche 1.
- Produces : `listerSignatures(tx): Promise<SignatureVue[]>` (`SignatureVue = { id: string; nom: string; defaut: boolean; typeMime: string }`, sans l'image), `ajouterSignature(tx, { nom, typeMime, imageBase64 }): Promise<SignatureVue>`, `renommerSignature(tx, id, nom)`, `remplacerImage(tx, id, { typeMime, imageBase64 })`, `supprimerSignature(tx, id)`, `definirDefaut(tx, id | null)`, `imageSignature(tx, id): Promise<{ typeMime: string; octets: Buffer } | null>`, `reglerObjectif(tx, objectif: number)`, classe `SignatureInvalide extends Error`.

- [ ] **Step 1: Write the failing tests** : `ajoute une signature PNG et la liste sans l'image` ; `refuse un type autre que PNG ou JPEG` ; `refuse une image de plus de 400 Ko` ; `refuse un base64 invalide` ; `refuse un nom vide ou en doublon` ; `une seule signature par défaut : en définir une retire l'autre` ; `supprimer la signature par défaut ne laisse aucun défaut` ; `renomme et remplace l'image` ; `règle l'objectif entre 0 et 500 et refuse au-delà` ; `isolation entre instances`. Les images de test sont de petits PNG générés en mémoire (en-tête PNG de 8 octets suivi d'octets fictifs), jamais lus sur disque.
- [ ] **Step 2: Run** `npx vitest run src/prospection/signatures.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** les fonctions ci-dessus ; validation du type par les octets magiques (PNG `89 50 4E 47`, JPEG `FF D8 FF`) et pas seulement par `typeMime` ; chaque écriture appelle `logEvent` (action en français, par exemple « Signature ajoutée : <nom> »).
- [ ] **Step 4: Run** le même fichier. Expected: PASS.
- [ ] **Step 5: Commit** `feat(prospection): signatures et objectif quotidien`.

### Task 3: Routes API

**Files:** Create `src/prospection/routes.ts`, test `src/prospection/routes.test.ts` ; Modify `src/app.ts`.

**Interfaces:**
- Consumes: `statsProspection`, fonctions de signatures.
- Produces : `registerProspectionRoutes(app: FastifyInstance, deps: { db: Database }): void` avec : `GET /api/i/:slug/prospection` → `{ stats: StatsProspection; signatures: SignatureVue[]; recentes: [] }` ; `PUT /api/i/:slug/prospection/objectif` `{ objectif }` ; `POST /api/i/:slug/prospection/signatures` `{ nom, typeMime, imageBase64 }` (201) ; `PATCH …/signatures/:id` `{ nom? , defaut? }` ; `PUT …/signatures/:id/image` ; `DELETE …/signatures/:id` ; `GET …/signatures/:id/image` (octets, `Content-Type` de l'image, `Cache-Control: private`). Erreurs métier : 400 avec `{ error }` ; id inconnu : 404 ; instance inconnue : 404.

- [ ] **Step 1: Write the failing tests** (motif de `src/api/liens.routes.test.ts`, `app.inject`) : `GET renvoie des zéros et l'objectif 30 pour une instance neuve` ; `cycle complet d'une signature (création, liste, défaut, image servie avec le bon type, renommage, suppression)` ; `400 sur image invalide` ; `404 sur une signature d'une autre instance` ; `PUT objectif` accepté puis relu ; `400 au-delà de 500`.
- [ ] **Step 2: Run** `npx vitest run src/prospection/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** les routes avec zod (motif de `src/vma/routes.ts`, `getInstanceBySlug`, `withInstance`) et l'enregistrement dans `src/app.ts` après `registerVmaRoutes` ; limite de corps Fastify suffisante pour 400 Ko en base64 (≈ 540 Ko) sur ces routes.
- [ ] **Step 4: Run** `npx vitest run src/prospection`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(prospection): routes de l'API`.

### Task 4: Page Prospection et navigation

**Files:** Modify `web/src/api.ts`, `web/src/nav.ts`, `web/src/App.tsx` ; Create `web/src/pages/Prospection.tsx`, test `web/src/pages/Prospection.test.tsx` ; Modify `web/src/nav.test.ts` si besoin.

**Interfaces:**
- Produces (api.ts) : types `StatsProspection`, `SignatureProspection`, `VueProspection` ; `fetchProspection(slug): Promise<VueProspection>`, `reglerObjectifProspection(slug, objectif)`, `ajouterSignatureProspection`, `modifierSignatureProspection`, `remplacerImageSignature`, `supprimerSignatureProspection`, `urlImageSignature(slug, id): string`.
- Produces : `export function Prospection({ slug }: { slug: string })`.

- [ ] **Step 1: Write the failing test** (motif de `web/src/pages/Bases.test.tsx`, `fetch` simulé) : `affiche le compteur du jour sur l'objectif et la jauge` (14 sur 30 → texte « 14 » et « sur 30 », jauge à 47 %) ; `plafonne la jauge à 100 % et la masque quand l'objectif est 0` ; `affiche les chiffres de la semaine, par thème et par touche` ; `montre les deux cartes d'entrée marquées Bientôt, boutons désactivés` ; `affiche des zéros sans erreur pour une instance vide` ; `affiche le message d'erreur si l'API échoue`.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/Prospection.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** la page (structure et libellés de la maquette `v-prospection.js`, vue `VIEWS.prospection`, accueil seulement ; styles existants), les fonctions d'`api.ts`, `prospection` ajouté à `BUILT` et retiré de `LOTS`, le `case 'prospection'` de `App.tsx` (`key={current.slug}`).
- [ ] **Step 4: Run** `npx vitest run web/src/pages/Prospection.test.tsx web/src/nav.test.ts web/src/shell`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(prospection): page d'accueil de la prospection`.

### Task 5: Paramètres (signatures, objectif) et panneau du Brief

**Files:** Create `web/src/pages/parametres/ProspectionReglages.tsx` (+ test) ; Modify `web/src/pages/Parametres.tsx` (onglet `prospection`), `web/src/pages/Brief.tsx` (panneau), leurs tests existants si nécessaire.

**Interfaces:**
- Consumes: fonctions d'`api.ts` de la tâche 4.
- Produces : `export function ProspectionReglages({ slug }: { slug: string })` ; panneau « Prospection du jour » dans le Brief (même jauge que l'accueil : factoriser `JaugeJour` dans `web/src/pages/Prospection.tsx` et l'exporter).

- [ ] **Step 1: Write the failing tests** : `liste les signatures avec aperçu de l'image, et la signature par défaut cochée` ; `ajoute une signature (fichier PNG) et recharge la liste` ; `refuse un fichier trop lourd côté interface avec le message de l'API` ; `renomme, change le défaut, supprime après confirmation` ; `enregistre l'objectif quotidien` ; `le Brief affiche le panneau avec les mêmes chiffres que l'accueil et le lien vers Prospection` ; `le Brief n'échoue pas quand l'API prospection échoue : panneau masqué`.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/parametres web/src/pages/Brief`. Expected: FAIL.
- [ ] **Step 3: Implement** (lecture du fichier avec `FileReader` en base64 ; confirmation de suppression comme ailleurs dans l'interface ; onglet « Prospection » ajouté au sélecteur d'onglets de `Parametres.tsx`).
- [ ] **Step 4: Run** `npx vitest run web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(prospection): signatures, objectif et panneau du Brief`.

### Task 6: Vérification, revue, PR et déploiement

- [ ] **Step 1:** `npm run verify`. Expected: format, lint, types, tests et build verts.
- [ ] **Step 2:** Vérifier dans le navigateur (serveur de dev en tâche de fond suivie, arrêté ensuite) : accueil Prospection, onglet Paramètres > Prospection (ajout d'une signature de test, changement de défaut, objectif), panneau du Brief ; console sans erreur. Captures d'écran pour Marc.
- [ ] **Step 3:** Relire `git diff origin/main...HEAD` (aucune donnée réelle ni signature réelle), ouvrir la PR, faire la revue (corriger), attendre la CI verte, merger.
- [ ] **Step 4:** Reconstruire l'application et relancer le conteneur depuis `origin/main` à jour (jamais `docker compose down -v`), contrôler `/health` et l'écran Prospection ; mettre à jour `docs/plan.md`, le second cerveau (`simatis-os-structure.md`, `simatis-os-feuille-de-route.md`, `log.md`) ; expliquer à Marc, pas à pas, comment tester.
