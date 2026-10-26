# Transfert d'objets entre instances — plan d'implémentation (livraison 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis l'instance SIMATIS, un super-administrateur déplace (objet natif) ou copie (objet miroir) un objet et ses liés vers une autre instance, via une pastille d'instance cliquable et un aperçu.

**Architecture:** un moteur serveur `src/transfert/` en deux temps (`planifierTransfert` calcule un aperçu sans rien écrire, `executerTransfert` applique en une transaction), piloté par un registre de types d'objets. Deux routes API, un helper de droit unique, un composant web `PastilleInstance` avec fenêtre d'aperçu.

**Tech Stack:** TypeScript, Fastify, Drizzle + Postgres (Row-Level Security), React, Vitest (`setupTestApp` dans `test/database.ts`).

**Spec:** `docs/superpowers/specs/2026-10-26-transfert-instance-design.md`

## Global Constraints

- Branche `feature/transfert-instance` (créée depuis `origin/main`), jamais de commit sur `main`, pas de worktree.
- Dépôt public : **données de test uniquement fictives**, aucun nom réel de client, contact ou montant.
- Commentaires en anglais pour le pourquoi (style du code existant) ; interface et messages d'erreur en français.
- Le moteur utilise la connexion propriétaire (`db`) et filtre toujours explicitement `instance_id` ; les politiques de sécurité des tables ne changent pas, aucune migration.
- Une copie est détachée : `source = 'natif'`, `source_id = null`.
- Le mode du sous-graphe suit la racine : racine native → enfants natifs déplacés, liés miroirs copiés ; racine miroir → tout copié.
- Un lien ne pointe jamais vers l'autre instance ; objet décoché → colonne de lien à `null`, ligne de liaison non reprise.
- Aucune mutation dans `docs/plan.md` (la vue transversale est la livraison 2, hors de ce plan).
- `npm run verify` vert avant chaque commit ; node via `/opt/homebrew/opt/node@24/bin`.

## Review Focus

1. Transfert d'un objet vers sa propre instance, vers une instance archivée ou inexistante : refus clair, rien d'écrit.
2. Racine introuvable ou appartenant à une autre instance que `instanceOrigine` : 404, jamais l'objet d'une autre instance.
3. Deux transferts simultanés de la même racine : un seul réussit, l'autre reçoit un refus, pas de doublon ni d'objet à moitié déplacé.
4. Panne au milieu du transfert : transaction annulée, ni ligne déplacée ni copie orpheline.
5. Sous-graphe cyclique (contact ↔ entreprise ↔ affaire ↔ tâche) : le calcul termine, chaque objet apparaît une fois.

## Structure des fichiers

