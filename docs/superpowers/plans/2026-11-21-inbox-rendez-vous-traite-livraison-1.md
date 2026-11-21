# Inbox « rendez-vous et sa suite » — livraison 1 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une visio enregistrée produit une seule entrée d'Inbox, rattachée au rendez-vous de l'agenda, avec l'interlocuteur identifié, un compte rendu lisible et modifiable, et un seul bouton « Acquitter ».

**Architecture:** `CompteRenduPrepare` (jsonb de `sujets.compte_rendu_prepare`, aucune migration) reçoit un champ optionnel `dossier`. Le dossier est calculé sans IA à partir de l'agenda et du CRM, puis donné à l'exécuteur pour rédiger avec le bon nom. L'écran affiche le dossier en trois zones ; l'acquittement étend `enregistrerDepuisSujet`.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres, RLS par instance), React, Vitest (base réelle via testcontainers : `setupTestApp`).

**Spec:** `docs/superpowers/specs/2026-11-21-inbox-rendez-vous-traite-design.md`

## Global Constraints

- Dépôt public : tests et fixtures avec des personnes, entreprises et adresses **fictives** uniquement (`@exemple.test`).
- Aucune migration : le dossier vit dans le jsonb existant.
- Une entrée ancienne (sans `dossier`) s'affiche et se traite comme avant (composant `CompteRendu` actuel).
- Aucune écriture externe sans acquittement ; la note du second cerveau passe par `propose` puis `decide`, donc par le dry-run et le double verrou (`canWriteReal`).
- Un texte modifié ou déjà proposé n'est jamais écrasé par un nouveau résumé (règle de `proposerResumeAuSujet`).
- Interface et messages en français. Commits : un par tâche, fichiers ajoutés explicitement (jamais `git add -A`), `npm run verify` avant chaque commit.

## Review Focus

- Résumé dont le texte n'a pas de retours à la ligne (une seule ligne avec des `**` et des ` - `) : l'écran doit rester lisible, jamais de `**` brut.
- Visio sans participants ni rendez-vous candidat : dossier vide, l'entrée se comporte comme avant, l'acquittement n'est pas bloqué.
- Deux contacts dont l'adresse ne diffère que par la casse, ou une adresse présente dans `contact_emails` mais pas dans `contacts.email` : un seul contact reconnu, sans doublon.
- Double clic sur « Acquitter » : un seul rendez-vous, un seul compte rendu, une seule note du second cerveau.
- Texte corrigé par Marc, puis nouveau résumé arrivant dans la même entrée : sa correction reste.

---

### Task 1: Dossier de rendez-vous (types et calcul)

**Files:**
- Modify: `src/inbox/schema.ts` (type `CompteRenduPrepare`, ~l.95)
- Create: `src/inbox/dossier-rdv.ts`
- Test: `src/inbox/dossier-rdv.test.ts`

**Interfaces:**
- Produces, dans `src/inbox/schema.ts` :
  ```ts
  export type DossierRdv = {
    sessionVisioId: string;
    sourceRdvEventId: string; // rendez-vous propre à la visio (souvent « os:… » libre)
    rdv: { eventId: string; titre: string; debut: string | null } | null;
    rdvCertain: boolean;
    candidats: { eventId: string; titre: string; debut: string | null }[];
    interlocuteurs: { contactId: string; nom: string; entreprise: string | null; principal: boolean }[];
  };
  export type CompteRenduPrepare = { texte: string; prepareeLe: string; dossier?: DossierRdv };
  ```
- Produces, dans `src/inbox/dossier-rdv.ts` :
  `construireDossier(tx: Tx, a: { sessionVisioId: string; rdvId: string; debutAt: Date; participants: string[] }): Promise<DossierRdv>` (`rdvId` = id interne du rendez-vous de la visio).

