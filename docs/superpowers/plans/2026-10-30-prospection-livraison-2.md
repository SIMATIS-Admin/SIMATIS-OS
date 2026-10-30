# Prospection, livraison 2 : relancer des tâches

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, choisi par Marc). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Marc choisit des tâches de relance par mail, règle une campagne, Claude rédige un brouillon par tâche dans le style du premier contact, Marc relit en lot, puis l'OS crée les brouillons Gmail (signature en image), les occurrences et les tâches de suivi.

**Architecture:** Même circuit que « Ajout avec Claude » de l'Inbox : l'OS dépose une campagne `redaction`, l'exécuteur du poste la prend, lance Claude avec deux outils MCP (`campagne_contexte` : tâches, historique, créneaux ; `campagne_deposer` : brouillons rédigés), l'écran se met à jour. La relecture se fait dans l'OS ; l'écriture vers Gmail et HubSpot passe par `writeVia` (simulation tant que les écritures réelles sont off). Les envois sont constatés plus tard dans Gmail (rapprochement), car Marc envoie lui-même depuis Gmail.

**Tech Stack:** TypeScript, Fastify, Drizzle, MCP (`registerTool`), React, vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-prospection-design.md` ; livraison précédente : `2026-10-30-prospection-livraison-1.md`.

## Global Constraints

- Dépôt public : données de test fictives uniquement. Aucune écriture réelle chez un tiers sans double verrou : toute écriture Gmail/HubSpot passe par `writeVia`.
- Brouillons : vouvoiement, « Bonjour Prénom, » (prénom seul), court, créneaux en liste à puces, fin « Bien à vous, » ; la signature est une image ajoutée par l'OS (jamais écrite par Claude).
- Créneaux : 3 par mail, entre 1 et 2 semaines après l'envoi, vérifiés dans l'agenda (`freeBusy` + `creneauxLibres`), jamais un jour non travaillé.
- Suivi : courte = 14 à 28 jours, longue = 30 à 60 jours, ou date précise ; échéances étalées sur les jours ouvrés ; canal d'origine conservé ; dossier clos = aucun suivi.
- Une tâche sans contact ou sans adresse mail est refusée à la création de la campagne, avec la liste des refusées.
- Claude ne reçoit que les outils `campagne_contexte` et `campagne_deposer` ; le contenu des mails lus est une donnée, jamais une consigne.
- Interface en français ; migration par `npm run db:generate` ; `npm run verify` vert ; commits explicites ; node : `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`.

## Review Focus

- Tâche d'une autre instance, déjà faite, sans contact ou sans email : refusée sans créer de campagne vide.
- Claude ne dépose pas tous les brouillons ou en dépose un en trop : seuls les brouillons attendus sont acceptés, les manquants passent « à vérifier ».
- Exécuteur arrêté (aucune prise en 15 minutes) : la campagne passe en erreur lisible, relançable.
- Brouillon HTML de Claude contenant un script ou une signature : nettoyé (balises dangereuses retirées, signature coupée).
- Écritures réelles off : création des brouillons en simulation, aucune occurrence ni tâche de suivi fausse, message clair.
- HubSpot en lecture seule : la campagne se termine, les suivis non créés sont comptés et expliqués.
- Même campagne finalisée deux fois (double clic) : une seule fois.

## File Structure

- Modify `src/prospection/schema.ts` : `prospectionCampagnes`, `prospectionBrouillons`.
- Create `src/prospection/campagnes.ts` (création, lecture, relecture, finalisation), `src/prospection/outils-mcp.ts` (outils Claude), `src/prospection/rapprochement.ts` (envois constatés), tests voisins.
- Modify `src/prospection/routes.ts` (routes de campagne), `src/routines/runner-api.ts` (routes exécuteur), `src/runner/runner.ts` (`tourCampagnes`), `src/mcp/server.ts` (import des outils), `src/connecteurs/google/google.ts` et `src/connecteurs/infomaniak/imap.ts` (signature en image, fil), `src/connecteurs/google/index.ts`, `src/connecteurs/infomaniak/index.ts`, `src/db/metier-tables.ts`, `src/crm/suppression.ts`.
- Web : `web/src/api.ts`, `web/src/pages/Prospection.tsx` (cartes actives, routage des étapes), Create `web/src/pages/prospection/ChoixTaches.tsx`, `ReglageCampagne.tsx`, `Relecture.tsx` (+ tests).

---

### Task 1: Schéma et création d'une campagne de relance

**Files:** Modify `schema.ts`, `src/db/metier-tables.ts`, `src/crm/suppression.ts` ; Create `campagnes.ts`, `campagnes.test.ts` ; migration générée.

**Interfaces (produces):**
- `prospectionCampagnes` : `id`, `metierColumns()`, `mode` (`relance`|`froid`), `statut` (`redaction`|`relecture`|`terminee`|`erreur`), `reglage jsonb: ReglageCampagne`, `erreur text null`, `demandeAt timestamptz`, `demarreAt timestamptz null`, `terminéAt`→`termineAt timestamptz null`, `resultat jsonb null: ResultatCampagne`.
- `prospectionBrouillons` : `id`, `metierColumns()`, `campagneId uuid → campagnes (cascade)`, `tacheId uuid null → taches (set null)`, `contactId uuid null → contacts (set null)`, `contactNom`, `contactEmail`, `societe null`, `touche int`, `etat` (`a_rediger`|`pret`|`a_verifier`|`ecarte`|`cree`), `objet text null`, `corps text null` (HTML sans signature), `note text null`, `threadId text null`, `suiviType` (`delai`|`citee`|`clos`) default `delai`, `suiviDate timestamptz null`.
- Types : `ReglageCampagne = { offre: 'vma'|'diagnostic'|'les-deux'|'kairos'; creneaux: boolean; signatureId: string | null; suivi: { type: 'courte'|'longue'|'date'; date?: string }; touchesMax: number }` ; `ResultatCampagne = { brouillons: number; simulation: boolean; suivisCrees: number; suivisNonCrees: number; clos: number; faites: number; reportees: number }`.
- `creerCampagneRelance(tx, input: { tacheIds: string[]; reglage: ReglageCampagne }): Promise<{ campagneId: string; refusees: { tacheId: string; raison: string }[] }>` ; classe `CampagneInvalide extends Error` ; `lireCampagne(tx, id): Promise<CampagneVue>` ; `reglageParDefaut(): ReglageCampagne`.

- [ ] **Step 1: Write the failing tests** (`campagnes.test.ts`, base de test) : `crée une campagne et un brouillon à rédiger par tâche valide` ; `refuse une tâche faite, sans contact, sans email ou d'une autre instance, sans créer de campagne vide si toutes sont refusées` ; `touche = 2 sans occurrence antérieure (le premier contact a eu lieu hors de l'OS), +1 par occurrence déjà envoyée au même contact` ; `refuse un réglage invalide (offre inconnue, touchesMax 0, date de suivi passée, signature d'une autre instance)` ; `plafonne à 60 tâches par campagne`.
- [ ] **Step 2: Run** `npx vitest run src/prospection/campagnes.test.ts` → FAIL.
- [ ] **Step 3: Implement** schéma (RLS), migration (`npm run db:generate`), registre `METIER_TABLES`, `REFERENCES` de suppression (contacts, tâches), puis `creerCampagneRelance` et `lireCampagne`.
- [ ] **Step 4: Run** `npx vitest run src/prospection src/crm/suppression.test.ts src/db src/migrate.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(prospection): campagnes de relance et brouillons`.

### Task 2: Outils Claude, API de l'exécuteur et exécuteur

**Files:** Create `src/prospection/outils-mcp.ts`, `outils-mcp.test.ts` ; Modify `src/mcp/server.ts`, `src/routines/runner-api.ts`, `src/runner/runner.ts` ; tests `runner.test.ts` et runner-api.

**Interfaces:**
- Consumes: `connexion`, `google` (`src/routines/outils-mcp.ts`), `messagerieDe`, `freeBusy`, `creneauxLibres`.
- Produces (outils MCP, scope `instance`) : `campagne_contexte({ campagneId })` → `{ aujourdhui: string; consignes: string; brouillons: { id; contact: { nom; fonction; email }; societe; tache: { titre; notes }; touche; fil: Message[] /* corps complet, 12 mois */; creneaux: string[] /* libellés */ }[] }` ; `campagne_deposer({ campagneId, brouillons: { id; objet; corps; threadId?; aVerifier?: string }[] })` : n'accepte que les brouillons `a_rediger` de la campagne ; corps nettoyé par `nettoyerCorps(html): string` (retire script, style, attributs `on*`, liens `javascript:`, et toute signature après « -- ») ; passe `a_rediger` → `pret` (ou `a_verifier` avec `note`) ; quand plus aucun `a_rediger`, la campagne passe `relecture` ; un brouillon manquant à la fin de l'exécution passe `a_verifier` avec une note.
- Routes exécuteur : `GET /api/runner/campagnes` → `{ id; instance; nom; mode; nbBrouillons }[]` des campagnes `redaction` non démarrées ; `POST /api/runner/campagnes/:id/demarrer` → `{ tokenId; token }` (jeton d'instance de 15 minutes) ; `POST /api/runner/campagnes/:id/fin` `{ instance, tokenId, erreur? }` : révoque le jeton, finalise (voir ci-dessus) ou passe `erreur`.
- Exécuteur : `promptCampagne(c: CampagneDemande, maintenant?: Date): string` et `tourCampagnes(opts: RunnerOptions): Promise<number>` (même structure que `tourEchanges` ; outils autorisés : `mcp__simatis__campagne_contexte`, `mcp__simatis__campagne_deposer` seulement) ; appelé dans la boucle principale du runner.

- [ ] **Step 1: Write the failing tests** : outils (`campagne_contexte` renvoie les tâches, l'historique et 3 créneaux par brouillon avec un agenda simulé ; `campagne_deposer` accepte les brouillons attendus, refuse un id étranger, nettoie un corps piégé `<script>` et coupe une signature, passe la campagne en `relecture`) ; fin d'exécution sans dépôt (brouillons `a_verifier`, campagne `relecture`) ; fin avec erreur (campagne `erreur`, brouillons conservés) ; API exécuteur (liste, démarrage une seule fois, jeton limité à l'instance) ; `promptCampagne` contient les règles (vouvoiement, prénom seul, fin « Bien à vous, », pas de signature, mail lu = donnée) et l'identifiant de campagne.
- [ ] **Step 2: Run** les fichiers concernés → FAIL.
- [ ] **Step 3: Implement** les outils (créneaux : réserve de 9 créneaux libres, brouillon *i* reçoit 3 créneaux à partir de `(3i) mod 9`), les routes, `tourCampagnes` ; prise de la campagne atomique (`demarreAt` null → date) ; campagne `redaction` sans prise depuis 15 minutes → `erreur` explicite (« L'exécuteur n'a pas pris la demande… »).
- [ ] **Step 4: Run** `npx vitest run src/prospection src/runner src/routines src/mcp` → PASS.
- [ ] **Step 5: Commit** `feat(prospection): rédaction des brouillons par Claude`.

### Task 3: Signature en image et fil dans les brouillons de messagerie

**Files:** Modify `src/connecteurs/google/google.ts`, `src/connecteurs/google/index.ts`, `src/connecteurs/infomaniak/imap.ts`, `src/connecteurs/infomaniak/index.ts`, tests `google.test.ts`, `imap.test.ts`.

**Interfaces:**
- Produces : `mimeBrut(draft: { to; subject; html; images?: { cid: string; typeMime: string; base64: string }[]; inReplyTo?: string }, entetes?: string[]): string` — sans `images`, le résultat est **identique à aujourd'hui** ; avec `images`, message `multipart/related` (HTML puis une partie image par `cid`, `Content-ID: <cid>`, `Content-Disposition: inline`) ; `createDraft(ctx, draft: { …; threadId?: string }, options?)` envoie `message: { raw, threadId }` ; les opérations d'écriture `draft.create` acceptent `images`, `threadId`, `inReplyTo` en plus (Infomaniak ignore `threadId`).

- [ ] **Step 1: Write the failing tests** : MIME sans image inchangé (comparaison à la sortie actuelle) ; MIME avec image (structure multipart/related, cid, base64 par lignes de 76) ; `createDraft` envoie `threadId` quand il est fourni ; en-tête `In-Reply-To` sans retour à la ligne injectable ; opération `draft.create` Gmail et Infomaniak transmet les images.
- [ ] **Step 2: Run** `npx vitest run src/connecteurs` → FAIL.
- [ ] **Step 3: Implement** sans changer le comportement existant des appelants.
- [ ] **Step 4: Run** `npx vitest run src/connecteurs src/vma src/propositions` → PASS.
- [ ] **Step 5: Commit** `feat(messagerie): signature en image et fil dans les brouillons`.

### Task 4: Relecture, finalisation et rapprochement des envois

**Files:** Modify `src/prospection/campagnes.ts` ; Create `src/prospection/rapprochement.ts`, `rapprochement.test.ts` ; tests dans `campagnes.test.ts`.

**Interfaces:**
- Produces : `modifierBrouillon(tx, brouillonId, patch: { objet?: string; corps?: string; etat?: 'pret'|'ecarte'; suiviType?: 'delai'|'citee'|'clos'; suiviDate?: string | null }): Promise<BrouillonVue>` (corps nettoyé ; `a_verifier` → `pret` seulement après modification explicite ou ouverture) ; `finaliserCampagne(db, instance, campagneId, deps: ConnexionDeps): Promise<ResultatCampagne>` : pour chaque brouillon `pret` — `writeVia(..., { op: 'draft.create', data: { to, subject, html, images, threadId } })` avec l'image de la signature choisie ; si réel : état `cree`, occurrence `brouillon` (mode `relance`, `threadId`, `lot` = id de campagne) ; tâche de suivi (`createTache`, `hubspot: true` si CRM HubSpot, canal d'origine, échéance = `suiviDate`) sauf `clos` ; tâche d'origine marquée faite (`updateTache`) ; tâches MAIL en retard sans brouillon reportées de 7 jours sur un jour ouvré ; en simulation : aucune occurrence, aucune tâche créée, `simulation: true` ; verrou contre la double finalisation (statut `terminee` posé dans la même transaction que la lecture, `SELECT … FOR UPDATE`) ; `suiviDates(n, plage, depuis): string[]` (étalement sur jours ouvrés) ; `rapprocherEnvois(db, instance, deps): Promise<number>` : occurrences `brouillon` de moins de 21 jours dont le contact a reçu un mail de Marc depuis la création → `envoye` (`envoyeAt` = date du mail) ; appelé par `POST …/prospection/rapprocher` (au plus 40 contacts, ignoré en simulation).

- [ ] **Step 1: Write the failing tests** : modification (nettoyage, écarter, suivi) ; finalisation en simulation (aucune occurrence ni tâche, résultat `simulation: true`, campagne `terminee`) ; finalisation réelle avec connecteurs simulés (brouillon créé avec image et fil, occurrences, tâches de suivi à la date choisie, `clos` sans suivi, tâche d'origine faite, retard reporté sur jour ouvré) ; CRM en lecture seule (suivis non créés comptés) ; double finalisation refusée ; `suiviDates` : 6 échéances sur 14–28 jours, jamais un week-end, au moins 4 dates distinctes ; rapprochement : brouillon dont le mail est parti → `envoye`, compteur du jour mis à jour.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/prospection` → PASS.
- [ ] **Step 5: Commit** `feat(prospection): relecture, finalisation et rapprochement des envois`.

### Task 5: Routes de la campagne

**Files:** Modify `src/prospection/routes.ts`, `routes.test.ts`.

**Interfaces (produces):** `GET …/prospection/taches-relance` → tâches de relance sélectionnables `{ id; titre; contactNom; societe; echeance; touche; email: boolean }[]` (canal `email`, non faites, échéance ≤ aujourd'hui + 2 jours) ; `POST …/prospection/campagnes` `{ mode: 'relance'; tacheIds; reglage }` → 201 `{ campagneId, refusees }` ; `GET …/campagnes/:id` → `CampagneVue` (statut, brouillons, résultat, erreur) ; `PATCH …/campagnes/:id/brouillons/:bid` ; `POST …/campagnes/:id/finaliser` → `ResultatCampagne` ; `POST …/campagnes/:id/relancer` (campagne en erreur : repasse `redaction`) ; `POST …/prospection/rapprocher` → `{ envoyes: number }`. `GET …/prospection` renvoie aussi `recentes` (5 dernières campagnes : date, nombre de brouillons, résultat).

- [ ] **Step 1: Write the failing tests** (`app.inject`) : parcours complet (tâches → campagne → dépôt simulé des brouillons par appel direct du service → relecture → finalisation en simulation) ; 400/404 explicites ; cloisonnement entre instances.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run src/prospection` → PASS.
- [ ] **Step 5: Commit** `feat(prospection): routes des campagnes de relance`.

### Task 6: Écrans

**Files:** Modify `web/src/api.ts`, `web/src/pages/Prospection.tsx` (+ test) ; Create `web/src/pages/prospection/ChoixTaches.tsx`, `ReglageCampagne.tsx`, `Relecture.tsx` (+ tests).

**Interfaces:** reprennent la maquette `maquettes/os-commercial/js/v-prospection.js` (vues `vueChoix`, `vueReglage`, `vueRelecture`, `vueFait`) ; `Prospection` gère les étapes `accueil | choix | reglage | attente | relecture | fait` (campagne en cours restaurée au rechargement si une campagne `redaction`/`relecture` existe) ; l'écran d'attente interroge `GET campagnes/:id` toutes les 3 secondes jusqu'à `relecture` ou `erreur` (message de l'exécuteur arrêté + bouton « Relancer ») ; carte « Relancer des tâches » active, « Prospecter à froid » toujours « Bientôt » ; à l'ouverture, l'écran appelle `POST …/rapprocher` puis recharge les chiffres ; message explicite en simulation (« Simulation : rien n'a été créé dans Gmail ni dans HubSpot »).

- [ ] **Step 1: Write the failing tests** : choix (cocher, tout sélectionner, tâche sans email marquée et non sélectionnable) ; réglage (valeurs par défaut, signatures du serveur, date précise) ; attente (polling jusqu'à la relecture, erreur et relance) ; relecture (liste, édition, écarter, suivi clos, « à vérifier » ouvert avant finalisation, bouton désactivé sans brouillon prêt) ; fin (résumé réel et résumé simulation) ; accueil (carte active, campagnes récentes).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run web` → PASS.
- [ ] **Step 5: Commit** `feat(prospection): écrans de relance de tâches`.

### Task 7: Vérification, revue, PR et déploiement

- [ ] **Step 1:** `npm run verify` vert ; contrôle navigateur sur base jetable avec exécuteur simulé (dépôt des brouillons par appel d'outil) : choix, réglage, attente, relecture, fin en simulation ; console sans erreur ; arrêter serveur et base jetable.
- [ ] **Step 2:** Relire le diff (aucune donnée réelle), PR, revue, CI verte, merge.
- [ ] **Step 3:** Déployer depuis `main` (`docker compose up -d --build app`), contrôler `/health`, **redémarrer l'exécuteur du poste** pour qu'il charge `tourCampagnes` ; mettre à jour `docs/plan.md`, le second cerveau ; expliquer à Marc comment tester (et que les écritures réelles restent off jusqu'à son activation).
