# Liens multiples entre fiches — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter, créer et lier des personnes, affaires et organisations depuis les fiches, avec des liens multiples comme HubSpot, écrits dans HubSpot et lus depuis HubSpot.

**Architecture:** Trois tables de liaison portent les liens multiples ; les colonnes actuelles (`contact_id`, `entreprise_id`) restent le lien **principal**, donc pipeline, tâches et reste du code ne changent pas. Un service unique (`src/crm/liens.ts`) pose, retire et fixe le principal ; il écrit d'abord dans HubSpot (simulation par défaut, double verrou) puis dans l'OS. La synchronisation lit toutes les associations. L'interface ajoute « + Ajouter » sur les cartes de la fiche.

**Tech Stack:** TypeScript, Fastify, Drizzle (PostgreSQL, RLS par instance), React, Vitest (testcontainers), API HubSpot v3/v4.

**Spec:** `docs/superpowers/specs/2026-10-21-liens-multiples-design.md`

## Global Constraints

- Interface et docs en français ; identifiants techniques dans le style du fichier modifié.
- Données de test **fictives uniquement** ; aucun nom, montant ni donnée réelle dans le dépôt (dépôt public).
- Toute table métier : `instance_id` via `metierColumns()` et `instanceIsolation('<table>')` ; toute requête filtre aussi `eq(..., currentInstance)`.
- Écriture vers HubSpot : simulation par défaut, double verrou pour le réel ; jamais d'écriture réelle dans les tests ou la vérification.
- Migrations par `npm run db:generate` (drizzle-kit), jamais écrites à la main ; jamais `docker compose down -v`.
- Une affaire = un seul lien principal par relation ; unicité d'une paire par instance.
- Commit après chaque tâche, après relecture de `git diff --staged` ; fichiers ajoutés explicitement ; `npm run verify` avant commit. Node : `/opt/homebrew/opt/node@24/bin`.

## Review Focus

- Lier deux fois la même paire : pas de doublon, pas d'erreur bloquante.
- Délier le lien principal : un autre lien est promu, ou la colonne principale est vidée.
- Écriture HubSpot en simulation ou en échec : rien n'est écrit dans l'OS.
- Fiche d'une autre instance passée dans un lien : refusée (« introuvable dans cette instance »).
- Synchronisation d'une affaire HubSpot sans association, ou dont une association a disparu : liens retirés sans erreur ; lien posé dans l'OS en simulation conservé.

## Structure des fichiers

- `src/crm/schema.ts` — ajoute `affaireContacts`, `affaireEntreprises`, `contactEntreprises`.
- `src/crm/liens.ts` (nouveau) — service lier / délier / principal / lecture des liens.
- `src/connecteurs/hubspot/write.ts` — opérations `association.add`, `association.remove`.
- `src/connecteurs/hubspot/client.ts` — `allAssociations`.
- `src/connecteurs/hubspot/sync.ts` — remplit les tables de liaison.
- `src/crm/fiches.ts` — la fiche expose les liens multiples ; `portee` les utilise.
- `src/api/routes.ts` — routes de liens et création liée.
- `web/src/api.ts`, `web/src/pages/Fiche.tsx`, `web/src/pages/liens/` (nouveau) — interface.

---

### Task 1: Tables de liaison et migration

**Files:**
- Modify: `src/crm/schema.ts`
- Create: `drizzle/0033_*.sql` (générée)
- Test: `src/crm/liens.schema.test.ts`

**Interfaces:**
- Produces: tables `affaireContacts(opportuniteId, contactId, principal)`, `affaireEntreprises(opportuniteId, entrepriseId, principal)`, `contactEntreprises(contactId, entrepriseId, principal)` ; chacune avec `id`, `metierColumns()`, `principal boolean default false`, index unique `(instance_id, <a>, <b>)`, FK `onDelete: 'cascade'`.

- [ ] **Step 1: Test `liens.schema.test.ts`** (base de test via `setupTestApp`, données de démo) : (a) après migration, une affaire du seed ayant `contact_id` a une ligne `affaire_contacts` avec `principal = true` ; idem `affaire_entreprises` et `contact_entreprises` ; (b) insérer deux fois la même paire lève une violation d'unicité ; (c) supprimer l'affaire supprime ses lignes de liaison ; (d) une ligne d'une autre instance est invisible sous `withInstance`.
- [ ] **Step 2: Lancer** `npx vitest run src/crm/liens.schema.test.ts` — attendu : échec (tables absentes).
- [ ] **Step 3: Déclarer les trois tables** dans `schema.ts` dans le style de `rdvLiens`, puis `npm run db:generate`. Ajouter à la migration générée les `INSERT ... SELECT` de reprise des liens uniques existants (`principal = true`, `source = 'natif'`).
- [ ] **Step 4: Relancer** le test — attendu : PASS ; lancer aussi `npx vitest run src/migrate.test.ts`.
- [ ] **Step 5: Commit** `feat: tables de liaison des liens multiples`.