- [ ] **Step 1: Write the failing tests** (`dossier-rdv.test.ts`, fixtures via `fabrique(t).insere` comme `src/visio/enregistrement.test.ts`) :
  - `un rendez-vous de l'agenda proche et seul devient le rendez-vous certain` : `rdv.eventId` = celui de l'agenda, `rdvCertain === true`, `candidats` vide.
  - `deux rendez-vous proches sans invité commun : rien de pré-choisi` : `rdv === null`, `rdvCertain === false`, `candidats` a 2 entrées.
  - `deux proches dont un partage un invité : celui-là est certain` (règle `plusProche`).
  - `les rendez-vous « ignore » et « os: » ne sont jamais candidats`.
  - `interlocuteur = contact lié au rendez-vous retenu`, `principal === true`, `entreprise` = nom de son entreprise.
  - `à défaut de lien, l'adresse d'un invité reconnue dans contact_emails ou contacts.email, casse ignorée` (Review Focus 3) : un seul contact, même si les deux tables le contiennent.
  - `aucun participant ni candidat : dossier vide` (Review Focus 2) : `interlocuteurs` `[]`, `rdv` `null`.
  - `isolation : un contact d'une autre instance n'est jamais reconnu`.
- [ ] **Step 2: Run** `npx vitest run src/inbox/dossier-rdv.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `construireDossier`. Rendez-vous candidats : mêmes filtres que `candidatsRendezVous` (`src/inbox/compte-rendu.ts`) mais fenêtre `PROCHE_MS` autour de `debutAt`, et réutiliser `plusProche` (`src/conversion/reunion-rdv.ts`) pour le choix certain. Si le rendez-vous de la visio n'est pas libre (`source !== SOURCE_RDV_LIBRE`), il est lui-même le rendez-vous certain. Interlocuteurs : `rdv_contacts` du rendez-vous retenu (via `liensDe` de `src/conversion/rdv.ts`, à exporter), sinon adresses des `participants` comparées en minuscules à `contacts.email` et `contact_emails.email` ; le premier trouvé est `principal`.
- [ ] **Step 4: Run** la même commande — Expected: PASS.
- [ ] **Step 5: Commit** `feat(inbox): dossier de rendez-vous (rendez-vous probable et interlocuteurs)`.

### Task 2: Le dossier suit le résumé, l'exécuteur reçoit l'interlocuteur

**Files:**
- Modify: `src/visio/resume.ts` (`sessionsAResumer`, `poserResume`), `src/inbox/sujet-rdv.ts` (`proposerResumeAuSujet`), `src/visio/resume.routes.ts`, `src/runner/resume.ts`, `Resources/prompt-synthese-visio.md`
- Test: `src/visio/resume.test.ts`, `src/runner/resume.test.ts` (créer s'il n'existe pas)

**Interfaces:**
- Consumes: `construireDossier` (Task 1).
- Produces:
  - `proposerResumeAuSujet(tx: Tx, rdvId: string, resume: string, dossier?: DossierRdv): Promise<boolean>` : le champ `compteRenduPrepare` reçoit `{ texte, prepareeLe, dossier }` ; toujours sans écraser un champ déjà rempli.
  - `GET /api/runner/resumes` : chaque élément gagne `interlocuteurs: { nom: string; entreprise: string | null }[]`.
  - Côté exécuteur : `VisioAResumer.interlocuteurs?: { nom: string; entreprise: string | null }[]` ; `metadonnees()` gagne la clé `INTERLOCUTEURS` (« non identifié » si vide).

- [ ] **Step 1: Write the failing tests** :
  - `resume.test.ts` : `poserResume dépose un compte rendu préparé qui contient le dossier` (entrée créée `source: 'visio'`, `compteRenduPrepare.dossier.interlocuteurs[0].nom` présent, `contactId` de l'entrée = interlocuteur principal) ; `le résumé se range dans l'entrée ouverte de l'agenda avec le dossier` ; `un compte rendu déjà préparé n'est pas écrasé, dossier compris` (Review Focus 5) ; `GET /api/runner/resumes renvoie les interlocuteurs`.
  - `src/runner/resume.test.ts` : `promptResume contient le nom de l'interlocuteur dans le texte du prompt` ; `sans interlocuteur le prompt dit « non identifié »`.
