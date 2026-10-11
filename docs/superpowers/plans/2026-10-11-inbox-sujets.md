# Inbox, livraison 1 : sujets et écran Inbox — plan d'implémentation

> **Pour les agents :** sous-skill requise : superpowers:executing-plans (ou
> superpowers:subagent-driven-development). Les étapes utilisent des cases `- [ ]`.

**Objectif :** remplacer l'écran « À valider » par l'Inbox : une table `sujets` par instance,
un service, une API, un écran liste + détail, le lien avec les propositions, la reprise des
propositions en attente et des sujets fictifs de démo.

**Architecture :** nouveau module `src/inbox/` (schéma, dépôt, service). Les propositions
`proposee` créent un sujet `a_valider` dans la même transaction ; la décision le passe à
`traite`. « Mon activité » lit en plus les mandats actifs, chacun dans son propre
`withInstance` ; toute action passe par l'URL de l'instance du sujet (`/api/i/<slug du sujet>/…`),
donc le cloisonnement et le contrôle des écritures restent ceux du mandat.

**Tech :** Fastify, Drizzle (Postgres + RLS), zod, React 19, Vitest + Testing Library.

**Spec :** `docs/superpowers/specs/2026-10-11-inbox-design.md` (sections 1, 2, 4).

## Contraintes globales

- Types : `mail_a_repondre`, `devis`, `diagnostic`, `compte_rendu`, `brouillon_non_envoye`, `a_valider`, `autre`.
- Origines : `messagerie`, `agenda`, `cerveau`, `os`. Statuts : `a_traiter`, `tache`, `traite`.
- Pas de doublon : index unique `(instance_id, source, source_id)` ; un dépôt dont la clé existe ne crée rien, quel que soit le statut.
- Cocher ne supprime rien. Une proposition appliquée directement (L3) ne crée pas de sujet.
- Vue d'ensemble (instance `propre`) : ses sujets + mandats `type = 'mandat'`, `statut = 'actif'`, toutes phases. Jamais les démos (`prospect`) ni les archivés.
- Libellés d'interface exacts : menu « Inbox » (groupe Pilotage, icône `inbox`) ; filtres « Tout · Mails · Devis · Diagnostics · Comptes rendus · À valider · Traités » ; boutons « Ouvrir la source », « Transformer en tâche », « Marquer comme traité », « Remettre à traiter » ; filtre « Mandat ».
- Données de démo et de test fictives uniquement (dépôt public).
- Node : préfixer `PATH=/opt/homebrew/opt/node@24/bin:$PATH`.

## Review Focus