### Task 2: Écritures HubSpot d'association

**Files:**
- Modify: `src/connecteurs/hubspot/write.ts`
- Test: `src/connecteurs/hubspot/hubspot.test.ts` (ou `write` existant selon l'endroit où `deal.associer` est testé)

**Interfaces:**
- Produces: opérations `association.add` et `association.remove` avec `data: { de: 'affaire'|'contact', deId: string, vers: 'contact'|'entreprise', versId: string }` (identifiants **locaux**, résolus par `hubspotId`).

- [ ] **Step 1: Tests** (client HubSpot simulé, comme les tests de `deal.associer`) : `association.add` affaire→contact appelle `PUT /crm/v4/objects/deals/{id}/associations/default/contacts/{id}` ; `association.remove` appelle `DELETE /crm/v4/objects/deals/{id}/associations/contacts/{id}` ; contact→entreprise utilise `contacts`→`companies` ; une fiche non HubSpot lève `EcritureRefusee("Cette fiche n'existe pas dans HubSpot")` ; CRM en lecture seule lève `EcritureRefusee`.
- [ ] **Step 2: Lancer** — attendu : échec (opération inconnue).
- [ ] **Step 3: Ajouter les deux `case`** dans `writeHubspot` en réutilisant `associer` et `hubspotId` ; table HubSpot déduite de `de`/`vers` (`affaire`→`deals`, `contact`→`contacts`, `entreprise`→`companies`). Ajouter les deux opérations à la liste des opérations connues du connecteur (là où `deal.associer` est déclaré, chercher par `grep -rn "deal.associer" src`).
- [ ] **Step 4: Relancer** — attendu : PASS.
- [ ] **Step 5: Commit** `feat: écriture HubSpot des associations`.

### Task 3: Service de liens

**Files:**
- Create: `src/crm/liens.ts`
- Test: `src/crm/liens.test.ts`

**Interfaces:**
- Consumes: tables de la Task 1, `ecrireHubspot`-équivalent (`writeVia(tx, instance, 'crm', { op, data }, deps)`), `CrmIndisponible`, `FicheInvalide`, `logEvent`.
- Produces:
  - `type Ref = { kind: Kind; id: string }` (`Kind` de `fiches.ts`)
  - `lierFiches(db: Executor, instance: Instance, a: Ref, b: Ref, deps: ConnexionDeps): Promise<{ ok: true } | SimulationFiche>`
  - `delierFiches(db, instance, a: Ref, b: Ref, deps): Promise<{ ok: true } | SimulationFiche>`
  - `definirPrincipal(db, instance, a: Ref, b: Ref, deps): Promise<{ ok: true } | SimulationFiche>`
  - `lireLiens(tx: Tx, kind: Kind, id: string): Promise<{ contacts: LienFiche[]; entreprises: LienFiche[]; affaires: LienFiche[] }>` avec `LienFiche = { id: string; nom: string; principal: boolean; etape?: string; clos?: string | null; montant?: number | null }`
  - Seules les paires affaire–contact, affaire–entreprise, contact–entreprise sont valides (ordre libre) ; toute autre lève `FicheInvalide('Lien impossible')`.

- [ ] **Step 1: Tests** (instance démo `simatis`, `deps = { secretsDir: '/nonexistent', realWrites: false }`) : 
  - lier affaire–contact crée la ligne ; le premier lien d'une affaire devient principal et remplit `opportunites.contact_id` ; un second lien reste non principal ;
  - lier deux fois la même paire ne crée pas de doublon ;
  - `definirPrincipal` change `principal` et `contact_id` ;
  - `delierFiches` du principal promeut l'autre lien ; du dernier lien vide `contact_id` ;
  - paire invalide (contact–contact) → `FicheInvalide` ; fiche d'une autre instance (`helioval`) → `FicheInvalide('... introuvable dans cette instance')` ;
  - instance avec CRM HubSpot en `deux_sens` et écritures réelles désactivées : retourne `{ simulation: true, ... }` et **aucune** ligne n'est écrite ; échec HubSpot → `CrmIndisponible`, rien d'écrit ; CRM `lecture` → `CrmIndisponible`.
- [ ] **Step 2: Lancer** `npx vitest run src/crm/liens.test.ts` — attendu : échec.
- [ ] **Step 3: Implémenter** les quatre fonctions dans `withInstance(db, instance.id, …)` : valider la paire et l'appartenance à l'instance ; si l'une des deux fiches est de source `hubspot` et que la connexion CRM est HubSpot, appeler `writeVia` avec `association.add` / `association.remove` / (principal : `association.add`, seule façon de marquer l'association par défaut) et retourner la simulation sans rien écrire ; sinon écrire. Après chaque écriture, resynchroniser la colonne principale de la fiche source et appeler `logEvent` (`niveau: 'L2'`, texte sans donnée sensible).
- [ ] **Step 4: Relancer** — attendu : PASS.
- [ ] **Step 5: Commit** `feat: service de liens entre fiches`.

