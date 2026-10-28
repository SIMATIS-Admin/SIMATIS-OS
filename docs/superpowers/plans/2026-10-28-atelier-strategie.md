# Atelier stratégique Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à l'OS une section « Atelier stratégique » (bêta) : accueil par entreprise, atelier en six étapes enregistré en base, import de l'historique du premier mandat, module d'essai hors base, liens depuis les fiches.

**Architecture:** Une table `ateliers_strategie` (état complet en un bloc jsonb versionné), un service et des routes sur le modèle du diagnostic (`src/diagnostic/`, `src/vma/routes.ts`), un écran React `web/src/pages/Atelier.tsx` qui lit les diagnostics et tests VMA par leurs routes existantes. La logique pure (état vide, calcul, exports) vit dans `web/src/pages/atelier/` et se teste seule.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres, RLS par instance), zod, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-atelier-strategie-design.md` (maquette : `maquettes/atelier-strategie.html`).

## Global Constraints

- Le dépôt est public : aucune donnée réelle (noms, chiffres, offres), aucun texte de méthode détaillé (grille SAVE, sept pistes, consignes ICP). Squelette neutre et données fictives seulement.
- Branche `feature/atelier-strategie` (déjà créée depuis `main`) ; jamais de commit sur `main`, jamais `git add -A`, relire `git diff --staged` avant chaque commit.
- `npm run verify` avant chaque commit ; chaque fonctionnalité arrive avec ses tests.
- Interface et documentation en français ; nommage cohérent avec le dépôt (identifiants français pour le métier).
- Entrée de menu : « Atelier stratégique » + pastille « Bêta », rubrique Stratégie, module d'instance `atelier` (comme `devis`), actif pour l'espace « Mon activité » (`type === 'propre'`) seulement.
- Étapes (6) : Cadrage, Diagnostic, Modèle, Objectifs, Ciblage, Feuille de route. `etape` et `etape_max` valent 1 à 6.
- Écran partagé actif par défaut à l'ouverture ; éléments privés exclus de l'affichage et des exports.
- Module d'essai : aucun appel d'écriture, aucune ligne en base.
- Valeurs de test des objectifs : CA 120 000, part 40 %, panier 3 000, abonnement 300, 6 mois, conversions 25 % et 15 %, taux de commission 10 % donnent 24 ventes, 27 abonnés, revenu récurrent mensuel 8 100, 204 rendez-vous, 1 360 contacts, commission 12 000, commission récurrente annuelle 9 720.
- Format de sauvegarde repris tel quel : `{ v: 1, steps_state: <état> }` ; l'état porte `v: 1` et `step` (0 à 5).

## Review Focus

- Import d'un fichier qui n'est pas du JSON, sans `steps_state`, de mauvaise version ou trop gros : refus clair (400), rien n'est créé.
- Entreprise d'une autre instance ou inexistante à la création ou à l'import : refus, aucun atelier orphelin.
- Quitter l'écran avant la fin du délai d'enregistrement : la dernière frappe est quand même enregistrée.
- Module d'essai : jamais de requête d'écriture, même en changeant d'étape ou en exportant.
- Export avec écran partagé actif : ni commission, ni notes privées, ni éléments marqués `prive`.
- Sauvegarde ancienne (sans les champs d'abonnement) ou champs numériques vides : l'état est complété par les valeurs de l'état vide, les calculs ne divisent jamais par zéro.

---

## File Structure

- Create `src/atelier/schema.ts` : table `ateliers_strategie`.
- Create `src/atelier/saisie.ts` : schémas zod (création, import, patch, état).
- Create `src/atelier/service.ts` : accès aux données, module, erreurs.
- Create `src/atelier/routes.ts` : routes HTTP.
- Create `src/atelier/*.test.ts`, migration `drizzle/0045_*.sql` (générée).
- Modify `src/app.ts` (enregistrer les routes), `src/crm/fiches.ts` (ateliers liés).
- Create `web/src/pages/atelier/etat.ts`, `calcul.ts`, `exports.ts` (+ tests), `Etapes.tsx` et composants d'étapes.
- Create `web/src/pages/Atelier.tsx` (accueil) et `web/src/pages/atelier/AtelierVue.tsx` (atelier ouvert).
- Modify `web/src/nav.ts`, `web/src/shell/Sidebar.tsx`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/pages/Fiche.tsx`, `web/src/styles.css`.

### Task 1: Table, service et routes

**Files:**
- Create: `src/atelier/schema.ts`, `src/atelier/saisie.ts`, `src/atelier/service.ts`, `src/atelier/routes.ts`
- Modify: `src/app.ts`
- Test: `src/atelier/service.test.ts`, `src/atelier/routes.test.ts`

**Interfaces:**
- Produces (`schema.ts`): `ateliersStrategie` avec `id`, `...metierColumns()`, `entrepriseId` (uuid, références `entreprises.id`, not null), `titre` (text), `etape` et `etapeMax` (integer, défaut 1), `etat` (jsonb `EtatBrut`), policy `instanceIsolation('ateliers_strategie')` ; types `Atelier`, `EtatBrut = { v: 1; step: number } & Record<string, unknown>`.
- Produces (`saisie.ts`): `etatSchema` (objet `v: 1`, `step` entier 0 à 5, le reste libre, taille JSON ≤ 300 000 octets), `creationSchema { entrepriseId, titre }`, `importSchema { entrepriseId, titre, sauvegarde: { v: 1, steps_state: etat } }`, `patchSchema { titre?, etat? }`.
- Produces (`service.ts`): `class AtelierIndisponible`, `class AtelierIntrouvable`, `class EntrepriseIntrouvable` ; `atelierActif(instance: Instance): boolean` ; `listAteliers(db, instance): Promise<AtelierListe[]>` (sans `etat`) ; `getAtelier(db, instance, id): Promise<Atelier>` ; `createAtelier(db, instance, { entrepriseId, titre, etat? }): Promise<Atelier>` ; `updateAtelier(db, instance, id, patch): Promise<Atelier>` (recalcule `etape = etat.step + 1` et `etapeMax = max(ancien, etape)`) ; `deleteAtelier(db, instance, id): Promise<void>`.
- Produces (`routes.ts`): `registerAtelierRoutes(app, { db })` : `GET/POST /api/i/:slug/ateliers-strategie`, `POST …/import`, `GET/PATCH/DELETE …/:id`. Codes : 403 module absent, 404 inconnu, 400 saisie ou entreprise invalide.

- [ ] **Step 1: Write the failing service tests** (`service.test.ts`, dans le style de `src/diagnostic/service.test.ts` avec `setupTestApp`, deux instances `propre`, un mandat, une entreprise par instance) : `refuse une instance sans le module atelier` (AtelierIndisponible), `crée un atelier à l'étape 1 rattaché à l'entreprise`, `refuse une entreprise d'une autre instance` (EntrepriseIntrouvable), `enregistre l'étape et garde l'étape max quand on revient en arrière` (step 3 puis step 1 : `etape` 2, `etapeMax` 4), `la liste ne renvoie pas l'état`, `une autre instance ne voit pas l'atelier` (liste vide, getAtelier lève AtelierIntrouvable), `supprime un atelier`.
- [ ] **Step 2: Run** `npx vitest run src/atelier/service.test.ts` ; attendu : FAIL (modules absents).
- [ ] **Step 3: Implement** `schema.ts`, `saisie.ts`, `service.ts` comme décrit dans Interfaces ; vérification d'entreprise par lecture dans `withInstance` filtrée sur `instanceId`, comme `createProjet` du diagnostic.
- [ ] **Step 4: Generate the migration** : `npx drizzle-kit generate` ; contrôler que le SQL ne contient que `CREATE TABLE ateliers_strategie`, son index sur `instance_id`, la clé étrangère et l'activation de la sécurité par ligne avec sa politique.
- [ ] **Step 5: Run** `npx vitest run src/atelier/service.test.ts` ; attendu : PASS.
- [ ] **Step 6: Write the failing route tests** (`routes.test.ts`, style `src/vma/testeur.test.ts` : Fastify + `registerAtelierRoutes`) : `GET renvoie 403 sans module`, `POST crée puis GET :id renvoie l'état`, `PATCH enregistre step et etat`, `POST import accepte {v:1, steps_state}` (fichier fictif minimal), `import refuse un JSON sans steps_state (400, aucune ligne créée)`, `import refuse un état de plus de 300 000 octets (400)`, `import refuse une mauvaise version (400)`, `entreprise inconnue (400)`, `DELETE`.
- [ ] **Step 7: Implement** `routes.ts` (gabarit de `registerVmaRoutes` : `getInstanceBySlug`, `safeParse`, erreurs du service traduites) et l'appeler dans `src/app.ts` à côté de `registerVmaRoutes`.
- [ ] **Step 8: Run** `npm run verify` ; attendu : tout vert.
- [ ] **Step 9: Commit** — `git add src/atelier drizzle src/app.ts` puis `git commit -m "feat(atelier): table, service et routes"`.

### Task 2: Logique pure de l'atelier (état vide, calcul, exports)

**Files:**
- Create: `web/src/pages/atelier/etat.ts`, `web/src/pages/atelier/calcul.ts`, `web/src/pages/atelier/exports.ts`
- Test: `web/src/pages/atelier/calcul.test.ts`, `web/src/pages/atelier/exports.test.ts`, `web/src/pages/atelier/etat.test.ts`

**Interfaces:**
- Produces (`etat.ts`): `ETAPES: readonly ['Cadrage','Diagnostic','Modèle','Objectifs','Ciblage','Feuille de route']` ; type `EtatAtelier` (forme de l'état de la page actuelle : `v`, `step`, `date`, `notes[6]`, `diag`, `vma`, `facts[]` avec `prive?`, `swot`, `scenarios`, `motors`, `save`, `obj`, `icps`, `cab`, `pistes`, `actions`, notes privées) ; `etatVide(): EtatAtelier` (titres génériques, champs vides, aucun texte de méthode ni donnée réelle) ; `completer(brut: unknown): EtatAtelier` (fusion superficielle sur `etatVide()`, comme l'ancien `load()`).
- Produces (`calcul.ts`): `entonnoir(obj: Objectifs): Entonnoir` avec `ventes, abonnes, mrr, rdv, contacts, commission, commissionRecurrente` ; entrées non numériques ou ≤ 0 remplacées par des valeurs par défaut sûres (pas de division par zéro).
- Produces (`exports.ts`): `exportJson(etat: EtatAtelier, partage: boolean): object` (schéma `simatis-os/plan-action-brouillon`, champs d'abonnement ; commission et notes privées seulement si `!partage`) ; `exportMarkdown(etat, partage): string` (fiche de cadrage, mêmes règles).

- [ ] **Step 1: Write the failing tests** : `calcul.test.ts` : `entonnoir` donne exactement les valeurs de Global Constraints ; `part à 0 : aucun abonné, aucune division par zéro` ; `champs vides : valeurs par défaut sûres`. `exports.test.ts` : `partage actif : ni commission ni notes privées ni élément prive` pour le JSON et le Markdown ; `partage inactif : la commission apparaît`. `etat.test.ts` : `completer(ancienne sauvegarde sans obj.abo)` renvoie `obj.abo` défini ; `etatVide` ne contient aucune des chaînes interdites (test sur une liste de mots fictifs de contrôle, pas de données réelles).
- [ ] **Step 2: Run** `npx vitest run web/src/pages/atelier` ; attendu : FAIL.
- [ ] **Step 3: Implement** les trois fichiers ; porter la formule de `funnel()` et les gabarits d'export depuis `outils/atelier-strategie/index.html` du dossier du site (`exportObj`, `exportObjComplet`, `markdown`), en retirant toute donnée du premier mandat.
- [ ] **Step 4: Run** `npm run verify` ; attendu : tout vert.
- [ ] **Step 5: Commit** — `git add web/src/pages/atelier` puis `git commit -m "feat(atelier): état vide, calcul et exports"`.

### Task 3: Entrée de menu, accès et accueil de la section

**Files:**
- Modify: `web/src/nav.ts`, `web/src/shell/Sidebar.tsx`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/styles.css`
- Create: `web/src/pages/Atelier.tsx`
- Test: `web/src/nav.test.ts`, `web/src/pages/Atelier.test.tsx`

**Interfaces:**
- Consumes: routes de la tâche 1 ; `fetchEntreprises`, `fetchProjetsDiag`, `fetchTestsVma` (existants) ; `grouper`, `lignesSuivies`, `filtrer`, `paginer`, `resumerVma` de `web/src/pages/diagnostics/grouper.ts`.
- Produces (`nav.ts`): `NavItem.beta?: boolean` ; entrée `item('atelier', 'Atelier stratégique', 'map', 'atelier')` avec `beta: true`, après « Outils et diagnostics » ; `'atelier'` dans `BUILT`.
- Produces (`api.ts`): type `AtelierListe`, `fetchAteliers(slug)`, `creerAtelier(slug, entrepriseId, titre)`, `importerAtelier(slug, entrepriseId, titre, sauvegarde)`, `majAtelier(slug, id, patch)`, `fetchAtelier(slug, id)`, `supprimerAtelier(slug, id)`.
- Produces (`Atelier.tsx`): `Atelier({ slug, ouvrir?, onTitre? })` ; ligne d'entreprise à trois colonnes (diagnostic, tests VMA, ateliers), détail avec blocs diagnostic et VMA en lecture seule (lien `#/${slug}/diagnostics`), bloc « Ateliers stratégiques », « + Nouveau », modales de création et d'import, bouton « Atelier : module d'essai », suppression avec confirmation, recherche, pagination.

- [ ] **Step 1: Write the failing tests** : `nav.test.ts` : `l'entrée Atelier stratégique est dans Stratégie, marquée bêta et rattachée au module atelier` ; `elle n'apparaît pas sans le module` (`allowed`). `Atelier.test.tsx` (style de `Diagnostics.test.tsx`) : `affiche la pastille Bêta`, `liste les entreprises avec l'état du diagnostic, des tests et des ateliers`, `+ Nouveau propose Nouvel atelier et Importer un atelier`, `la création appelle creerAtelier puis ouvre l'atelier`, `l'import lit le fichier et appelle importerAtelier`, `un fichier invalide affiche l'erreur sans créer`, `Atelier : module d'essai ouvre l'atelier sans appeler d'API d'écriture`, `la suppression demande confirmation`.
- [ ] **Step 2: Run** `npx vitest run web/src/nav.test.ts web/src/pages/Atelier.test.tsx` ; attendu : FAIL.
- [ ] **Step 3: Implement** nav (+ rendu de la pastille dans `Sidebar.tsx`), fonctions d'API, `Atelier.tsx` et la route `case 'atelier'` dans `App.tsx` (même passage de `ouvrir` et `onTitre` que `diagnostics`) ; styles dans `styles.css` sur le modèle des classes `dg-*`.
- [ ] **Step 4: Run** `npm run verify` ; attendu : tout vert.
- [ ] **Step 5: Commit** — `git add` des fichiers listés puis `git commit -m "feat(atelier): entrée de menu et accueil de la section"`.

### Task 4: Atelier ouvert, enregistrement et module d'essai

**Files:**
- Create: `web/src/pages/atelier/AtelierVue.tsx`, `web/src/pages/atelier/Objectifs.tsx`
- Modify: `web/src/pages/Atelier.tsx` (ouvrir un atelier, mode essai)
- Test: `web/src/pages/atelier/AtelierVue.test.tsx`

**Interfaces:**
- Consumes: `entonnoir`, `completer`, `etatVide`, `ETAPES` (tâche 2) ; `majAtelier` (tâche 3).
- Produces: `AtelierVue({ slug, atelier: { id, titre, entrepriseNom } | null, etatInitial: EtatAtelier, essai: boolean, onRetour: () => void, onTitre?: (t: string | null) => void })` ; `atelier === null` et `essai === true` dans le module d'essai. Interrupteur d'écran partagé (actif par défaut, état local, jamais enregistré). Parcours cliquable, boutons précédent et suivant, enregistrement avec délai de 800 ms et envoi immédiat au démontage. `Objectifs({ etat, onChange, partage })` : champs d'objectifs, cartes de résultats, carte privée « Pour Marc » masquée si `partage`.

- [ ] **Step 1: Write the failing tests** : `ouvre à l'étape enregistrée`, `changer d'étape enregistre étape et étape max après le délai` (temps simulé), `quitter avant le délai enregistre quand même` (Review Focus), `le module d'essai n'appelle jamais majAtelier` (même en changeant d'étape), `le bandeau d'essai s'affiche et le retour revient à l'accueil`, `l'écran partagé masque la carte Pour Marc et le bouton le révèle`, `les résultats d'objectifs reprennent les valeurs de référence`.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/atelier/AtelierVue.test.tsx` ; attendu : FAIL.
- [ ] **Step 3: Implement** `AtelierVue.tsx` (état local `EtatAtelier`, enregistrement différé avec `useRef` pour le minuteur, vidage dans le nettoyage de l'effet) et `Objectifs.tsx` ; brancher l'ouverture dans `Atelier.tsx` (charger l'atelier par `fetchAtelier`, `completer` l'état reçu).
- [ ] **Step 4: Run** `npm run verify` ; attendu : tout vert.
- [ ] **Step 5: Commit** — `git commit -m "feat(atelier): atelier ouvert, enregistrement et module d'essai"` après `git add` explicite.

### Task 5: Étapes Cadrage, Diagnostic et Modèle

**Files:**
- Create: `web/src/pages/atelier/Cadrage.tsx`, `Diagnostic.tsx`, `Modele.tsx` (même dossier)
- Modify: `web/src/pages/atelier/AtelierVue.tsx` (brancher les étapes 1 à 3)
- Test: `web/src/pages/atelier/Etapes123.test.tsx`

**Interfaces:**
- Consumes: `EtatAtelier`, `AtelierVue` (tâches 2 et 4).
- Produces: trois composants `({ etat, onChange, partage })`. Cadrage : faits avec nature (fait sourcé, déclaration, hypothèse, question ouverte), source, indicateur `prive`, ajout et suppression ; notes d'étape. Diagnostic : état du diagnostic et du test VMA saisi (listes d'options de l'ancien outil) et note. Modèle : forces et faiblesses, scénarios de chiffre d'affaires, moteur d'offre, grille de modèle.

- [ ] **Step 1: Write the failing tests** : `Cadrage : un fait privé n'est pas affiché en écran partagé`, `Cadrage : ajouter puis supprimer un fait met l'état à jour`, `la nature d'un fait se change`, `Diagnostic : le choix d'état est conservé`, `Modèle : choisir un scénario et un moteur met l'état à jour`.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/atelier/Etapes123.test.tsx` ; attendu : FAIL.
- [ ] **Step 3: Implement** les trois composants en portant `vStep0`, `vStep1`, `vStep2` de `outils/atelier-strategie/index.html` (dossier du site), sans copier de texte de méthode : libellés génériques seulement ; brancher dans `AtelierVue`.
- [ ] **Step 4: Run** `npm run verify` ; attendu : tout vert.
- [ ] **Step 5: Commit** — `git commit -m "feat(atelier): étapes Cadrage, Diagnostic et Modèle"`.

### Task 6: Étapes Ciblage et Feuille de route, exports

**Files:**
- Create: `web/src/pages/atelier/Ciblage.tsx`, `FeuilleDeRoute.tsx`
- Modify: `web/src/pages/atelier/AtelierVue.tsx`
- Test: `web/src/pages/atelier/Etapes56.test.tsx`

**Interfaces:**
- Consumes: `exportJson`, `exportMarkdown` (tâche 2).
- Produces: `Ciblage({ etat, onChange, partage })` : ICP, personas, pistes (cases à cocher), choix de l'ICP affiché. `FeuilleDeRoute({ etat, onChange, partage })` : actions par trimestre (cocher, ajouter, supprimer), boutons « Télécharger la feuille de route (JSON) », « Télécharger la fiche de cadrage (Markdown) », « Copier la fiche ».

- [ ] **Step 1: Write the failing tests** : `Ciblage : changer d'ICP et cocher une piste met l'état à jour`, `Feuille de route : ajouter, cocher et supprimer une action`, `le téléchargement JSON passe partage à exportJson` (écran partagé actif : pas de commission dans le contenu téléchargé), `la copie Markdown utilise le presse-papiers et signale un refus`.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/atelier/Etapes56.test.tsx` ; attendu : FAIL.
- [ ] **Step 3: Implement** en portant `vStep4` et `vStep5` de l'ancien outil, libellés génériques ; téléchargement par un lien temporaire (`Blob`) comme l'ancien `download`.
- [ ] **Step 4: Run** `npm run verify` ; attendu : tout vert.
- [ ] **Step 5: Commit** — `git commit -m "feat(atelier): étapes Ciblage et Feuille de route, exports"`.

### Task 7: Liens depuis les fiches entreprise et contact

**Files:**
- Modify: `src/crm/fiches.ts`, `web/src/api.ts`, `web/src/pages/Fiche.tsx`, `web/src/pages/atelier/AtelierVue.tsx` (liens vers la fiche entreprise)
- Test: `src/crm/fiches.test.ts` (cas ajoutés), `web/src/pages/Fiche.test.tsx` (cas ajoutés)

**Interfaces:**
- Consumes: table de la tâche 1, `atelierActif`.
- Produces: `Fiche.ateliers?: AtelierLie[]` avec `AtelierLie = { id: string; titre: string; etape: number; date: string }` ; renseigné pour `entreprise` et `contact` (pour un contact : ateliers de `liens.entreprise.id`), seulement si `atelierActif(instance)`. Bloc « Ateliers stratégiques (n) » dans `Fiche.tsx`, lien `#/${slug}/atelier/ouvrir/${id}`. L'atelier ouvert affiche un lien vers `#/${slug}/fiche/entreprise/${entrepriseId}` (champ `entrepriseId` à ajouter à `AtelierListe` et à `getAtelier`).

- [ ] **Step 1: Write the failing tests** : service : `la fiche entreprise liste les ateliers de l'entreprise`, `la fiche contact liste ceux de son entreprise`, `sans module atelier : pas de champ ateliers`, `une fiche d'affaire n'a pas de champ ateliers`. Interface : `le bloc Ateliers stratégiques affiche un lien vers l'atelier`, `message vide : Aucun atelier lié`.
- [ ] **Step 2: Run** `npx vitest run src/crm/fiches.test.ts web/src/pages/Fiche.test.tsx` ; attendu : FAIL sur les nouveaux cas.
- [ ] **Step 3: Implement** dans `fiches.ts` à la suite du calcul de `diagnostics`, même style de requête ; bloc dans `Fiche.tsx` sur le modèle du bloc Diagnostics.
- [ ] **Step 4: Run** `npm run verify` ; attendu : tout vert.
- [ ] **Step 5: Commit** — `git commit -m "feat(atelier): liens depuis les fiches entreprise et contact"`.

### Task 8: Vérification dans le navigateur, activation et pull request

**Files:**
- Aucun fichier de code ; vérification et livraison.

- [ ] **Step 1: Démarrer l'OS en tâche de fond** (commande du `README.md`), activer le module sur l'instance de démonstration de type « propre » par `instance:module --slug <slug> --module atelier --on` (voir `src/admin/cli.ts`).
- [ ] **Step 2: Vérifier dans le navigateur** (données fictives) : l'entrée « Atelier stratégique » avec la pastille ; l'accueil à trois colonnes ; création d'un atelier, changement d'étape, rechargement de la page (l'étape est conservée) ; interrupteur d'écran partagé ; export JSON ; module d'essai (aucune requête d'écriture dans l'onglet réseau) ; import d'une sauvegarde fictive ; liens depuis la fiche entreprise. Contrôler la console sans erreur.
- [ ] **Step 3: Arrêter les processus lancés** et noter ceux qui tournent encore.
- [ ] **Step 4: Relire** `git diff origin/main --stat` et rechercher toute donnée réelle (noms, montants, textes de méthode) ; `npm run verify` une dernière fois.
- [ ] **Step 5: Ouvrir la PR** (`gh pr create`, description avec ce qui change, comment tester pas à pas, et la mention « données fictives seulement »), revue de code, CI verte, fusion dans `main` ; puis expliquer à Marc comment activer le module sur « Mon activité » et importer sa sauvegarde.