- Double clic sur « Transformer en tâche » : la seconde demande doit être refusée (409), pas créer une seconde tâche → test tâche 3.
- Transformer en simulation (HubSpot branché, écritures réelles coupées) : le sujet reste `a_traiter` et le message de simulation s'affiche → tests tâches 3 et 6.
- Action envoyée sur le mauvais slug (sujet d'un mandat, URL de « Mon activité ») ou sur un mandat archivé : 404, jamais d'écriture ailleurs → test tâche 4.
- Proposition dont l'application échoue (`echec`) : son sujet passe quand même à `traite` → test tâche 2.
- Contact ou entreprise d'une autre instance au dépôt : refusé → test tâche 1.

---

## Fichiers

- Créer `src/inbox/schema.ts` (table), `src/inbox/depot.ts` (dépôt + sujets de propositions, sans dépendance vers `propositions/service`), `src/inbox/service.ts` (liste, compteur, actions), tests `src/inbox/*.test.ts`.
- Modifier `src/db/metier-tables.ts`, `src/propositions/service.ts`, `src/pilotage/validations.ts`, `src/crm/taches.ts` (exporter `crmHubspot`), `src/api/routes.ts`, `src/demo/seed.ts`, `src/demo/fixtures.json`.
- Migration `drizzle/0017_sujets.sql` (générée) + reprise des propositions.
- Front : `web/src/nav.ts`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/pages/taches/Edition.tsx`, créer `web/src/pages/Inbox.tsx` et `web/src/pages/inbox/Proposition.tsx` (détail repris d'`AValider.tsx`, qui est supprimé), `web/src/styles.css` si besoin, test `web/src/pages/Inbox.test.tsx`. Libellés « À valider » restants dans `Devis.tsx`, `RendezVous.tsx`, `Routines.tsx`, `Conversion.test.tsx`, `outils-mcp.ts` (description) → « l'Inbox ».

---

### Tâche 1 : table `sujets`, migration, dépôt

**Interfaces produites (`src/inbox/schema.ts`, `src/inbox/depot.ts`) :**

```ts
export const TYPES_SUJET = ['mail_a_repondre','devis','diagnostic','compte_rendu','brouillon_non_envoye','a_valider','autre'] as const;
export const ORIGINES_SUJET = ['messagerie','agenda','cerveau','os'] as const;
export const sujets = pgTable('sujets', { id, ...metierColumns(), type, titre, resume, origine, lien,
  echeance (timestamptz), contactId → contacts, entrepriseId → entreprises, propositionId → propositions,
  statut (défaut 'a_traiter'), tacheId → taches, traiteAt, traitePar, reporteAt },
  index (instance_id, statut), uniqueIndex 'sujets_source_idx' (instance_id, source, source_id), instanceIsolation('sujets'));
export type Sujet = typeof sujets.$inferSelect;

export type DepotSujet = { type; titre: string; resume?: string|null; origine; source: string; sourceId: string;
  lien?: string|null; echeance?: Date|null; contactId?: string|null; entrepriseId?: string|null; propositionId?: string|null };
export class SujetInvalide extends Error {}
export async function deposerSujet(tx: Tx, d: DepotSujet): Promise<{ statut: 'cree' | 'existant'; id: string }>;
export const titreProposition = (p: Pick<Proposition,'type'|'contenu'>) => string; // objet, titre, « Transmettre le devis N », sinon type
export async function sujetPourProposition(tx: Tx, p: Proposition): Promise<void>; // source 'os', sourceId p.id, type a_valider, origine os, contactId = contenu.contactId
export async function cloreSujetProposition(tx: Tx, propositionId: string, par: string): Promise<void>; // a_traiter → traite
```

`deposerSujet` vérifie que `contactId`/`entrepriseId` existent dans l'instance courante (même garde que `createTache`), insère avec `onConflictDoNothing` sur l'index source, puis relit l'id existant. `sujets` va en tête de `METIER_TABLES` (enfant de propositions et tâches).

- [ ] **Étape 1 : tests qui échouent** — `src/inbox/depot.test.ts` (`setupTestApp`, deux mandats `a`, `b`) :
  - `deposits a subject and returns cree, then existant for the same key` ;
  - `never recreates a subject whose key exists, even once it is traite` (passer à `traite` par SQL owner, redéposer → `existant`, 1 ligne) ;
  - `accepts the same key in two instances` ;
  - `refuses a contact of another instance` → `SujetInvalide` ;
  - `does not show a subject of another instance` (lecture dans `b` → 0 ligne).
- [ ] **Étape 2 :** `npx vitest run src/inbox` → échec (module absent).
- [ ] **Étape 3 :** écrire schéma + dépôt, ajouter à `METIER_TABLES`, `npx drizzle-kit generate --name sujets`, puis ajouter à la fin de `drizzle/0017_sujets.sql` la reprise :
  ```sql
  --> statement-breakpoint
  -- Pending proposals become "à valider" subjects of the Inbox.
  INSERT INTO "sujets" ("instance_id","source","source_id","type","titre","origine","contact_id","proposition_id","created_at")
  SELECT p."instance_id", 'os', p."id"::text, 'a_valider',
    coalesce(p."contenu"->>'objet', p."contenu"->>'titre', 'Transmettre le devis ' || (p."contenu"->>'numero'), p."type"),
    'os', c."id", p."id", p."created_at"
  FROM "propositions" p
  LEFT JOIN "contacts" c ON c."id"::text = p."contenu"->>'contactId' AND c."instance_id" = p."instance_id"
  WHERE p."statut" = 'proposee';
  ```
- [ ] **Étape 4 :** test de migration `src/inbox/migration.test.ts` : `migrates pending proposals into a_valider subjects` — copie de `drizzle/` dans un dossier temporaire avec `_journal.json` tronqué à `idx <= 16`, `migrate()` dessus, insertion (owner) d'une instance + une proposition `proposee` + une `ecartee`, puis `runMigrations` complet → un seul sujet `a_valider`, `source_id` = id de la proposition `proposee`, titre repris de `contenu.objet`.
- [ ] **Étape 5 :** `npx vitest run src/inbox src/db` → vert (dont `isolation.test.ts`).
- [ ] **Étape 6 :** commit `Inbox : table sujets, dépôt sans doublon, reprise des propositions`.

### Tâche 2 : lien avec les propositions

**Consomme :** `sujetPourProposition`, `cloreSujetProposition` (tâche 1).

`propose()` : après l'insertion et le journal, si `niveau !== 'L3'`, `await sujetPourProposition(tx, created)`. `decide()` : après l'écart ou après `apply()` (quel que soit le résultat, `appliquee` ou `echec`), `await cloreSujetProposition(tx, id, par)`. `seed.ts` : après chaque insertion de proposition de démo, `sujetPourProposition` (via `.returning()`).

- [ ] **Étape 1 : tests** dans `src/propositions/service.test.ts` :
  - `creates an a_valider subject with a pending proposal` (type, titre, `propositionId`) ;
  - `creates no subject for a proposal applied at once (L3)` ;
  - `marks the subject traite when the proposal is validated, rejected, or fails` (trois cas, `traitePar` = décideur).
- [ ] **Étape 2 :** lancer → échec. **Étape 3 :** implémenter. **Étape 4 :** `npx vitest run src/propositions src/pilotage src/demo` → vert.
- [ ] **Étape 5 :** commit `Inbox : une proposition en attente crée son sujet à valider`.

### Tâche 3 : service Inbox (liste, vue d'ensemble, actions)

**Interfaces produites (`src/inbox/service.ts`) :**

```ts
export type FiltreInbox = 'tout'|'mails'|'devis'|'diagnostics'|'comptes_rendus'|'a_valider'|'traites';
export type SujetVue = { id; type; titre; resume: string|null; origine; lien: string|null; echeance: string|null;
  statut; tacheId: string|null; createdAt: string; traiteAt: string|null;
  contact: {id; nom}|null; entreprise: {id; nom}|null;
  instance: { slug: string; nom: string; couleur: string|null };
  proposition: PropositionItem|null }; // élément enrichi de validations.ts pour a_valider
export class SujetRefuse extends Error {}
export function trierInbox(a: SujetVue, b: SujetVue): number;
export async function listInbox(db: Executor, instance: Instance, filtre: FiltreInbox): Promise<SujetVue[]>;
export async function compterInbox(db: Executor, instance: Instance): Promise<number>;
export async function marquerTraite(db: Executor, instance: Instance, id: string): Promise<SujetVue|null>;
export async function remettreATraiter(db: Executor, instance: Instance, id: string): Promise<SujetVue|null>;
export async function transformerEnTache(db: Executor, instance: Instance, id: string,
  saisie: Omit<Parameters<typeof createTache>[2], 'hubspot'>, deps: ConnexionDeps): Promise<SujetVue | SimulationTache | null>;
```

Choix fixés :
- Filtres : `mails` = `mail_a_repondre` + `brouillon_non_envoye` ; `devis`, `diagnostics` (= `diagnostic`), `comptes_rendus` (= `compte_rendu`), `a_valider` → un type ; tout sauf `traites` ne montre que `a_traiter` ; `traites` = `tache` + `traite`, triés par `traiteAt` décroissant. Limite 200 par instance.
- `trierInbox` : échéance croissante (les dépassées sont donc en tête), puis sans échéance par `createdAt` décroissant.
- Périmètre : `instance.type === 'propre'` → elle-même + `listInstances(db)` filtrées sur `type === 'mandat'` ; sinon elle seule. Une lecture `withInstance` par instance, puis fusion et tri.
- Propositions : extraire de `listPropositions` une fonction `enrichirPropositions(tx, rows)` réutilisée ici.
- `marquerTraite` sur un `a_valider` → `SujetRefuse('Validez ou écartez la proposition.')` ; `remettreATraiter` sur un `a_valider` → `SujetRefuse`. Statut déjà atteint → `SujetRefuse`. Introuvable → `null`.
- `transformerEnTache` : dans un `withInstance`, lit le sujet `for update` ; s'il n'est pas `a_traiter` → `SujetRefuse` ; appelle `createTache(tx, instance, { ...saisie, hubspot: (await crmHubspot(tx)) !== null }, deps)` (exporter `crmHubspot` de `taches.ts`) ; simulation → renvoyée telle quelle, sujet inchangé ; sinon `statut 'tache'`, `tacheId`, `traiteAt`, `traitePar 'pilote'`. Journal (`logEvent`) pour traité, remis, transformé.

- [ ] **Étape 1 : tests** `src/inbox/service.test.ts` (instances `simatis` propre, `m1` mandat en cours, `m2` mandat closing, `demo` prospect, `old` mandat archivé ; un sujet chacune) :
  - `orders overdue, then upcoming, then undated newest first` (`trierInbox`, pur) ;
  - `filters by type and shows treated ones under traites only` ;
  - `shows only its own subjects in a mandate` ;
  - `shows own and active mandates subjects in Mon activité, not demos nor archived` (pastille `instance.slug`) ;
  - `counts subjects to handle over the whole scope` ;
  - `marks treated and puts back, without deleting anything` ;
  - `refuses to check an a_valider subject` ;
  - `turns a subject into an OS task without CRM` (tâche créée, `tacheId`) ;
  - `turns a subject into a HubSpot task when the CRM is HubSpot` (portail factice `test/hubspot-portal.ts`, `realWrites: true`, `ecrituresReelles: true`) ;
  - `leaves the subject to handle in simulation` (`realWrites: false` → `simulation`, statut `a_traiter`) ;
  - `refuses a second transformation of the same subject` → `SujetRefuse`, une seule tâche.
- [ ] **Étape 2 :** lancer → échec. **Étape 3 :** implémenter. **Étape 4 :** `npx vitest run src/inbox src/pilotage src/crm` → vert.
- [ ] **Étape 5 :** commit `Inbox : liste, vue d'ensemble de Mon activité et actions`.

### Tâche 4 : API

**Consomme :** service de la tâche 3. Routes dans `registerApi`, sur le modèle des tâches :

| Route | Effet |
| --- | --- |
| `GET /api/i/:slug/inbox?filtre=` | `listInbox` (filtre inconnu → `tout`) |
| `GET /api/i/:slug/inbox/compteur` | `{ n }` |
| `POST /api/i/:slug/sujets/:id/traite` | `marquerTraite` |
| `POST /api/i/:slug/sujets/:id/a-traiter` | `remettreATraiter` |
| `POST /api/i/:slug/sujets/:id/tache` | corps = `tacheSchema` sans `hubspot` ; 201, ou 202 en simulation |

Erreurs : id non UUID ou introuvable → 404 ; `SujetRefuse`, `CrmIndisponible` → 409 ; `TacheInvalide` → 400 ; corps invalide → 400.

- [ ] **Étape 1 : tests** `src/inbox/api.test.ts` (`buildApp` + `seedDemoIfEmpty` comme `pilotage.test.ts`) :
  - `lists the overview of simatis with helioval subjects and no demo subject` ;
  - `acts on a mandate subject through the mandate slug, 404 through simatis` ;
  - `returns 404 for a subject of an archived mandate` ;
  - `validating a proposition removes its subject from the list` (décision via la route existante) ;
  - `rejects an invalid task body with 400`.
- [ ] **Étape 2–4 :** échec, implémentation, `npx vitest run src/inbox src/api` → vert.
- [ ] **Étape 5 :** commit `Inbox : API`.

### Tâche 5 : démo

`fixtures.json` : clé `sujets` sur chaque fixture (tableau vide sauf `demo` et `helioval`). Élément : `{ cle, type, titre, resume, origine, lien, echeanceJours, contact, entreprise }` (refs des fixtures). `demo` : un sujet par type sauf `a_valider` (6, dont un en retard) ; `helioval` : deux (`mail_a_repondre`, `compte_rendu`). Textes fictifs. `loadDemoData` les dépose avec `source 'demo'`, `sourceId` = `cle`, échéance via `parisDay`.

- [ ] **Étape 1 : test** dans `src/demo/service.test.ts` : `seeds one subject per type in the demo, plus a_valider ones from its proposals`.
- [ ] **Étape 2–4 :** échec, implémentation, vert.
- [ ] **Étape 5 :** commit `Inbox : sujets fictifs de démonstration`.

### Tâche 6 : écran Inbox

**Consomme :** API de la tâche 4. `web/src/api.ts` : types `SujetVue`, `fetchInbox(slug, filtre)`, `fetchCompteurInbox(slug)`, `marquerSujetTraite(slug, id)`, `remettreSujet(slug, id)`, `sujetEnTache(slug, id, saisie: TacheSaisie)`.

- `nav.ts` : `item('inbox', 'Inbox', 'inbox')` à la place de `validations` (menu et `BUILT`).
- `App.tsx` : `readHash` transforme la vue `validations` en `inbox` (et `history.replaceState` du hash) ; compteurs `{ taches, inbox }` ; `Inbox` reçoit `onChange` qui recharge les compteurs.
- `EditionTache` : prop facultative `initial?: { titre: string; echeance: string | null; contact: { id: string; nom: string } | null }` qui préremplit intitulé, date et personne.
- `Inbox.tsx` (classes `vq`, `vq-list`, `vq-item` existantes) : chips de filtre ; en vue d'ensemble (sujets de plusieurs slugs), chip « Mandat » : un `<select aria-label="Mandat">` « Tous » + noms des instances présentes. Ligne : case à cocher (`aria-label="Marquer comme traité"`, absente pour `a_valider`), icône du type, titre, contact ou entreprise, échéance (classe `red` si dépassée), date d'arrivée, pastille d'instance si `instance.slug !== slug`. Détail : `a_valider` → `<PropositionDetail>` (repris d'`AValider`, décision envoyée au slug du sujet) ; sinon résumé, « Ouvrir la source » (`<a target="_blank" rel="noreferrer">`, si `lien`), « Transformer en tâche » (ouvre `EditionTache` avec `initial`, `hubspot={false}`), « Marquer comme traité » ; sous « Traités » : lien « Voir la tâche » (`#/<slug>/taches`) si `tacheId`, et « Remettre à traiter ». Simulation → message affiché, liste rechargée.
- Remplacer les mentions « À valider » des écrans par « l'Inbox ».

