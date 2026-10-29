# Idées en vrac et feuille de route de l'OS — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une catégorie « Idées en vrac » dans le second cerveau, une section « Feuille de route de l'OS » réservée à l'instance « Mon activité », et un second cerveau qui connaît la structure et les prochaines étapes de l'OS.

**Architecture:** Le Drive reste la référence. Les idées vont dans `brain/idees-en-vrac/` (le dossier devient une catégorie de la carte sans autre code que son libellé). La page lit et écrit deux notes du Drive par les opérations existantes `lire` / `ecrire` du second cerveau, déjà réservées à l'instance `propre` avec le module `cerveau`. Les idées « OS » sont repérées par `concerne: os` dans l'en-tête, remonté par la carte.

**Tech Stack:** TypeScript, Fastify, Zod, React + Vite, Vitest (`npm run verify`).

**Spec:** [docs/superpowers/specs/2026-10-29-idees-en-vrac-feuille-de-route-design.md](../specs/2026-10-29-idees-en-vrac-feuille-de-route-design.md)

## Global Constraints

- Dépôt public : données fictives uniquement dans le code, les tests et les docs. Les notes écrites dans le Drive ne citent aucun client réel ni secret.
- Le Drive est la seule source de la feuille de route et de la structure : aucune copie dans la base ni dans le dépôt.
- Écritures dans le Drive uniquement par `ecrireNote` / `ajouterIdee` (journal `log.md` inclus).
- Interface et docs en français ; ne rien ajouter au-delà du spec (pas de refactoring).
- Clé d'en-tête des idées pour le développement de l'OS : `concerne: os` (et non `sujet:`, déjà utilisé par les messages de l'espace partagé). Identifiant d'écran : `feuille-de-route-os` (`feuille-de-route` est pris par l'Atelier).
- Chemins des notes : `brain/outils/simatis-os-structure.md`, `brain/outils/simatis-os-feuille-de-route.md`.
- Branche : `feature/idees-en-vrac-feuille-de-route` (déjà créée, spec poussé). Avant chaque commit : relire `git diff --staged`, `git add` explicite, `npm run verify`.

## Review Focus

- Titre d'idée vide ou sans lettre (`!!!`) : refus du titre vide, nom de fichier `…_idee.md` sinon.
- `brain/idees-en-vrac/` ou son `index.md` absents au premier ajout : créés, sans erreur.
- Idée déjà promue : elle ne réapparaît plus dans la liste de la page.
- Note de feuille de route modifiée ailleurs pendant la promotion (conflit d'empreinte) : message de conflit, rien d'écrit sur l'idée.
- Seconde écriture de la promotion (marquer l'idée) en échec : l'étape existe, l'écran le dit.
- Accès direct à l'écran par l'URL depuis un mandat ou une démo : page « non disponible », aucune opération envoyée.
- Case « Concerne l'OS » dans l'espace partagé : absente, `concerne` jamais envoyé.

---

### Task 1: Catégorie « Idées en vrac » et champ `concerne` sur la carte

**Files:**
- Modify: `src/cerveau/carte.ts` (type `Noeud`, `carteDepuisNotes`)
- Modify: `src/cerveau/routes.ts` (schéma `carteSchema`)
- Modify: `web/src/cerveau.ts` (`NoeudCerveau`, `CATEGORIES`)
- Test: `src/cerveau/carte.test.ts`, `src/cerveau/routes.test.ts`

**Interfaces:**
- Produces: `Noeud.concerne: string | null` (valeur de `concerne:` dans l'en-tête, sinon `null`) ; `NoeudCerveau.concerne?: string | null` côté web ; catégorie `'idees-en-vrac'` dans `CATEGORIES` (libellé « Idées en vrac », couleur `#e0a526`).

- [ ] **Step 1: Write the failing tests**
  - Dans `carte.test.ts` : `it('classe brain/idees-en-vrac/ comme catégorie propre et lit concerne')` : `carteDepuisNotes([{ id: 'brain/idees-en-vrac/2026-10-29_x.md', texte: '---\nstatut: draft\nconcerne: os\n---\n\n# Idée fictive' }, { id: 'brain/clients/a.md', texte: '# A' }])` ; attendre `noeuds[0]` = `{ categorie: 'idees-en-vrac', statut: 'draft', concerne: 'os', titre: 'Idée fictive' }` et `noeuds[1].concerne` = `null`.
  - Dans `routes.test.ts`, étendre le test de dépôt de carte existant : un nœud avec `concerne: 'os'` est accepté (200) et ressort tel quel de `GET …/cerveau/carte`.
- [ ] **Step 2: Run** `npx vitest run src/cerveau/carte.test.ts src/cerveau/routes.test.ts` — Expected: FAIL (`concerne` absent).
- [ ] **Step 3: Implement** — `Noeud` gagne `concerne: string | null` ; helper `concerneDe(texte)` calqué sur `statutDe` (`/^concerne:\s*(\S+)/m` dans l'en-tête) ; `carteSchema.noeuds` gagne `concerne: z.string().max(50).nullable().optional()`. Côté web : `NoeudCerveau.concerne?: string | null`, entrée `'idees-en-vrac': { libelle: 'Idées en vrac', couleur: '#e0a526' }` dans `CATEGORIES`. Corriger les fixtures existantes que le type refuse.
- [ ] **Step 4: Run** les mêmes tests plus `npx vitest run web/src/cerveau.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(cerveau): catégorie Idées en vrac et champ concerne sur la carte`.

---

### Task 2: Les idées vont dans `idees-en-vrac`, avec la case « Concerne l'OS »

**Files:**
- Modify: `src/cerveau/fichiers.ts` (`ajouterIdee`)
- Modify: `src/cerveau/file.ts` (type `Operation`, appel de `ajouterIdee`)
- Modify: `src/cerveau/routes.ts` (`operationSchema`, variante `ajouter`)
- Modify: `web/src/api.ts` (`OperationCerveau`)
- Modify: `web/src/pages/NoteCerveau.tsx` (`IdeeCerveau`)
- Test: `src/cerveau/fichiers.test.ts`, `src/cerveau/operations.routes.test.ts`, `web/src/pages/Cerveau.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`concerne` dans les en-têtes).
- Produces: `ajouterIdee(dossier, idee: { titre: string; texte: string; concerne?: 'os' }, maintenant?): Promise<{ chemin: string }>` — écrit `brain/idees-en-vrac/AAAA-MM-JJ_<slug>.md` ; opération `{ espace?, type: 'ajouter', titre, texte, concerne?: 'os' }`.

- [ ] **Step 1: Write the failing tests**
  - `fichiers.test.ts` (adapter les deux tests `ajouterIdee` existants au nouveau dossier) : chemin `brain/idees-en-vrac/2026-10-29_idee-offre-a-la-carte.md`, index `brain/idees-en-vrac/index.md` contenant `- [Idée : offre à la carte](2026-10-29_idee-offre-a-la-carte.md)`, journal à jour. Nouveaux : (a) dossier et index créés alors qu'ils n'existent pas (le `beforeEach` ne crée que `brain/inbox`) — l'index commence par `# Idées en vrac` ; (b) `concerne: 'os'` → l'en-tête contient `concerne: os`, sans `concerne` → l'en-tête ne contient pas `concerne:` ; (c) titre `!!!` → fichier `2026-10-29_idee.md`.
  - `operations.routes.test.ts` : l'ajout répond un chemin `^brain\/idees-en-vrac\/.*idee-fictive\.md$` ; `{ type: 'ajouter', titre: 'x', texte: 'y', concerne: 'autre' }` → 400 ; `concerne: 'os'` → 200 (le test crée `brain/idees-en-vrac` seulement via l'ajout).
  - `Cerveau.test.tsx` : le test « dépose une idée dans l'inbox » devient « dépose une idée dans les idées en vrac » : bouton `Déposer dans les idées en vrac`, chemin `brain/idees-en-vrac/…` ; nouveau test : cocher `Concerne le développement de l'OS` envoie `{ espace: 'simatis', type: 'ajouter', titre, texte, concerne: 'os' }` ; dans l'espace partagé la case n'existe pas et le corps n'a pas de `concerne`.
- [ ] **Step 2: Run** `npx vitest run src/cerveau web/src/pages/Cerveau.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** — `ajouterIdee` : dossier `brain/idees-en-vrac`, `mkdir -p` avant écriture, index par défaut `# Idées en vrac\n`, ligne `concerne: os` ajoutée à l'en-tête seulement si demandée, texte du journal « idée … déposée dans les idées en vrac par Marc depuis l'OS, draft ». `Operation` et `operationSchema` : `concerne: z.literal('os').optional()` sur la variante `ajouter` ; `executer` transmet l'opération entière à `ajouterIdee`. `IdeeCerveau` : case à cocher visible hors espace partagé, libellé du bouton `Déposer dans les idées en vrac`, message de confirmation « Idée déposée dans les idées en vrac », `concerne: 'os'` n'est dans le corps que si cochée.
- [ ] **Step 4: Run** `npx vitest run src/cerveau web/src/pages/Cerveau.test.tsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(cerveau): les idées vont dans Idées en vrac, case Concerne l'OS`.

---

### Task 3: Fonctions pures de la feuille de route

**Files:**
- Create: `web/src/feuilleDeRouteOS.ts`
- Test: `web/src/feuilleDeRouteOS.test.ts`

**Interfaces:**
- Consumes: `NoeudCerveau` (Task 1).
- Produces:
  - `NOTE_STRUCTURE`, `NOTE_FEUILLE` (les deux chemins ci-dessus) ;
  - `idéesOS(noeuds: NoeudCerveau[]): NoeudCerveau[]` — catégorie `idees-en-vrac`, `concerne === 'os'`, `statut === 'draft'` ;
  - `ajouterEtape(feuille: string, titre: string, cheminIdee: string): string` — ajoute en fin de note (une ligne vide avant si besoin, fin de fichier `\n`) la ligne `- à faire — [<titre>](../idees-en-vrac/<fichier>)`, `<fichier>` = nom de `cheminIdee` ;
  - `marquerPromue(idee: string): string` — remplace `statut: draft` par `statut: promue` dans l'en-tête (et seulement là) ; renvoie le texte inchangé s'il n'y a pas d'en-tête draft.

- [ ] **Step 1: Write the failing tests** — `idéesOS` : ne garde que l'idée `concerne: 'os'` en `draft` parmi quatre nœuds (promue, autre catégorie, sans `concerne`) ; `ajouterEtape('# Feuille\n\n- fait — x', 'Idée fictive', 'brain/idees-en-vrac/2026-10-29_idee-fictive.md')` se termine par `\n- à faire — [Idée fictive](../idees-en-vrac/2026-10-29_idee-fictive.md)\n` et conserve le début ; `marquerPromue('---\nstatut: draft\n---\n\n# T\n\nstatut: draft dans le corps')` change l'en-tête mais pas la ligne du corps.
- [ ] **Step 2: Run** `npx vitest run web/src/feuilleDeRouteOS.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** les trois fonctions et deux constantes, sans dépendance.
- [ ] **Step 4: Run** le même test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(os): fonctions de la feuille de route (idées OS, étape, promotion)`.

---

### Task 4: Page « Feuille de route de l'OS » et bouton en bas de la barre latérale

**Files:**
- Create: `web/src/pages/FeuilleDeRouteOS.tsx`
- Modify: `web/src/App.tsx` (cas `'feuille-de-route-os'` dans `page()`, titre « Feuille de route de l'OS »)
- Modify: `web/src/shell/Sidebar.tsx` (bouton sous `</nav>`)
- Modify: `web/src/styles.css` (style du bouton fixe, repli compris : `.side.reduite`)
- Test: `web/src/pages/FeuilleDeRouteOS.test.tsx`, `web/src/shell/Sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 3 ; `operationCerveau(slug, op)`, `fetchCarteCerveau(slug)` (`web/src/api.ts`) ; `NoteCerveau` (`onFerme`, `onEnregistre`) pour l'édition.
- Produces: `FeuilleDeRouteOS({ slug, autorise }: { slug: string; autorise: boolean })` ; lien `#/<slug>/feuille-de-route-os`, affiché seulement si `current.type === 'propre' && current.modules.includes('cerveau')`.

- [ ] **Step 1: Write the failing tests**
  - `Sidebar.test.tsx` : avec `simatis` + `modules: ['cerveau']` le lien `Feuille de route de l'OS` existe et est après `nav` dans le DOM ; sans le module, ou pour `mandat` : absent.
  - `FeuilleDeRouteOS.test.tsx` (fetch simulé comme `Cerveau.test.tsx`) :
    1. affiche le texte des deux notes lues (`lire` des deux chemins) et, sous la feuille, les seules idées OS en draft de la carte ;
    2. « Modifier » ouvre l'éditeur `NoteCerveau` de la note, « Fermer » le ferme ;
    3. « Promouvoir en étape » envoie dans l'ordre : `lire` feuille, `ecrire` feuille (contenu = `ajouterEtape(…)`, bonne empreinte), `lire` idée, `ecrire` idée (contenu = `marquerPromue(…)`) ; l'idée disparaît de la liste ;
    4. conflit (409) sur la première écriture : message de conflit affiché, **aucune** écriture sur l'idée ;
    5. échec de la seconde écriture : texte « L'étape a été ajoutée, mais l'idée n'a pas pu être marquée comme promue » ;
    6. erreur de lecture (note absente) : le message d'erreur s'affiche, la page ne plante pas ;
    7. avec `autorise={false}` (accès direct par l'URL depuis un mandat ou une démo) : le texte « Cette section n'est pas disponible dans cet espace. » s'affiche et aucun appel réseau n'est fait.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/FeuilleDeRouteOS.test.tsx web/src/shell/Sidebar.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** — la page lit les deux notes et la carte au montage (`Promise.allSettled`, erreurs par bloc), affiche chaque note dans un `<pre className="cerveau-texte">` avec un bouton « Modifier » qui monte `NoteCerveau`, recharge au `onEnregistre`. `promouvoir(idee)` : séquence du test 3, arrêt à la première erreur. `App.tsx` : le cas passe `autorise={current.type === 'propre' && current.modules.includes('cerveau')}` ; le titre vient d'un cas dédié comme `portefeuille`. `Sidebar.tsx` : `<a className="side-feuille" href=…>` après le `<nav>`, avec `Icon name="map"` ; `view === 'feuille-de-route-os'` le met en `active` ; libellé masqué quand la barre est réduite, comme les autres entrées.
- [ ] **Step 4: Run** les mêmes tests plus `npx vitest run web/src/nav.test.ts` — Expected: PASS. Vérification dans le navigateur (`preview_start`, instance Mon activité puis un mandat) : bouton visible et page rendue seulement dans Mon activité.
- [ ] **Step 5: Commit** `feat(os): section Feuille de route de l'OS, réservée à Mon activité`.

---

### Task 5: Garde serveur sur les deux notes

**Files:**
- Test: `src/cerveau/operations.routes.test.ts`

**Interfaces:**
- Consumes: la garde `acces` existante de `routes.ts` (instance `propre` + module `cerveau`).

- [ ] **Step 1: Write the test** — `it('refuse lire et ecrire sur les notes de la feuille de route hors de Mon activité')` : instances `op-mandat` (type `mandat`, module `cerveau` actif) et `op-demo` (type `prospect`) ; pour chacune, `lire` puis `ecrire` sur `brain/outils/simatis-os-feuille-de-route.md` et `…-structure.md` répondent 403 (via `app.inject` direct, sans runner). Le test vérifie aussi que `op-ok` (propre) lit la note créée dans le dossier de test.
- [ ] **Step 2: Run** `npx vitest run src/cerveau/operations.routes.test.ts` — Expected: PASS sans code applicatif (la garde existe déjà). Si un cas échoue, corriger `acces`.
- [ ] **Step 3: Commit** `test(cerveau): garde serveur sur les notes de la feuille de route`.

---

### Task 6: Contenu du second cerveau, `AGENTS.md`, skill Inbox

**Files:**
- Create (Drive, via l'opération `ecrire`/écriture directe du dossier `SECOND_CERVEAU_DIR` du poste) : `brain/outils/simatis-os-structure.md`, `brain/outils/simatis-os-feuille-de-route.md`, `brain/idees-en-vrac/index.md`
- Modify (Drive) : `brain/outils/simatis-os-etat.md`, `brain/outils/index.md`, `log.md`, `skills/alimenter-inbox/SKILL.md`
- Modify (dépôt) : `AGENTS.md` (section « Gestion de git »)

**Interfaces:** aucune ; livrable = notes lisibles par la page de la Task 4.

- [ ] **Step 1: Relever la structure** depuis le dépôt (`src/*` par module, `web/src/pages`, `docs/plan.md`, specs et plans récents, `git log` des PR 98 à 176) et écrire `simatis-os-structure.md` : par bloc (socle, instances et modules, Inbox, Diagnostic et Tests VMA, Atelier, Bases vivantes, Site web, Second cerveau et espace partagé, Routines et exécuteur, connexions), son rôle, son module d'activation, son dossier dans le dépôt, ses liens avec les autres blocs. En-tête `type: Reference`, `status: draft`, date, aucune donnée réelle.
- [ ] **Step 2: Écrire `simatis-os-feuille-de-route.md`** — étapes à faire / en cours / faites, avec le statut en début de ligne au format `- à faire — titre` ; première liste tirée des « restes à faire » connus : transfert d'instance 2b (filtres des listes) et rôle base dédié, refonte fiches et RDV (participants, onglets Rendez-vous/Email, table `rdv_liens` à supprimer), base vivante et routines sur `contacts.email` seul, routine Inbox pour Wispr Flow, plan d'action (M3), Détection (M4), Autonomie, Journal d'audit, M7. Ne rien inventer : chaque ligne vient d'une note mémoire, d'un spec ou de `docs/plan.md`.
- [ ] **Step 3: Mettre à jour** `simatis-os-etat.md` (date, état à la PR 176, renvois vers les deux notes), ajouter les deux notes et le dossier `idees-en-vrac/` dans `brain/outils/index.md`, et une entrée datée dans `log.md`.
- [ ] **Step 4: Skill `alimenter-inbox`** — ajouter la consigne : lister les notes `draft` de `brain/idees-en-vrac/` comme sujets à transformer en action concrète (les idées `concerne: os` renvoient à la page Feuille de route de l'OS). Lire le skill en entier avant de le modifier ; consigner la modification dans `log.md`.
- [ ] **Step 5: `AGENTS.md`** — dans « Gestion de git », ajouter : « Fin de feature : mettre à jour dans le second cerveau `brain/outils/simatis-os-structure.md` et `simatis-os-feuille-de-route.md` (via l'exécuteur ou l'opération `ecrire`). » Relire `git diff --staged` : aucun contenu du second cerveau n'est copié dans le dépôt.
- [ ] **Step 6: Commit** (dépôt seulement) `docs(agents): tenir à jour la structure et la feuille de route de l'OS`.

---

### Task 7: Vérification, PR, merge, reconstruction

- [ ] **Step 1:** `npm run verify` — Expected: tout vert (format, lint, types, tests, build).
- [ ] **Step 2:** Ouvrir la PR, faire la revue de code (corriger ce qui sort), suivre la CI jusqu'au vert, merger dans `main` (règles de `AGENTS.md`).
- [ ] **Step 3:** Reconstruire l'app et relancer le conteneur depuis `origin/main` (note mémoire « Reconstruire l'app après merge »), arrêter les serveurs de dev lancés.
- [ ] **Step 4:** Expliquer à Marc, pas à pas, comment tester : ajouter une idée « Concerne l'OS », la voir sur la carte et dans la page, la promouvoir, vérifier l'absence du bouton dans un mandat.