### Task 4: Synchronisation de toutes les associations

**Files:**
- Modify: `src/connecteurs/hubspot/client.ts`, `src/connecteurs/hubspot/sync.ts`
- Test: `src/connecteurs/hubspot/client.test.ts`, `src/connecteurs/hubspot/hubspot.test.ts`

**Interfaces:**
- Consumes: tables de la Task 1.
- Produces: `client.allAssociations(from: string, to: string, ids: string[]): Promise<Map<string, string[]>>` (même appel batch que `firstAssociations`, sans ne garder que le premier ; le premier de la liste reste le principal).

- [ ] **Step 1: Tests** : `allAssociations` renvoie tous les identifiants par source ; la synchronisation d'une affaire avec 2 contacts et 2 organisations crée 2 lignes de chaque, avec `principal` sur le premier, et `contact_id` / `entreprise_id` égaux au premier ; une association disparue côté HubSpot retire la ligne et, si c'était le principal, promeut le suivant ; une affaire sans association n'a aucun lien ; une ligne `source = 'natif'` (posée dans l'OS en simulation) est conservée ; idem pour contact→entreprise (`associatedcompanyid` reste le principal).
- [ ] **Step 2: Lancer** — attendu : échec.
- [ ] **Step 3: Implémenter** `allAssociations` à côté de `firstAssociations` (réutiliser la boucle par paquets de 1000). Dans `sync.ts`, après les `upsert` des affaires et des contacts, remplacer les liens `source = 'hubspot'` de chaque fiche lue par ceux de HubSpot (suppression des absents, insertion des nouveaux, `onConflictDoNothing` sur l'unicité), sans toucher aux lignes `source = 'natif'`.
- [ ] **Step 4: Relancer** — attendu : PASS.
- [ ] **Step 5: Commit** `feat: synchronisation de tous les liens HubSpot`.

### Task 5: La fiche expose les liens multiples

**Files:**
- Modify: `src/crm/fiches.ts` (type `Fiche['liens']`, `lire`, `portee`)
- Test: `src/crm/fiches.test.ts`

**Interfaces:**
- Consumes: `lireLiens` (Task 3).
- Produces: `Fiche['liens']` garde `entreprise`, `contact` (principaux) et gagne `contacts?: LienFiche[]` (affaire, entreprise), `entreprises?: LienFiche[]` (affaire, contact), `affaires?: LienFiche[]` (contact, entreprise), chacun avec `principal`.

- [ ] **Step 1: Tests** : une affaire à 2 personnes et 2 organisations les liste toutes avec le bon `principal` ; la fiche d'une organisation liste les personnes et affaires liées via les tables de liaison (pas seulement via les colonnes) ; l'historique et les tâches d'une organisation incluent ceux de ses affaires liées par table de liaison.
- [ ] **Step 2: Lancer** — attendu : échec.
- [ ] **Step 3: Remplacer** les requêtes ad hoc de `lire` et `portee` par `lireLiens` (les colonnes principales sont déjà reflétées dans les tables après la migration et le service, donc un seul chemin suffit).
- [ ] **Step 4: Relancer** `npx vitest run src/crm` — attendu : PASS (les tests existants de fiches restent verts).
- [ ] **Step 5: Commit** `feat: fiches avec liens multiples`.

### Task 6: Routes API

**Files:**
- Modify: `src/api/routes.ts`
- Test: `src/api/liens.routes.test.ts` (style des tests de routes existants, `grep -ln "fiches/" src/api/*.test.ts`)

**Interfaces:**
- Consumes: `lierFiches`, `delierFiches`, `definirPrincipal`.
- Produces (corps `{ avec: { kind: Kind, id: string } }`, `FicheRoute` existant) :
  - `POST /api/i/:slug/fiches/:kind/:id/liens` → lier
  - `DELETE /api/i/:slug/fiches/:kind/:id/liens` → délier
  - `PUT /api/i/:slug/fiches/:kind/:id/liens/principal` → principal
  - Réponses : `{ ok: true }` ou `{ simulation: true, message }` ; `400` (`FicheInvalide`), `409` (`CrmIndisponible`), `404` fiche inconnue.
  - Création liée : les schémas de création existants de personne (`contactSchema`), d'affaire (`/opportunites`) et d'organisation acceptent `lierA?: { kind: Kind, id: string }` ; la fiche créée est liée à cette fiche juste après sa création.

- [ ] **Step 1: Tests** : lier / délier / principal bons cas ; `kind` invalide → 404 ; corps invalide → 400 ; CRM lecture seule → 409 ; création d'une personne avec `lierA` d'une organisation la crée **et** la lie ; en simulation HubSpot la création renvoie la simulation et rien n'est créé.
- [ ] **Step 2: Lancer** — attendu : échec.
- [ ] **Step 3: Ajouter** les trois routes dans le groupe des routes de fiches avec `ficheErreur`, et le champ `lierA` aux trois créations (appel de `lierFiches` après `createContact` / création d'affaire / `createEntreprise`).
- [ ] **Step 4: Relancer** — attendu : PASS.
- [ ] **Step 5: Commit** `feat: routes de liens entre fiches`.

### Task 7: Interface — cartes avec « + Ajouter »

**Files:**
- Create: `web/src/pages/liens/CarteLiens.tsx`, `web/src/pages/liens/AjouterLien.tsx`
- Modify: `web/src/api.ts` (types `LienFiche`, `FicheDetail.liens`, `lierFiche`, `delierFiche`, `definirPrincipal`, `lierA` sur les créations), `web/src/pages/Fiche.tsx`, `web/src/pages/Contacts.tsx` (`NouveauContact`), `web/src/pages/Pipeline.tsx` (`NouvelleAffaire`), `web/src/pages/Entreprises.tsx` (modal d'organisation), `web/src/styles.css`
- Test: `web/src/pages/liens/CarteLiens.test.tsx`, `web/src/pages/Fiche.test.tsx`

**Interfaces:**
- `CarteLiens({ slug, titre, kind, liens, ecrit, source, onAjouter, onDelier, onPrincipal })` : liste (nom cliquable, badge « Principal », croix « Délier », étoile « Définir comme principal »), titre `Personnes (n)` / `Affaires (n)` / `Organisations (n)`.
- `AjouterLien({ slug, de: Ref, kind, onFait })` : menu « + Ajouter » avec « Créer » (ouvre le modal de création existant avec `lierA = de`) et « Lier une fiche existante » (recherche réutilisant `fetchContacts` / `fetchEntreprises` / recherche d'affaires `opportunites/recherche`). Texte du menu lisible (couleur explicite : leçon du menu « Nouveau » blanc sur blanc).

- [ ] **Step 1: Tests** (Testing Library, API simulée) : les cartes affichent les liens avec « Principal » ; « + Ajouter » > « Lier une fiche existante » appelle `lierFiche` avec la bonne paire ; « Créer » ouvre le modal et envoie `lierA` ; la croix appelle `delierFiche` ; l'étoile appelle `definirPrincipal` ; en simulation, le message de simulation s'affiche et la liste ne change pas ; boutons masqués si `ecrit` est faux ; fiche d'organisation à 0 liens : cartes `Personnes (0)` et `Affaires (0)` avec « + Ajouter ».
- [ ] **Step 2: Lancer** `npx vitest run web/src/pages/liens web/src/pages/Fiche.test.tsx` — attendu : échec.
- [ ] **Step 3: Implémenter** les composants et remplacer dans `Fiche.tsx` les cartes « Personnes » / « Affaires » (et la ligne `LienEditable` de l'affaire) par `CarteLiens` pour les trois types de fiche : affaire (Personnes, Organisations), personne (Organisations, Affaires), organisation (Personnes, Affaires). Style dans `styles.css` au même niveau que `fi-liste`.
- [ ] **Step 4: Relancer** — attendu : PASS.
- [ ] **Step 5: Commit** `feat: ajout et liaison de fiches depuis les fiches`.

### Task 8: Vérification complète, navigateur et livraison

**Files:** aucun nouveau code attendu ; correctifs éventuels.

- [ ] **Step 1:** `npm run verify` — attendu : tout vert.
- [ ] **Step 2:** Vérifier dans le navigateur (serveur de dev lancé par `preview_start`, données de démo) : sur une organisation, créer une personne et une affaire depuis « + Ajouter » ; lier une personne existante ; fixer un principal ; délier ; ouvrir le **pipeline** et constater que l'affaire créée est dans la colonne de son étape ; capturer les écrans.
- [ ] **Step 3:** Ouvrir la PR, relire le diff soi-même (corriger), attendre la CI verte, merger, puis reconstruire l'app et relancer le conteneur depuis `origin/main`.
- [ ] **Step 4:** Expliquer à Marc, pas à pas et simplement, comment tester ; signaler que les liens vers HubSpot restent en simulation tant que le mode réel n'est pas activé.

## Points ouverts

- Types d'association HubSpot : la dissociation utilise `DELETE .../associations/{to}/{id}` et le principal l'association « par défaut ». À confirmer dans la documentation HubSpot pendant la Task 2, sans écriture réelle.
