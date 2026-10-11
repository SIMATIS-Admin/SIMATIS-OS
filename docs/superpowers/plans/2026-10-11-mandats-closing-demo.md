# Trois sortes de mandats (livraison 0 de l'Inbox) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** distinguer Démo, mandat en Closing et mandat en cours, et créer (ou lier) un mandat
depuis une affaire de « Mon activité ».

**Architecture:** un mandat en Closing est une instance `mandat` avec `config.phase =
'closing'` ; sans phase, il est en cours. Le type `prospect` garde son nom technique et
s'affiche « Démo ». Le lien affaire ↔ mandat vit dans `config.origine` du mandat (la table
`instances` n'est pas cloisonnée, on peut donc chercher le mandat lié à une affaire).

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres), Zod, React (Vite), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-inbox-design.md`, section 0.

## Global Constraints

- Dépôt public : uniquement des noms fictifs dans le code, les tests et les commits.
- Interface en français ; libellés exacts : « Mandats en cours », « Mandats en Closing »,
  « Démos », « Mandat en Closing », « Mandat en cours », « Démo », « Créer le mandat »,
  « Lier à un mandat existant ».
- Ordre du menu des instances : Mon activité · Mandats en cours · Mandats en Closing · Démos.
- Un mandat sans `config.phase` est en cours : aucune migration de données.
- Changer de phase n'efface rien et s'inscrit au journal (`acteur: 'pilote'`, `niveau: 'L2'`).
- La copie depuis une affaire ne recopie que l'entreprise et ses contacts (`source =
  'simatis'`, `sourceId` = id d'origine), jamais les devis ; aucune synchronisation ensuite.
- Une affaire est liée à un mandat au plus.
- `npm run verify` vert avant chaque commit ; contrôle dans le navigateur à la fin.

## Review Focus

- Affaire sans entreprise : « Créer le mandat » doit refuser clairement (409, message
  « L'affaire n'a pas d'entreprise ») plutôt que créer un mandat vide. → test Task 3.
- Deux clics sur « Créer le mandat » : la seconde demande doit renvoyer 409 « Affaire déjà
  liée au mandat … », jamais créer un second mandat. → test Task 3.
- Nom d'entreprise déjà pris comme slug (deux entreprises « Alpha ») : slug suffixé `-2`,
  comme pour les démos. → test Task 3.
- Lier à une instance qui n'est pas un mandat actif (démo, Mon activité, archivée, slug
  inconnu) : 409, rien n'est modifié. → test Task 3.
- Création ou liaison demandée depuis une instance autre que « Mon activité » : 409. → test
  Task 3.

---

### Task 1: Phase d'un mandat (serveur, ligne de commande, API)

**Files:**
- Modify: `src/instances/schema.ts` (type `InstanceConfig`)
- Modify: `src/instances/service.ts` (nouvelle fonction `setPhase`)
- Modify: `src/admin/cli.ts` (option `--phase`, commande `instance:phase`, aide)
- Modify: `src/api/routes.ts` (`summary` renvoie `phase` ; route `PUT /api/i/:slug/phase`)
- Test: `src/admin/cli.test.ts`, `src/api/routes.test.ts`

**Interfaces:**
- Produces:
  - `InstanceConfig.phase?: 'closing' | 'en_cours'`
  - `InstanceConfig.origine?: { opportuniteId: string; entrepriseId: string | null }`
  - `export type Phase = 'closing' | 'en_cours'` et `phaseOf(i: Instance): Phase | null`
    (null si `i.type !== 'mandat'`, sinon `i.config.phase ?? 'en_cours'`) dans
    `src/instances/service.ts`
  - `setPhase(db: Executor, slug: string, phase: Phase): Promise<Instance>` : refuse
    (`Error('Seul un mandat a une phase.')`) si l'instance n'est pas un `mandat` ; journal
    « Mandat passé en Closing » / « Mandat passé en cours ».
  - `summary(i)` ajoute `phase: phaseOf(i)` ; l'API `GET /api/instances` et
    `GET /api/i/:slug/instance` le renvoient donc.
  - `PUT /api/i/:slug/phase` corps `{ phase: 'closing' | 'en_cours' }` → `summary`, 400 si
    corps invalide, 409 si l'instance n'est pas un mandat.
  - CLI : `instance:create … --type mandat --phase closing` ; `instance:phase --slug <slug>
    --phase closing|en_cours`.

- [ ] **Step 1: Write the failing tests**

Dans `src/admin/cli.test.ts` :

```ts
it('creates a mandate in closing and changes its phase', async () => {
  expect(
    await run('instance:create', '--slug', 'gamma', '--nom', 'Gamma', '--type', 'mandat', '--phase', 'closing'),
  ).toBe(0);
  expect((await getInstanceBySlug(t.owner.db, 'gamma'))?.config.phase).toBe('closing');
  expect(await run('instance:phase', '--slug', 'gamma', '--phase', 'en_cours')).toBe(0);
  expect((await getInstanceBySlug(t.owner.db, 'gamma'))?.config.phase).toBe('en_cours');
  expect(await run('instance:phase', '--slug', 'gamma', '--phase', 'signe')).toBe(1);
});
```

Dans `src/api/routes.test.ts` (fixtures de test : un mandat et une démo existent déjà, sinon
les créer avec `createInstance`) :

```ts
it('lists the phase of each instance and changes a mandate phase', async () => {
  const list = (await app.inject('/api/instances')).json();
  expect(list.find((i) => i.type === 'mandat').phase).toBe('en_cours');
  expect(list.find((i) => i.type === 'prospect').phase).toBeNull();
  const res = await app.inject({ method: 'PUT', url: `/api/i/${mandat}/phase`, payload: { phase: 'closing' } });
  expect(res.json()).toMatchObject({ phase: 'closing' });
  const demo = await app.inject({ method: 'PUT', url: `/api/i/${prospect}/phase`, payload: { phase: 'closing' } });
  expect(demo.statusCode).toBe(409);
  const bad = await app.inject({ method: 'PUT', url: `/api/i/${mandat}/phase`, payload: { phase: 'x' } });
  expect(bad.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/admin/cli.test.ts src/api/routes.test.ts`
Expected: FAIL (`--phase` inconnu, `phase` absent, route 404).

- [ ] **Step 3: Implement** `Phase`, `phaseOf`, `setPhase`, l'option CLI (création :
  `config: { phase }` seulement si `--phase` est fourni et le type est `mandat`, sinon
  erreur), la commande `instance:phase`, `summary.phase` et la route `PUT`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/admin/cli.test.ts src/api/routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/instances/schema.ts src/instances/service.ts src/admin/cli.ts src/api/routes.ts src/admin/cli.test.ts src/api/routes.test.ts
git commit -m "Mandats : phase Closing / en cours (serveur, CLI, API)"
```

### Task 2: Menu, libellés et choix de la phase dans l'interface

**Files:**
- Modify: `web/src/nav.ts` (`InstanceSummary.phase`, `INSTANCE_GROUPS`, `groupInstances`)
- Modify: `web/src/api.ts` (`changerPhase`)
- Modify: `web/src/pages/Parametres.tsx` (libellés, panneau « Phase »)
- Modify: `web/src/pages/Portefeuille.tsx` (badges et textes « Démo »)
- Test: `web/src/nav.test.ts`, Create: `web/src/pages/Parametres.test.tsx`

**Interfaces:**
- Consumes: `summary.phase` et `PUT /api/i/:slug/phase` (Task 1).
- Produces:
  - `InstanceSummary.phase: 'closing' | 'en_cours' | null`
  - `INSTANCE_GROUPS` : `[['propre', 'Mon activité'], ['en_cours', 'Mandats en cours'],
    ['closing', 'Mandats en Closing'], ['prospect', 'Démos']]`, et
    `groupeOf(i: InstanceSummary)` : `'propre'`, `'prospect'`, sinon `i.phase ?? 'en_cours'`.
  - `changerPhase(slug: string, phase: 'closing' | 'en_cours'): Promise<InstanceSummary>`
  - `libelleType(i)` exporté depuis `web/src/nav.ts` : « Mon activité », « Mandat en cours »,
    « Mandat en Closing », « Démo » (utilisé par Paramètres et Portefeuille).

- [ ] **Step 1: Write the failing tests**

`web/src/nav.test.ts` :

```ts
it('groups mandates by phase and labels demos', () => {
  const g = groupInstances([
    inst({ slug: 'a', type: 'mandat', phase: 'closing' }),
    inst({ slug: 'b', type: 'mandat', phase: 'en_cours' }),
    inst({ slug: 'c', type: 'prospect', phase: null }),
    inst({ slug: 'd', type: 'propre', phase: null }),
  ]);
  expect(g.map((x) => x.label)).toEqual(['Mon activité', 'Mandats en cours', 'Mandats en Closing', 'Démos']);
  expect(libelleType(inst({ type: 'mandat', phase: 'closing' }))).toBe('Mandat en Closing');
  expect(libelleType(inst({ type: 'prospect', phase: null }))).toBe('Démo');
});
```

Test de page Paramètres : pour un mandat en cours, la ligne Type affiche « Mandat en cours »,
le panneau « Phase » propose « Closing » / « En cours » ; choisir « Closing » appelle
`PUT /api/i/<slug>/phase` avec `{ phase: 'closing' }` (fetch simulé, comme dans les autres
tests de pages).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run web/src/nav.test.ts web/src/pages/Parametres.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** `groupeOf`, `INSTANCE_GROUPS`, `libelleType`, `changerPhase`, le
  panneau « Phase » de Paramètres (affiché seulement pour un `mandat` ; texte : « Passer en
  cours à la signature n'efface rien. »), et remplacer « Mandat prospect » par « Démo »
  dans Parametres et Portefeuille (titre « Nouvelle démo », bouton inchangé sinon).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/src`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/nav.ts web/src/nav.test.ts web/src/api.ts web/src/pages/Parametres.tsx web/src/pages/Parametres.test.tsx web/src/pages/Portefeuille.tsx
git commit -m "Mandats : menu par phase, libellé Démo, choix de la phase dans Paramètres"
```

### Task 3: Créer ou lier un mandat depuis une affaire (serveur)

**Files:**
- Create: `src/instances/depuis-affaire.ts`
- Modify: `src/demo/service.ts` (extraire et exporter `brancherConnexions(tx, crm)` depuis
  `convertirProspect`, qui l'utilise)
- Modify: `src/api/routes.ts` (deux routes ; `mandat` ajouté à la fiche d'une affaire)
- Test: `src/instances/depuis-affaire.test.ts`

**Interfaces:**
- Consumes: `createInstance`, `phaseOf` (Task 1), `withInstance`, `logEvent`, slug libre de
  `src/demo/service.ts` (exporter `slugLibre`).
- Produces:
  - `class MandatRefuse extends Error {}`
  - `mandatLie(db: Executor, opportuniteId: string): Promise<{ slug: string; nom: string } | null>`
    : instance active de type `mandat` dont `config.origine.opportuniteId` vaut l'id.
  - `creerMandatDepuisAffaire(db: Database, propre: Instance, opportuniteId: string, { crm }: { crm: 'hubspot' | null }): Promise<Instance>`
    — refuse si `propre.type !== 'propre'`, affaire introuvable, affaire sans entreprise, ou
    déjà liée ; crée l'instance `mandat` (nom = nom de l'entreprise, slug libre, `config:
    { phase: 'closing', sous: 'Mandat', ecrituresReelles: false, origine: { opportuniteId,
    entrepriseId } }`), recopie l'entreprise et ses contacts (`source: 'simatis'`,
    `sourceId` = id d'origine, `entrepriseId` des contacts remappé), branche les connexions
    (`brancherConnexions`) et écrit au journal des deux instances (« Mandat créé depuis
    l'affaire <titre> » dans Mon activité, « Créé depuis une affaire de Mon activité (fiche et
    N contacts recopiés) » dans le mandat).
  - `lierMandat(db: Database, propre: Instance, opportuniteId: string, slug: string): Promise<Instance>`
    — mêmes refus côté affaire ; refuse si la cible n'est pas un `mandat` actif ou est déjà
    liée à une autre affaire ; pose `config.origine`, ne recopie rien.
  - Routes : `POST /api/i/:slug/opportunites/:id/mandat` corps `{ crm: 'hubspot' | null }`
    → `summary` ; `POST /api/i/:slug/opportunites/:id/mandat/lier` corps `{ slug }` →
    `summary` ; `MandatRefuse` → 409, corps invalide → 400.
  - `GET /api/i/:slug/fiches/affaire/:id` ajoute `mandat: { slug, nom } | null` quand
    l'instance est `propre` (absent sinon).

- [ ] **Step 1: Write the failing tests** dans `src/instances/depuis-affaire.test.ts`
  (données fictives : entreprise « Verrerie Alpha », deux contacts, une affaire liée ; une
  seconde affaire sans entreprise ; un mandat existant « beta ») :

```ts
it('creates a closing mandate with a copy of the company and its contacts', async () => {
  const m = await creerMandatDepuisAffaire(db, propre, affaireId, { crm: 'hubspot' });
  expect(m).toMatchObject({ type: 'mandat', nom: 'Verrerie Alpha', slug: 'verrerie-alpha' });
  expect(m.config).toMatchObject({ phase: 'closing', ecrituresReelles: false, origine: { opportuniteId: affaireId } });
  expect(await count('entreprises', m.slug)).toBe(1);
  expect(await count('contacts', m.slug)).toBe(2);
  expect(await count('opportunites', m.slug)).toBe(0);
  expect(await count('devis', m.slug)).toBe(0);
  expect(await mandatLie(db, affaireId)).toEqual({ slug: 'verrerie-alpha', nom: 'Verrerie Alpha' });
});
it('refuses a second mandate for the same deal', async () => {
  await expect(creerMandatDepuisAffaire(db, propre, affaireId, { crm: null })).rejects.toThrow(MandatRefuse);
});
it('refuses a deal without a company', async () => {
  await expect(creerMandatDepuisAffaire(db, propre, affaireSansEntreprise, { crm: null })).rejects.toThrow("L'affaire n'a pas d'entreprise");
});
it('suffixes the slug when the name is taken', async () => { /* seconde entreprise « Verrerie Alpha » → 'verrerie-alpha-2' */ });
it('links an existing mandate without copying anything', async () => {
  const m = await lierMandat(db, propre, autreAffaireId, 'beta');
  expect(m.config.origine?.opportuniteId).toBe(autreAffaireId);
  expect(await count('entreprises', 'beta')).toBe(avant);
});
it('refuses to link a demo, an archived instance, an unknown slug or an already linked mandate', async () => { /* 4 × rejects.toThrow(MandatRefuse) */ });
it('refuses when called from another instance than Mon activité', async () => { /* propre remplacé par le mandat beta → MandatRefuse */ });
```

Et un test de routes : `POST …/mandat` renvoie 200 puis 409 au second appel ; `GET
…/fiches/affaire/:id` renvoie `mandat.slug`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/instances/depuis-affaire.test.ts`
Expected: FAIL (module introuvable)

- [ ] **Step 3: Implement** `src/instances/depuis-affaire.ts`, l'extraction de
  `brancherConnexions`, les routes et l'ajout `mandat` à la fiche. La copie se fait dans une
  seule transaction : lecture dans `withInstance(propre)`, écriture dans
  `withInstance(mandat)` imbriqué dans la même transaction (comme `creerProspect`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/instances src/demo src/api`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/instances/depuis-affaire.ts src/instances/depuis-affaire.test.ts src/demo/service.ts src/api/routes.ts src/api/routes.test.ts
git commit -m "Mandats : créer ou lier un mandat depuis une affaire de Mon activité"
```

### Task 4: Boutons sur la fiche d'une affaire (interface)

**Files:**
- Modify: `web/src/api.ts` (`creerMandatDepuisAffaire`, `lierMandat`, `FicheDetail.mandat`)
- Modify: `web/src/pages/Fiche.tsx` (panneau « Mandat » dans la colonne de gauche, affaire
  de « Mon activité » seulement)
- Test: `web/src/pages/Fiche.test.tsx`

**Interfaces:**
- Consumes: routes et champ `mandat` de Task 3 ; `fetchInstances` existant pour la liste des
  mandats à lier (filtrer `type === 'mandat'`).
- Produces: aucun.

Comportement du panneau « Mandat » :
- lié : « Mandat : <nom> » avec un lien vers `#/<slug>/tableau` (ou la page d'accueil d'une
  instance utilisée par la barre latérale) ;
- non lié : choix « CRM du client » (HubSpot / Pas de CRM, comme pour la conversion d'une
  démo), bouton « Créer le mandat » en deux clics (« Confirmer la création ») ; en dessous,
  liste des mandats et bouton « Lier à un mandat existant » ;
- après succès : recharger la fiche et la liste des instances (`onChange` existant de la
  barre latérale, ou `location.reload()` comme la conversion d'une démo) ;
- erreur 409 : afficher le message du serveur.

- [ ] **Step 1: Write the failing tests** dans `web/src/pages/Fiche.test.tsx` : affaire
  sans mandat → bouton « Créer le mandat », deux clics → `POST
  /api/i/<slug>/opportunites/<id>/mandat` avec `{ crm: 'hubspot' }` ; affaire avec `mandat:
  { slug: 'beta', nom: 'Beta' }` → texte « Mandat : Beta » et aucun bouton de création ;
  fiche d'un contact → pas de panneau « Mandat ».

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run web/src/pages/Fiche.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** le panneau et les deux appels d'API.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/src/pages/Fiche.test.tsx`
Expected: PASS

- [ ] **Step 5: Verify the whole change**

Run: `npm run verify`
Expected: format, lint, types, tests et build verts.

Dans le navigateur (`npm run dev`, instance de démonstration) : le menu montre les quatre
groupes ; passer un mandat en Closing dans Paramètres le déplace dans « Mandats en
Closing » ; sur une affaire de « Mon activité », « Créer le mandat » crée le mandat (visible
dans le menu, avec l'entreprise et ses contacts) et la fiche affiche « Mandat : … ».

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts web/src/pages/Fiche.tsx web/src/pages/Fiche.test.tsx
git commit -m "Mandats : créer ou lier le mandat depuis la fiche d'une affaire"
```