- [ ] **Étape 1 : tests** `web/src/pages/Inbox.test.tsx` (fetch simulé, comme `Taches.test.tsx`) :
  - `filters by type chips` (« Mails » appelle `filtre=mails`) ;
  - `keeps the order given by the server and marks overdue due dates in red` ;
  - `checks a subject and reloads` (POST `…/sujets/s1/traite`) ;
  - `sends the action to the subject instance slug in the overview` (sujet de `helioval` vu depuis `simatis` → POST `/api/i/helioval/…`) ;
  - `opens the task window prefilled and posts to sujets/:id/tache` ;
  - `shows the simulation message and keeps the subject` ;
  - `filters the overview by mandate` ;
  - `shows the proposal detail with its decision buttons for a_valider` ;
  - dans `nav.test.ts` : `has Inbox in Pilotage instead of À valider` ; test App/hash : `redirects #/x/validations to inbox` (dans `Inbox.test.tsx` ou `nav.test.ts` selon où vit `readHash` : l'exporter).
- [ ] **Étape 2–4 :** échec, implémentation, `npx vitest run web` → vert.
- [ ] **Étape 5 :** `npm run verify` complet → vert.
- [ ] **Étape 6 :** contrôle navigateur (base de démo) : Inbox de SIMATIS (vue d'ensemble, pastilles, filtre Mandat), Démo, cocher, remettre, transformer en tâche, valider une proposition, compteur du menu, ancienne URL `validations`. Capture.
- [ ] **Étape 7 :** commit `Inbox : écran à la place de À valider`, PR, revue, CI verte, merge.
