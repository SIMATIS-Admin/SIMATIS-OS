# Visio : création et enregistrement — plan d'implémentation (livraisons 1 et 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer une visio Google Meet nommée selon la nomenclature de Marc depuis l'OS, puis l'enregistrer depuis la fiche du rendez-vous et obtenir la transcription, sans service payant.

**Architecture:** L'OS crée l'événement Google (lien Meet, invités) sous le double verrou existant. Le navigateur enregistre deux pistes (micro, son de l'onglet) en fichiers autonomes de 30 s, envoyés à l'OS par une interface de session que l'appli à part pourra réutiliser. L'exécuteur du poste, hors Docker, convertit chaque morceau (ffmpeg) et le transcrit (whisper.cpp), puis l'OS assemble le transcript et supprime le son.

**Tech Stack:** TypeScript, Fastify, Drizzle (Postgres), React, vitest ; whisper.cpp (`whisper-cli`) et ffmpeg sur le poste.

**Spec:** `docs/superpowers/specs/2026-11-17-visio-enregistrement-design.md`. Livraisons 3 (texte en direct) et 4 (résumé, Inbox) : plans séparés ensuite.

## Global Constraints

- Titre : `V - <Entreprise> x <Hôte> - <Motif>`, motif facultatif, sans lui `V - <Entreprise> x <Hôte>`. Hôte = variable serveur `VISIO_NOM_HOTE` (défaut `Simatis`), ajoutée à `.env.example` sans valeur. (Écart assumé avec la spec : les instances de l'OS sont des mandats, donc le nom d'instance serait le client, pas l'hôte.)
- Écriture Google : simulation par défaut, double verrou existant (`canWriteReal`). En simulation aucune invitation ne part et l'écran le dit.
- Aucune capture sans clic de Marc ; sans partage du son de l'onglet, micro seul, et l'écran le dit.
- Son brut supprimé après transcription réussie. Transcript : base de l'instance, jamais dans git.
- Dépôt public : tests et exemples en données fictives uniquement. Pas de `--no-verify`. `git add` fichier par fichier.
- Un morceau audio doit être décodable seul : on redémarre le `MediaRecorder` toutes les 30 s, on ne découpe pas un flux unique (les fragments suivants n'ont pas d'en-tête).
- Les tables métier suivent `metierColumns()` et `instanceIsolation(...)`. Migrations par `npm run db:generate`, puis vérifier la colonne en base locale (voir mémoire « migrations sautées »).

## Review Focus

- Entreprise au nom avec espaces, accents ou tiret : titre propre, espaces simples.
- Invité à l'adresse invalide ou doublon : refus ou dédoublonnage, jamais d'erreur Google brute.
- Google refuse la création (jeton expiré) : le rendez-vous OS existe, l'écran dit que la visio n'est pas créée.
- Morceau reçu deux fois ou hors ordre : un seul exemplaire gardé, assemblage dans l'ordre.
- Navigateur fermé en cours d'enregistrement : la session reste `en_cours` puis se clôt seule et transcrit ce qui est arrivé.

---

### Task 1: Nomenclature du titre

**Files:**
- Create: `src/visio/nomenclature.ts`, `src/visio/nomenclature.test.ts`
- Modify: `.env.example` (ajouter `VISIO_NOM_HOTE=`), `src/config.ts` (si les variables y sont lues)

**Interfaces:**
- Produces: `titreVisio(p: { entreprise: string; hote: string; motif?: string | null }): string`

- [ ] **Step 1: Write the failing test** — `titreVisio({ entreprise: 'Atelier Fictif', hote: 'Simatis', motif: 'Restitution' })` vaut `V - Atelier Fictif x Simatis - Restitution` ; sans motif, `null` ou `'  '` : `V - Atelier Fictif x Simatis` ; entreprise `'  Atelier   Fictif '` : espaces ramenés à un ; entreprise vide : lève une erreur.
- [ ] **Step 2: Run** `npx vitest run src/visio/nomenclature.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `titreVisio` (fonction pure) ; lire `VISIO_NOM_HOTE` dans la config avec défaut `Simatis`.
- [ ] **Step 4: Run** le même test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(visio): nomenclature du titre d'une visio`.

### Task 2: Événement Google avec lien Meet et invités

**Files:**
- Modify: `src/connecteurs/google/google.ts:534` (`creerEvenement`), `src/connecteurs/google/google.test.ts`

**Interfaces:**
- Consumes: `creerEvenement(ctx, rdv, options)` actuel.
- Produces: le paramètre `rdv` accepte `invites?: string[]` et `visio?: boolean` ; le résultat devient `{ evenement: { id; lien; lienVisio: string | null } | null; simulation: boolean }`. Sans `invites` ni `visio`, la requête envoyée est identique à aujourd'hui.

- [ ] **Step 1: Write the failing tests** — (a) en simulation avec `visio: true` et `invites`, aucun appel Calendar ; (b) en réel, la requête POST contient `attendees: [{ email }]`, `conferenceData.createRequest.requestId` non vide et `conferenceSolutionKey.type = 'hangoutsMeet'`, l'URL porte `conferenceDataVersion=1` et `sendUpdates=all` ; (c) la réponse du faux Google avec `hangoutLink` donne `lienVisio` ; (d) sans `visio` ni `invites`, le corps et l'URL sont ceux du test existant ligne 648.
- [ ] **Step 2: Run** `npx vitest run src/connecteurs/google/google.test.ts -t "creerEvenement"` — Expected: FAIL.
- [ ] **Step 3: Implement** l'extension ; `requestId` = `rdv.osId`. Adapter le faux Google du test pour renvoyer `hangoutLink`.
- [ ] **Step 4: Run** le fichier de test complet — Expected: PASS (les anciens cas inchangés).
- [ ] **Step 5: Commit** `feat(google): création d'événement avec lien Meet et invités`.

### Task 3: Création d'une visio côté OS

**Files:**
- Modify: `src/crm/schema.ts` (`rendezVous` : colonne `lienVisio: text('lien_visio')`), `src/conversion/rdv.ts` (`creerRendezVousDansTx` : champs `visio`, `invites`, retour `lienVisio`), migration générée
- Create: `src/visio/service.ts`, `src/visio/routes.ts`, `src/visio/service.test.ts`
- Modify: `src/api/routes.ts` (enregistrer les routes de visio, comme les autres modules)

**Interfaces:**
- Consumes: `titreVisio` (Task 1), `creerEvenement` (Task 2), `creerRendezVousOs`.
- Produces: `creerVisio(db, instance, saisie: { entrepriseId: string; motif?: string; debut: string; dureeMinutes: number; invites: string[] }, deps): Promise<{ id: string; ligneId: string; titre: string; lienVisio: string | null; google: 'ok' | 'simulation' | 'indisponible' | 'erreur' }>` ; route `POST /api/i/:slug/visios` (201) ; le champ `lienVisio` apparaît dans la lecture d'un rendez-vous.

- [ ] **Step 1: Write the failing tests** (style `src/conversion/rdv-os.test.ts`, faux Google) — simulation : rendez-vous créé avec le bon titre, `google: 'simulation'`, `lienVisio` nul, aucun appel Calendar ; réel : lien et invités enregistrés dans `participants` et `lienVisio` ; invités dédoublonnés et en minuscules ; adresse invalide : 400 ; Google en erreur : rendez-vous créé, `google: 'erreur'` ; entreprise d'une autre instance : 404.
- [ ] **Step 2: Run** `npx vitest run src/visio/service.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : le titre vient de `titreVisio` avec le nom de l'entreprise relu en base ; migration `npm run db:generate` ; vérifier la colonne en base locale.
- [ ] **Step 4: Run** `npx vitest run src/visio src/conversion` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(visio): création d'une visio avec lien Meet et invitations`.

### Task 4: Bouton « Nouvelle visio » dans l'écran Rendez-vous

**Files:**
- Modify: `web/src/pages/RendezVous.tsx`, `web/src/api.ts`, `web/src/pages/RendezVous.test.tsx`

**Interfaces:**
- Consumes: `POST /api/i/:slug/visios`.
- Produces: `creerVisio(slug, saisie)` dans `web/src/api.ts` ; un formulaire (entreprise, motif avec suggestions Restitution et Point d'étape, date, durée, invités) avec aperçu du titre.

- [ ] **Step 1: Write the failing test** — le formulaire affiche l'aperçu `V - Atelier Fictif x Simatis - Restitution` ; la soumission appelle l'API une fois ; en `simulation`, un message « Simulation : aucune invitation envoyée » ; en `erreur`, « Visio non créée dans Google ».
- [ ] **Step 2: Run** `npx vitest run web/src/pages/RendezVous.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** le formulaire dans le style de l'écran (français, composants existants).
- [ ] **Step 4: Run** le test — Expected: PASS ; puis vérifier dans le navigateur (aperçu du titre, messages).
- [ ] **Step 5: Commit** `feat(visio): formulaire Nouvelle visio`.

### Task 5: Sessions d'enregistrement (tables et service)

**Files:**
- Create: `src/visio/schema.ts`, `src/visio/enregistrement.ts`, `src/visio/enregistrement.test.ts`, migration générée
- Modify: `src/db/metier-tables.ts` (déclarer les nouvelles tables comme les autres)

**Interfaces:**
- Produces:
  - tables `enregistrementsVisio` (`id`, `rendezVousId`, `statut: 'en_cours' | 'clos' | 'transcrit' | 'erreur'`, `debutAt`, `finAt`, `dernierMorceauAt`, `transcript`) et `morceauxVisio` (`enregistrementId`, `piste: 'moi' | 'autres'`, `rang: int`, `debutMs: int`, `audio: bytea | null`, `mime`, `texte: text | null`) avec unicité (`enregistrementId`, `piste`, `rang`) ;
  - `ouvrirSession(tx, rdvId): Promise<{ id: string }>` (une seule session `en_cours` par rendez-vous : renvoie l'existante) ;
  - `recevoirMorceau(tx, id, m: { piste; rang; debutMs; mime; audio?: Buffer; texte?: string }): Promise<void>` (idempotent, `texte` fourni = déjà transcrit, audio inutile) ;
  - `clore(tx, id): Promise<void>` ;
  - `assemblerTranscript(morceaux): string`, lignes `Moi : …` / `Autres : …` triées par `debutMs` puis piste ;
  - `finaliser(tx, id): Promise<boolean>` : si tous les morceaux ont un texte, écrit `transcript`, passe à `transcrit`, met `audio` à nul.

- [ ] **Step 1: Write the failing tests** — morceau reçu deux fois : un seul ; reçu hors ordre : transcript dans l'ordre ; `finaliser` renvoie faux tant qu'un texte manque, vrai ensuite, et l'audio est nul après ; session déjà `en_cours` réutilisée ; autre instance : rien de visible ; session sans activité depuis plus de 10 min : `clore` automatique par une fonction `cloturerAbandonnees(tx, maintenant)` testée avec une horloge injectée.
- [ ] **Step 2: Run** `npx vitest run src/visio/enregistrement.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**, migration, vérification de la colonne en base locale.
- [ ] **Step 4: Run** le test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(visio): sessions d'enregistrement et assemblage du transcript`.

### Task 6: Interface capture ↔ OS et interface exécuteur

**Files:**
- Create: `src/visio/enregistrement.routes.ts`, `src/visio/enregistrement.routes.test.ts`
- Modify: `src/api/routes.ts` ou le module qui enregistre les routes `runner` (même pattern que `/api/runner/echanges`)

**Interfaces:**
- Consumes: Task 5.
- Produces (interface de la capture, spec § 5 bis) : `GET /api/i/:slug/visio/rendez-vous` (rendez-vous en cours ou à moins de 2 h) ; `POST /api/i/:slug/visio/sessions` `{ rdvId }` ; `PUT /api/i/:slug/visio/sessions/:id/morceaux/:piste/:rang` (corps binaire audio, en-tête `x-debut-ms`, `bodyLimit` 5 Mo ; ou JSON `{ texte }`) ; `POST /api/i/:slug/visio/sessions/:id/fin` ; `GET /api/i/:slug/visio/sessions/:id` (statut, transcript).
- Produces (exécuteur) : `GET /api/runner/transcriptions` (morceaux à transcrire : instance, id, mime, audio en base64) ; `POST /api/runner/transcriptions/:id` `{ instance, texte }` qui appelle `finaliser` quand la session est close.

- [ ] **Step 1: Write the failing tests** — parcours complet sur faux client : ouvrir, deux morceaux, fin, l'exécuteur lit puis rend les textes, `GET` renvoie le transcript ; rendez-vous d'une autre instance : 404 ; piste inconnue : 400 ; morceau au-delà de 5 Mo : 413 ; l'exécuteur sans jeton : refus.
- [ ] **Step 2: Run** `npx vitest run src/visio/enregistrement.routes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les routes ; la route de clôture lance aussi `finaliser` (cas où tous les textes sont déjà là).
- [ ] **Step 4: Run** `npx vitest run src/visio` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(visio): interface de capture et interface de l'exécuteur`.

### Task 7: Transcription par l'exécuteur du poste

**Files:**
- Create: `src/runner/transcription.ts`, `src/runner/transcription.test.ts`
- Modify: `src/runner/runner.ts` (appeler la transcription à chaque passage, comme les échanges ligne 447), `.env.example` (`WHISPER_BIN=`, `WHISPER_MODEL=`, `FFMPEG_BIN=`), `docs/EXPLOITATION.md` (installation de whisper.cpp et ffmpeg sur le poste, une section courte)

**Interfaces:**
- Consumes: routes `runner` de Task 6.
- Produces: `transcrireMorceau(m: { mime: string; audio: Buffer }, outils: { ffmpeg: string; whisper: string; modele: string; lancer: Lanceur }): Promise<string>` et `passerTranscriptions(api, outils): Promise<number>` (nombre de morceaux traités). `Lanceur` est l'abstraction de processus déjà utilisée par `runner.ts`, pour pouvoir la simuler.

- [ ] **Step 1: Write the failing tests** — avec un faux lanceur : ffmpeg est appelé pour passer en wav 16 kHz mono, puis `whisper-cli` avec `-l fr` et le modèle, le texte renvoyé est nettoyé (espaces, marqueurs vides) ; échec ffmpeg : le morceau est signalé en erreur sans bloquer les autres ; variables absentes : `passerTranscriptions` renvoie 0 et journalise une seule fois que la transcription n'est pas configurée ; fichiers temporaires supprimés dans tous les cas.
- [ ] **Step 2: Run** `npx vitest run src/runner/transcription.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** ; dossier temporaire par morceau, supprimé dans `finally`.
- [ ] **Step 4: Run** `npx vitest run src/runner` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(runner): transcription locale des morceaux de visio`.

### Task 8: Capture dans le navigateur et bouton d'enregistrement

**Files:**
- Create: `web/src/visio/capture.ts`, `web/src/visio/capture.test.ts`
- Modify: `web/src/pages/FicheRdv.tsx`, `web/src/pages/FicheRdv.test.tsx`, `web/src/api.ts`

**Interfaces:**
- Consumes: interface de Task 6.
- Produces: `class CaptureVisio` avec `demarrer(sources: { micro: MediaStream; onglet: MediaStream | null }, envoyer: (m: { piste; rang; debutMs; blob }) => Promise<void>): void` et `arreter(): Promise<void>` ; chaque piste enregistre par fichiers autonomes de 30 s (arrêt et redémarrage du `MediaRecorder`). Le bouton « Enregistrer » / « Arrêter » avec durée, rappel « prévenez les participants », mention « micro seul » si le son de l'onglet est refusé, et le transcript affiché à la fin.

- [ ] **Step 1: Write the failing tests** — faux `MediaRecorder` : après 65 s simulées, trois fichiers par piste de rangs 0, 1, 2 ; `arreter` envoie le dernier morceau avant de rendre la main ; échec d'un envoi : réessayé sans perdre l'ordre ; sans flux d'onglet : une seule piste et le message « micro seul » ; clic sur Enregistrer : appelle `getUserMedia` puis `getDisplayMedia`, jamais avant le clic.
- [ ] **Step 2: Run** `npx vitest run web/src/visio web/src/pages/FicheRdv.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** ; consigner en commentaire pourquoi on redémarre le recorder (fragments sans en-tête).
- [ ] **Step 4: Run** les tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(visio): enregistrement depuis la fiche du rendez-vous`.

### Task 9: Vérification, essai réel et documentation

**Files:**
- Modify: `README.md` ou `docs/EXPLOITATION.md` si une section manque ; second cerveau : `brain/outils/simatis-os-structure.md`, `brain/outils/simatis-os-feuille-de-route.md`, `log.md` (clone local, puis `git pull --rebase`, `git add` des fichiers, commit, push — voir AGENTS.md)

- [ ] **Step 1:** `npm run verify` — Expected: tout vert.
- [ ] **Step 2:** Essai dans le navigateur (aperçu du titre, simulation, formulaire, bouton d'enregistrement avec un faux flux) et dire ce qui n'a pas pu être essayé.
- [ ] **Step 3:** Ouvrir la PR, relire le diff soi-même, attendre la CI verte, merger, reconstruire et relancer le conteneur depuis `origin/main`.
- [ ] **Step 4:** Mettre à jour le second cerveau (aucune donnée du dépôt privé copiée ici).
- [ ] **Step 5:** Expliquer à Marc, pas à pas, comment tester : installer whisper.cpp et ffmpeg, créer une visio en simulation, essai réel avec une invitation à une adresse à lui, enregistrer une minute, lire le transcript.