- Créer `src/transfert/types.ts` : types partagés (`TypeObjet`, `Noeud`, `Apercu`…).
- Créer `src/transfert/droits.ts` : `peutTransferer`.
- Créer `src/transfert/registre.ts` : description de chaque type (table, colonnes de lien, liaisons).
- Créer `src/transfert/plan.ts` : `planifierTransfert`.
- Créer `src/transfert/executer.ts` : `executerTransfert` (déplacement, copie, activité d'origine, journal).
- Créer `src/transfert/*.test.ts` à côté de chaque module.
- Modifier `src/api/routes.ts` : routes `apercu`, `transfert`, `droit`.
- Créer `web/src/pages/transfert/PastilleInstance.tsx` et `FenetreTransfert.tsx` ; modifier `web/src/api.ts`, `web/src/pages/Fiche.tsx`, `web/src/pages/Inbox.tsx`, `web/src/styles.css`.

---

### Task 1: Droit de transférer et types partagés

**Files:**
- Create: `src/transfert/types.ts`, `src/transfert/droits.ts`
- Test: `src/transfert/droits.test.ts`

**Interfaces:**
- Produces:
  - `type TypeObjet = 'sujet' | 'tache' | 'affaire' | 'contact' | 'entreprise' | 'rdv'`
  - `type Mode = 'deplace' | 'copie'`
  - `type Noeud = { type: TypeObjet; id: string; libelle: string; mode: Mode; obligatoire: boolean }`
  - `type Apercu = { racine: Noeud; noeuds: Noeud[]; liensRetires: string[]; avertissements: string[]; copieExistante: { type: TypeObjet; id: string } | null }`
  - `type Exclusions = { type: TypeObjet; id: string }[]`
  - `type Utilisateur = { roles: string[] }`
  - `const UTILISATEUR_PILOTE: Utilisateur` (rôle `super_admin`; unique utilisateur aujourd'hui, le jour où l'OS aura des comptes il vient de la session)
  - `peutTransferer(utilisateur: Utilisateur, instance: Pick<Instance, 'type'>): boolean`

- [ ] **Step 1: Write the failing test** — `droits.test.ts` : `peutTransferer(UTILISATEUR_PILOTE, {type:'propre'})` vrai ; `{type:'mandat'}` et `{type:'prospect'}` faux ; `peutTransferer({roles:[]}, {type:'propre'})` faux.
- [ ] **Step 2: Run** `npx vitest run src/transfert/droits.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `types.ts` et `droits.ts` selon les signatures ci-dessus.
- [ ] **Step 4: Run** le même test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(transfert): droit de transférer et types partagés`.

---

### Task 2: Registre des types d'objets

**Files:**
- Create: `src/transfert/registre.ts`
- Test: `src/transfert/registre.test.ts`

**Interfaces:**
- Consumes: tables `sujets`, `taches`, `opportunites`, `contacts`, `entreprises`, `rendezVous`, `activites`, `affaireContacts`, `affaireEntreprises`, `contactEntreprises`, `rdvContacts`, `rdvEntreprises`, `rdvAffaires`.
- Produces:
  - `type Colonne = { colonne: string; vers: TypeObjet }` (colonne `uuid` d'un objet pointant vers un autre type, ex. `taches.opportunite_id → affaire`)
  - `type Liaison = { table: PgTable; proprietaire: TypeObjet; cible: TypeObjet; colProprietaire: string; colCible: string }`
  - `REGISTRE: Record<TypeObjet, { table: PgTable; libelle: (ligne) => string; liens: Colonne[]; liaisons: Liaison[]; obligatoires: TypeObjet[] }>` ; `obligatoires` reprend la colonne « Suivent obligatoirement » de la spec, le reste est « proposé ».
  - `ACTIVITES_DE: Record<'affaire' | 'contact' | 'entreprise', string>` (colonne de `activites`).

- [ ] **Step 1: Write the failing test** — `registre.test.ts` : chaque type de `REGISTRE` a une table dont chaque colonne citée existe ; `REGISTRE.affaire.obligatoires` contient `tache` et `rdv` mais pas `contact` ; `REGISTRE.contact.obligatoires` ne contient pas `entreprise` (proposée) ; toute colonne `liens` de type `X` cible un type présent dans `REGISTRE`.
- [ ] **Step 2: Run** `npx vitest run src/transfert/registre.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `registre.ts` : une entrée par type, colonnes tirées de `src/crm/schema.ts` et `src/inbox/schema.ts` (ex. `sujet.liens = contact_id→contact, entreprise_id→entreprise, tache_id→tache`, `proposition_id` traité à part comme « lien retiré à la copie et au déplacement »).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(transfert): registre des types d'objets`.

---

### Task 3: Calcul de l'aperçu (`planifierTransfert`)

**Files:**
- Create: `src/transfert/plan.ts`
- Test: `src/transfert/plan.test.ts`

**Interfaces:**
- Consumes: `REGISTRE`, types de la Task 1.
- Produces: `planifierTransfert(db: Executor, p: { instanceOrigine: string; cible: string; racine: { type: TypeObjet; id: string }; exclusions: Exclusions }): Promise<Apercu>` ; erreurs `TransfertRefuse` (cible archivée, identique à l'origine, inconnue) et `RacineIntrouvable` (classes exportées).

- [ ] **Step 1: Write the failing tests** (`setupTestApp`, trois instances fictives `siege` (propre), `mandat-a`, `mandat-b`) :
  - `planifie_une_affaire_native`: affaire native avec 1 tâche native, 1 contact natif → noeuds {affaire, tache} obligatoires + contact proposé, tous `deplace`.
  - `planifie_un_contact_miroir_en_copie`: contact `source='hubspot'` → racine `copie`, ses tâches natives aussi `copie` (le mode suit la racine).
  - `racine_native_et_lie_miroir`: contact natif lié à une entreprise miroir → contact `deplace`, entreprise `copie`.
  - `exclusion_retire_le_lien`: exclure le contact d'une tâche → `liensRetires` le mentionne, le noeud est absent.
  - `graphe_cyclique_termine`: contact ↔ entreprise ↔ affaire ↔ tâche liés en rond → chaque noeud une seule fois.
  - `refus`: cible = origine, cible archivée, racine d'une autre instance (`RacineIntrouvable`).
  - `avertissements`: rdv copié → « ne sera plus lié à l'agenda » ; sujet lié à une proposition → le lien proposition est signalé retiré ; sujet dont la clé existe dans la cible → avertissement de suffixe ; copie existante (événement journal `transfert.copie` de la cible contenant l'origine) → `copieExistante` renseigné.
- [ ] **Step 2: Run** `npx vitest run src/transfert/plan.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `planifierTransfert` : parcours en largeur depuis la racine avec un `Set` de `type:id` visités, en suivant `liens` (sortants) et les lignes qui pointent vers l'objet (entrants, requête inverse par colonne) et `liaisons` ; `obligatoire` d'après `REGISTRE[type].obligatoires` du parent ; les objets exclus ne sont pas parcourus. Mode : racine native → natif=`deplace`, miroir=`copie` ; racine miroir → tout `copie`. Copie existante : `select` sur `journal` de la cible avec `details->'copies' @> '[{"origineInstance":…,"origineId":…}]'`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(transfert): calcul de l'aperçu d'un transfert`.

---

### Task 4: Exécution — déplacement

**Files:**
- Create: `src/transfert/executer.ts`
- Test: `src/transfert/executer.deplacement.test.ts`

**Interfaces:**
- Consumes: `planifierTransfert`, `Apercu`.
- Produces: `executerTransfert(db: Executor, p: { instanceOrigine: string; cible: string; racine: { type: TypeObjet; id: string }; exclusions: Exclusions; copierQuandMeme?: boolean }): Promise<{ deplaces: number; copies: number; racine: { type: TypeObjet; id: string; instance: string } }>` ; l'identifiant de la racine renvoyé est celui dans la cible.

- [ ] **Step 1: Write the failing tests** :
  - `deplace_une_affaire_et_ses_lies`: après exécution, `select … where instance_id = origine` ne renvoie plus l'affaire ni la tâche ; la cible les renvoie avec les mêmes identifiants.
  - `aucune_cle_etrangere_vers_l_autre_instance`: parcourir toutes les colonnes de lien du `REGISTRE` et les liaisons : chaque cible référencée existe dans la même `instance_id` que la ligne.
  - `liaisons_et_liens_principaux`: les lignes `affaire_contacts` suivent, `assurerLiensPrincipaux` recalcule `opportunites.contact_id`.
  - `activite_deplacee_et_trace`: les activités de l'affaire suivent ; une activité « Déplacé depuis l'instance … » est ajoutée.
  - `sujet_cle_prise`: clé `source_id` déjà présente dans la cible → déplacement réussi, clé suffixée `:transfert-<id>`.
- [ ] **Step 2: Run** `npx vitest run src/transfert/executer.deplacement.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `executerTransfert` (partie déplacement) : `db.transaction`, `pg_advisory_xact_lock(hashtext('transfert:'||racine.id))`, rejoue `planifierTransfert` dans la transaction, puis pour chaque noeud `deplace` : `UPDATE … SET instance_id = cible, updated_at = now()` ; mêmes mises à jour pour les tables de liaison et activités ; colonnes de lien vers des objets exclus mises à `null`. Activité d'origine : insérer dans `activites` pour affaire, contact, entreprise uniquement.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(transfert): déplacement d'un objet natif et de ses liés`.

---

### Task 5: Exécution — copie des miroirs

**Files:**
- Modify: `src/transfert/executer.ts`
- Test: `src/transfert/executer.copie.test.ts`

**Interfaces:**
- Consumes: Task 4 (`executerTransfert`).
- Produces: aucune signature nouvelle ; `executerTransfert` gère les noeuds `copie`.

- [ ] **Step 1: Write the failing tests** :
  - `copie_detachee`: contact `source='hubspot'`, `source_id='h1'` → copie avec `source='natif'`, `source_id` null, nouvel identifiant ; l'original est inchangé et resté dans l'origine.
  - `liens_de_la_copie_vers_des_copies`: copie d'une affaire miroir avec contact miroir → la copie d'affaire pointe vers la copie du contact, pas l'original.
  - `activite_origine_sur_la_copie`: contact copié → activité `Créé depuis l'instance <nom>` avec le titre de l'objet d'origine.
  - `rdv_copie`: `event_id = 'copie:<id de la copie>'`, compte rendu et participants conservés, liens vers contacts copiés.
  - `melange_deplace_et_copie`: contact natif déplacé + entreprise miroir copiée, la tâche du contact référence la copie.
  - `copie_deja_faite`: sans `copierQuandMeme`, refus avec `copieExistante` (erreur `CopieDejaFaite` portant le noeud) ; avec `copierQuandMeme: true`, deuxième copie créée.
  - `trace_journal_cible`: événement `transfert.copie` dans le journal de la cible, `details.copies = [{ type, origineInstance, origineId, copieId }]`.
- [ ] **Step 2: Run** `npx vitest run src/transfert/executer.copie.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : `INSERT … SELECT` par type avec table de correspondance `Map<'type:id', nouvelId>` ; réécrire les colonnes de lien via la table, recréer les liaisons entre objets présents, copier les activités rattachées, `assurerLiensPrincipaux` sur les affaires et contacts copiés ; levée de `CopieDejaFaite` si `apercu.copieExistante` et pas `copierQuandMeme`.
- [ ] **Step 4: Run** — Expected: PASS (et les tests de la Task 4 toujours verts).
- [ ] **Step 5: Commit** `feat(transfert): copie détachée des objets miroirs`.

---

### Task 6: Atomicité, concurrence et journal

**Files:**
- Modify: `src/transfert/executer.ts`
- Test: `src/transfert/executer.garanties.test.ts`

**Interfaces:**
- Consumes: Tasks 4-5. Produces: aucune signature ; garanties de comportement.

- [ ] **Step 1: Write the failing tests** :
  - `journal_des_deux_instances`: après un déplacement, une ligne `transfert.deplace` dans le journal de l'origine **et** de la cible, avec compteurs par type et identifiant de la racine.
  - `echec_au_milieu_annule_tout`: provoquer une erreur après le premier `UPDATE` (insérer au préalable, dans la cible, une ligne qui viole une contrainte d'unicité d'une liaison, ou stub `vi.spyOn`) → après l'échec, rien n'a changé d'instance et aucune ligne de copie n'existe.
  - `deux_transferts_simultanes`: `Promise.allSettled` de deux `executerTransfert` identiques → exactement un `fulfilled`, l'autre rejeté avec `TransfertRefuse` ou `RacineIntrouvable`, un seul objet dans la cible.
  - `cible_archivee_ou_identique`: refus sans écriture.
- [ ] **Step 2: Run** `npx vitest run src/transfert/executer.garanties.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : `logEvent(tx, …)` sous `withInstance` pour chaque instance dans la même transaction (acteur `pilote`, actions `transfert.deplace` / `transfert.copie`) ; le verrou consultatif de la Task 4 suffit à la concurrence (le second voit la racine déjà partie).
- [ ] **Step 4: Run** `npx vitest run src/transfert` — Expected: tout PASS.
- [ ] **Step 5: Commit** `feat(transfert): journal des deux instances, atomicité et concurrence`.

---

### Task 7: Routes API

**Files:**
- Modify: `src/api/routes.ts` (près des routes `inbox`, après `onInstance`)
- Test: `src/api/transfert.routes.test.ts` (modèle : `src/api/liens.routes.test.ts`)

**Interfaces:**
- Consumes: `planifierTransfert`, `executerTransfert`, `peutTransferer`, `UTILISATEUR_PILOTE`.
- Produces:
  - `GET /api/i/:slug/transfert/droit` → `{ autorise: boolean }`
  - `POST /api/i/:slug/transfert/apercu` corps `{ type, id, instanceOrigine, instanceCible, exclusions }` → `Apercu`
  - `POST /api/i/:slug/transfert` mêmes champs + `copierQuandMeme?` → résumé de `executerTransfert`
  - `instanceOrigine` et `instanceCible` sont des **slugs** ; `:slug` est l'instance courante (celle qui porte le droit).
  - Codes : 403 (`peutTransferer` faux), 404 (instance inconnue ou `RacineIntrouvable`), 409 (`CopieDejaFaite` avec le noeud dans le corps, ou collision), 400 (`TransfertRefuse`, corps invalide, validé par zod).

- [ ] **Step 1: Write the failing tests** : `droit` vrai sur `siege`, faux sur un mandat ; `apercu` 403 depuis un mandat ; 404 racine d'une autre instance ; `POST` déplace puis la ré-interrogation de l'ancienne instance renvoie 404 ; 409 sur copie déjà faite, puis 200 avec `copierQuandMeme: true` ; 400 sur corps invalide ; instance cible inconnue → 404.
- [ ] **Step 2: Run** `npx vitest run src/api/transfert.routes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les trois routes avec `onInstance`, résolution des slugs par `getInstanceBySlug`, validation zod du corps (schéma déjà utilisé dans le fichier).
- [ ] **Step 4: Run** `npx vitest run src/api` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(transfert): routes d'aperçu et de transfert`.

---

### Task 8: Pastille d'instance et fenêtre d'aperçu (web)

**Files:**
- Create: `web/src/pages/transfert/PastilleInstance.tsx`, `web/src/pages/transfert/FenetreTransfert.tsx`
- Modify: `web/src/api.ts` (appels `fetchDroitTransfert`, `apercuTransfert`, `lancerTransfert`), `web/src/styles.css`
- Test: `web/src/pages/transfert/PastilleInstance.test.tsx` (modèle : `web/src/pages/Fiche.test.tsx`, `// @vitest-environment jsdom`)

**Interfaces:**
- Consumes: routes de la Task 7, `fetchInstances`.
- Produces:
  - `PastilleInstance(props: { slug: string; instance: { slug: string; nom: string; couleur: string | null }; objet: { type: TypeObjet; id: string }; onTransfere: () => void })` : rend rien si le droit est faux ou si `slug` n'est pas celui d'une instance de type `propre` ; sinon un bouton pastille (nom, bordure à la couleur de l'instance).
  - `FenetreTransfert(props: { slug; objet; instanceOrigine; cible; onFermer; onFait })` : aperçu en liste (déplacés / copiés, liens retirés, avertissements), cases à cocher pour les noeuds non obligatoires, boutons « Confirmer », « Ouvrir la copie existante » / « Copier quand même » quand `copieExistante`.

- [ ] **Step 1: Write the failing tests** : pastille absente sans droit ; présente avec droit et clic ouvre la liste des instances actives (hors instance courante) ; choisir une instance appelle `apercu` puis affiche « 1 affaire, 1 tâche seront déplacés » et « 1 contact sera copié » ; décocher un noeud proposé le renvoie dans `exclusions` ; « Confirmer » appelle `POST /transfert` puis `onTransfere` ; message du 409 `copie déjà faite` propose les deux boutons.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/transfert` — Expected: FAIL.
- [ ] **Step 3: Implement** les deux composants et les appels d'API (même style que `creerMandatDepuisAffaire`, `web/src/api.ts:244`) ; classe CSS `.pastille-instance` calquée sur `.badge-instance` (`web/src/styles.css:1141`), curseur pointeur seulement quand cliquable.
- [ ] **Step 4: Run** `npx vitest run web/src/pages/transfert` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(transfert): pastille d'instance et fenêtre d'aperçu`.

---

### Task 9: Intégration dans les fiches et l'Inbox, vérification complète

**Files:**
- Modify: `web/src/pages/Fiche.tsx` (sous le titre, à côté de la pastille « HubSpot » / « OS », ligne ~392), `web/src/pages/Inbox.tsx` (badge d'instance de la ligne, ligne ~132), pages tâche et rendez-vous si leur en-tête de fiche existe (`FicheRdv.tsx`)
- Test: `web/src/pages/Fiche.test.tsx`, `web/src/pages/Inbox.test.tsx` (ajouts)

**Interfaces:**
- Consumes: `PastilleInstance` (Task 8). Produces: rien.

- [ ] **Step 1: Write the failing tests** : dans `Fiche.test.tsx`, sur `siege` avec droit, la pastille d'instance s'affiche à côté de « HubSpot » ; dans une instance `mandat`, elle n'est pas rendue ; dans `Inbox.test.tsx`, une entrée d'un autre mandat dans l'Inbox agrégée porte la pastille cliquable dont l'`instanceOrigine` est celle de l'entrée, pas l'instance courante.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/Fiche.test.tsx web/src/pages/Inbox.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** l'intégration ; après un transfert réussi, la fiche affiche « Objet déplacé vers <instance> » avec le lien, ou recharge la liste pour l'Inbox.
- [ ] **Step 4: Run** `npm run verify` — Expected: format, lint, types, tests et build verts.
- [ ] **Step 5: Vérification navigateur** : `preview_start`, créer deux mandats fictifs et une affaire native dans SIMATIS, cliquer la pastille, constater l'aperçu, confirmer, ouvrir le mandat cible et retrouver l'objet ; vérifier qu'aucune pastille n'apparaît dans le mandat ; arrêter le serveur (ou dire lequel tourne encore).
- [ ] **Step 6: Commit** `feat(transfert): pastille d'instance sur les fiches et l'Inbox`, puis PR, revue de code, CI verte, merge, rebuild de l'app depuis `origin/main` (règle du projet) et explication de test pour Marc.