- [ ] **Step 2: Run** `npx vitest run src/visio/resume.test.ts src/runner/resume.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** `sessionsAResumer` sélectionne aussi `rendezVousId`, `debut`, `participants` (déjà lus par la route : réutiliser). `poserResume` calcule `construireDossier` puis le passe à `proposerResumeAuSujet` ; pour une nouvelle entrée, `compteRenduPrepare` = résumé complet + dossier (le champ `resume` de l'entrée garde l'extrait de 2 000 caractères) et `contactId` = interlocuteur principal. Prompt `Resources/prompt-synthese-visio.md` : ajouter la ligne `Interlocuteur(s) : {{INTERLOCUTEURS}}` et la règle « nomme chaque interlocuteur par son prénom et accorde au genre de ce prénom ; formulation neutre si le doute existe ; jamais « le dirigeant… il » quand un nom est fourni ».
- [ ] **Step 4: Run** les mêmes tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(visio): le résumé porte le dossier et nomme l'interlocuteur`.

### Task 3: Acquittement d'une entrée avec dossier

**Files:**
- Modify: `src/inbox/compte-rendu.ts` (`compteRenduSujetSchema`, `enregistrerDepuisSujet`), `src/conversion/rdv.ts` (`enregistrerCompteRendu`, schéma d'entrée), `web/src/api.ts` (`compteRenduSujet`, type `compteRenduPrepare`)
- Test: `src/inbox/compte-rendu.test.ts`, `src/conversion/rdv.compte-rendu.test.ts` (créer si absent, ou suivre le fichier de tests de `enregistrerCompteRendu` existant)

**Interfaces:**
- Consumes: `DossierRdv` (Task 1), `fusionnerSession(tx, id, rdvEventId)` (`src/visio/enregistrement.ts`), `propose` et `decide` (`src/propositions/service.ts`).
- Produces:
  - `compteRenduSujetSchema` gagne `cerveau: z.boolean().default(false)` et `contactId: z.uuid().nullish()`.
  - `enregistrerCompteRendu` : l'option `accorde?: boolean`. Avec `versCerveau && accorde`, la proposition `note.second_cerveau` est créée puis validée par `decide(tx, ctx, p.id, { decision: 'valider', par: 'pilote' })` (seulement si `p.statut === 'proposee'`) ; une `PropositionRefusee` reste ignorée comme aujourd'hui.
  - Sans `accorde`, si une entrée ouverte porte un dossier dont `sourceRdvEventId` ou `rdv.eventId` est ce rendez-vous (jsonb `compte_rendu_prepare->'dossier'`), aucune des deux propositions n'est créée.

- [ ] **Step 1: Write the failing tests** :
  - `acquitter enregistre le compte rendu sur le rendez-vous retenu, lie contact et entreprise, et traite l'entrée`.
  - `acquitter avec cerveau coché écrit la note (proposition appliquée, aucune entrée « Second cerveau » ne reste ouverte)` ; `décoché : aucune note`.
  - `aucune tâche « Prochaine étape après le rendez-vous » n'est créée`.
  - `sans rendez-vous choisi, le rendez-vous est créé dans l'OS et l'acquittement réussit` ; `sans contact, aucun lien contact n'est posé` (anti-but : jamais de rattachement par supposition).
  - `acquitter deux fois (appels simultanés) : un seul rendez-vous, un seul compte rendu, une seule note` (Review Focus 4 ; la 2ᵉ réponse est `SujetRefuse('Sujet déjà traité.')`).
  - `quand le rendez-vous retenu diffère du rendez-vous libre de la visio, la session est fusionnée` (transcript repris, `fusionnerSession`).
  - `enregistrerCompteRendu sans accorde ne crée ni note ni tâche quand une entrée avec dossier est ouverte pour ce rendez-vous` ; `sans entrée ouverte, comportement inchangé`.
- [ ] **Step 2: Run** `npx vitest run src/inbox/compte-rendu.test.ts` et le fichier de `enregistrerCompteRendu` — Expected: FAIL.
- [ ] **Step 3: Implement.** Dans `enregistrerDepuisSujet` : après `lierRdv`, lier `input.contactId` en plus du contact de l'entrée ; appeler `enregistrerCompteRendu(..., { proposerTache: false, versCerveau: input.cerveau, accorde: true })` ; fusionner la session du dossier quand le rendez-vous libre diffère du retenu ; `marquerTraite` en dernier. Choix assumé : les étapes gardent leur transaction propre (déjà idempotentes : refaire met à jour le même rendez-vous) et l'entrée n'est traitée qu'à la fin, donc un échec en cours la laisse ouverte et rejouable.
- [ ] **Step 4: Run** les mêmes tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(inbox): acquittement d'un rendez-vous avec dossier`.

### Task 4: Écran « rendez-vous et sa suite »

**Files:**
- Create: `web/src/pages/inbox/DossierRendezVous.tsx`
- Modify: `web/src/pages/Inbox.tsx` (~l.508 : choisir le composant), `web/src/api.ts`
- Test: `web/src/pages/inbox/DossierRendezVous.test.tsx` (modèle : `CompteRendu.test.tsx` voisin)

**Interfaces:**
- Consumes: `SujetVue.compteRenduPrepare.dossier` (type `DossierRdv` recopié dans `web/src/api.ts`), `compteRenduSujet(slug, id, corps)` avec `corps: { eventId?: string; texte: string; cerveau: boolean; contactId?: string | null }`, `Markdown` de `web/src/cours/Markdown.tsx` (`resoudre={(src) => src}`).
- Produces: `DossierRendezVous({ slug, s, onAcquitter }: { slug: string; s: SujetVue; onAcquitter: (corps: …) => void })` ; `Inbox.tsx` l'affiche quand `s.compteRenduPrepare?.dossier` existe, sinon garde `CompteRendu`.

- [ ] **Step 1: Write the failing tests** :
  - `affiche trois zones : Déjà fait, Compte rendu, À l'acquittement`.
  - `rendez-vous certain : une ligne ✔ avec son titre ; sinon « Rendez-vous à choisir » et une liste des candidats, rien de sélectionné`.
  - `interlocuteur reconnu : une ligne ✔ avec le nom ; plusieurs : liste, le principal d'abord, « changer » propose les autres`.
  - `le compte rendu est rendu en titres et listes, sans ** visibles` ; `un texte sans retours à la ligne reste lisible, sans ** visibles` (Review Focus 1).
  - `Modifier ouvre le texte brut ; le texte corrigé est celui envoyé à l'acquittement`.
  - `Acquitter envoie { eventId, texte, cerveau: true, contactId }` ; décocher la ligne second cerveau envoie `cerveau: false` ; `le bouton est désactivé pendant l'envoi` (pas de double envoi).
  - `un dossier vide n'empêche pas d'acquitter`.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/inbox/DossierRendezVous.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** le composant avec les classes existantes (`stack`, `decision`, `btn go`, `small muted`). Texte sans retours à la ligne : avant le rendu, insérer un saut avant chaque `**Titre**` suivi d'un ` - ` et avant chaque ` - ` de liste ; ce traitement n'agit que sur l'affichage, jamais sur le texte envoyé.
- [ ] **Step 4: Run** le test, puis `npm run verify` — Expected: PASS partout.
- [ ] **Step 5: Vérifier dans le navigateur** (preview) avec une entrée fictive à dossier : trois zones, rendu du texte, modification, acquittement. Captures à l'appui.
- [ ] **Step 6: Commit** `feat(inbox): écran du rendez-vous et de sa suite`.

### Fin de livraison

- [ ] PR depuis `feature/inbox-rendez-vous-traite`, revue de code, CI verte, merge.
- [ ] Reconstruire et relancer le conteneur depuis `origin/main` ; **relancer l'exécuteur** (le runner change : prompt et interlocuteurs).
- [ ] Second cerveau : `brain/outils/simatis-os-structure.md` et `brain/outils/simatis-os-feuille-de-route.md` (livraison 1 faite, livraison 2 à venir), `log.md`, commit et push du clone.
- [ ] Expliquer à Marc, pas à pas, comment tester avec une visio.
