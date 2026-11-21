# Radar : ajout manuel d'une entrée — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** ajouter au Radar, à la main, une personne qui n'a pas encore de fiche, avec son étape, son canal, son origine et une note.

**Architecture :** une fonction serveur `ajouterAuRadar` enchaîne les briques existantes (entreprise, contact, affaire), puis fixe étape, canal, origine et note ; une route `POST /api/i/:slug/radar/entrees` l'expose ; un formulaire web ouvert depuis la page Radar l'appelle. Rien de nouveau en base (pas de migration).

**Tech Stack :** TypeScript, Fastify, Drizzle (Postgres), React, Vitest.

**Spec :** `docs/superpowers/specs/2026-11-21-radar-ajout-manuel-design.md`

## Global Constraints

- Interface et messages d'erreur en français.
- Données fictives uniquement dans tests et exemples (dépôt public).
- Écritures vers un CRM tiers : uniquement via `createInCrm` (dry-run par défaut, double verrou) ; ne rien contourner.
- Étapes Radar 0 à 3 ; canaux `'Téléphone' | 'LinkedIn' | 'E-mail' | 'À préciser'` (enum de `opportunites.radarCanalManuel`).
- Étape de départ par défaut 0 (« À contacter ») ; `radarEtapeManuelle` n'est écrit que pour 1 à 3.
- Pas de `git add -A`, pas de `--no-verify` ; `npm run verify` avant chaque commit.

## Review Focus

- Même adresse mail saisie deux fois (casse différente comprise) : un seul contact, pas de doublon.
- Contact déjà connu qui a déjà une affaire ouverte : refus clair, rien de créé.
- Nom seul, sans entreprise ni mail : l'entrée se crée quand même (titre = nom).
- Entreprise déjà existante (même nom, casse différente) : réutilisée, pas dupliquée.
- CRM en lecture seule ou écritures réelles fermées : message clair ou simulation, jamais de demi-création silencieuse.

---

### Task 0 : Branche

- [ ] **Step 1 :** vérifier `git branch --show-current` ; l'arbre doit être propre (les fichiers `src/runner/*` modifiés par une autre session doivent d'abord être réglés par Marc, voir AGENTS.md).
- [ ] **Step 2 :** `git fetch` puis `git switch -c feature/radar-ajout-manuel origin/main`.
- [ ] **Step 3 :** committer les deux documents (spec et plan) avec `git add` explicite, message `docs(radar): conception et plan de l'ajout manuel`.

### Task 1 : Fonction serveur `ajouterAuRadar`

**Files:**
- Create: `src/crm/ajout-radar.ts`
- Test: `src/crm/ajout-radar.test.ts` (modèle : `src/crm/affaire-contact.test.ts`, mêmes `setupTestApp`, `createInstance`, `deps`)

**Interfaces:**
- Produces:
  ```ts
  export type EntreeRadar = {
    prenom?: string | null;
    nom: string;
    entreprise?: string | null;       // nom libre : trouvée (insensible à la casse) ou créée
    email?: string | null;
    fonction?: string | null;
    lienLinkedin?: string | null;
    origine?: string | null;
    canal: 'Téléphone' | 'LinkedIn' | 'E-mail' | 'À préciser';
    etape?: 0 | 1 | 2 | 3;            // défaut 0
    note?: string | null;
    contactId?: string | null;        // contact existant choisi dans les suggestions
  };
  export async function ajouterAuRadar(
    db: Executor, instance: Instance, input: EntreeRadar, deps: ConnexionDeps,
  ): Promise<{ id: string; contactId: string } | Simulation>;
  ```
- Consumes: `createEntreprise`, `createContact`, `Simulation` (`src/crm/service.ts`), `createOpportunite`, `pipelineSource`, `ChangementInvalide` (`src/crm/pipeline.ts`), `contactsParEmails`, `ajouterEmail` (`src/crm/emails.ts`), tables `contacts`, `entreprises`, `opportunites`, `activites`.

- [ ] **Step 1 : écrire les tests** (un `it` par ligne, noms exacts) :
  - `crée entreprise, contact et affaire à la première étape du Pipeline, étape et canal fixés` : après appel avec `{ nom: 'Alice Fictive', entreprise: 'Société Exemple', email: 'alice@exemple.test', canal: 'LinkedIn', etape: 1, origine: 'Origine Test' }`, l'affaire a `etape` = première étape de `pipelineSource`, `radarEtapeManuelle` 1, `radarCanalManuel` `'LinkedIn'`, `origine` `'Origine Test'`, `contactId` du contact créé, titre `'Société Exemple'`.
  - `étape 0 : aucun placement manuel enregistré` (`radarEtapeManuelle` est `null`).
  - `nom seul : crée le contact et l'affaire, titre = nom`.
  - `réutilise l'entreprise de même nom, casse différente` (une seule ligne `entreprises` après deux appels avec `'SOCIÉTÉ exemple'` / `'Société Exemple'`).
  - `réutilise le contact de même adresse mail, casse différente, sans doublon` (appel 1 puis, après avoir clos l'affaire, appel 2 : un seul `contacts`).
  - `refuse quand le contact a déjà une affaire ouverte et ne crée rien de plus` (rejette `ChangementInvalide` contenant `'déjà une affaire ouverte'`).
  - `contactId fourni : crée seulement l'affaire` ; `contactId d'une autre instance : refusé`.
  - `la note devient une activité de type note liée au contact et à l'affaire, lien LinkedIn en première ligne` (`activites.resume` commence par `Profil LinkedIn : https://…`).
  - `la liste d'étapes du Pipeline vide : ChangementInvalide` si `pipelineSource` n'a aucune étape (suivre le cas déjà couvert par `affaire-contact.test.ts`).
- [ ] **Step 2 :** lancer `npx vitest run src/crm/ajout-radar.test.ts` : tout échoue (module absent).
- [ ] **Step 3 : implémenter `ajouterAuRadar`** dans `src/crm/ajout-radar.ts`. Ordre : (1) résoudre le contact : `contactId` fourni (vérifié dans l'instance) sinon contact trouvé par `contactsParEmails` sur l'adresse normalisée, sinon création via `createContact` (`nom` = `prenom nom` assemblé) ; (2) refuser si ce contact a une affaire ouverte, avant toute création d'entreprise ; (3) entreprise : trouvée par nom insensible à la casse dans l'instance, sinon `createEntreprise` ; (4) `createOpportunite` (première étape de `pipelineSource`, titre = nom d'entreprise ou nom du contact, comme `creerAffairePourContact`) ; (5) en une transaction `withInstance`, mettre à jour l'affaire (`origine`, `radarCanalManuel`, `radarEtapeManuelle` si étape ≥ 1) et insérer l'activité `note` si note ou lien LinkedIn. Si une étape renvoie une `Simulation`, la retourner telle quelle.
- [ ] **Step 4 :** relancer le fichier de test : tout passe.
- [ ] **Step 5 :** commit `feat(radar): ajout manuel d'une entrée côté serveur`.

### Task 2 : Route `POST /api/i/:slug/radar/entrees`

**Files:**
- Modify: `src/api/routes.ts` (à côté de `POST /api/i/:slug/contacts/:id/affaire`)
- Test: `src/api/radar-entrees.routes.test.ts` (modèle : `src/api/affaire-contact.routes.test.ts`)

**Interfaces:**
- Consumes: `ajouterAuRadar`, `EntreeRadar` (Task 1).
- Produces: `POST /api/i/:slug/radar/entrees` → 201 `{ id, contactId }` ; 202 sur simulation ; 400 `{ error }` (corps invalide, `ChangementInvalide`) ; 409 (`CrmIndisponible`).

- [ ] **Step 1 : écrire les tests** : `crée l'entrée et répond 201 avec l'id de l'affaire` ; `refuse un corps sans nom (400)` ; `refuse une étape 4 et un canal inconnu (400)` ; `refuse un second ajout pour le même contact ouvert (400, « déjà une affaire ouverte »)` ; `instance inconnue : 404` ; `l'affaire créée apparaît dans GET /pipeline avec radarCanalManuel et origineCommerciale`.
- [ ] **Step 2 :** lancer le fichier : échec.
- [ ] **Step 3 :** schéma Zod `.strict()` calqué sur `EntreeRadar` (textes `trim().max(300)`, note `max(2000)`, `email` via `z.email()`, `lienLinkedin` via `z.url()`, `contactId` `z.uuid()`), route sur le modèle de `/contacts/:id/affaire` pour la gestion des erreurs.
- [ ] **Step 4 :** relancer : tout passe.
- [ ] **Step 5 :** commit `feat(radar): route d'ajout manuel d'une entrée`.

### Task 3 : Formulaire web « Ajouter au Radar »

**Files:**
- Create: `web/src/pages/AjoutRadar.tsx`, `web/src/pages/AjoutRadar.test.tsx`
- Modify: `web/src/api.ts` (ajouter `ajouterAuRadar(slug, input)` via `sendJson('POST', inst(slug, 'radar/entrees'), input)`), `web/src/pages/RadarAffaires.tsx` (bouton + ouverture du formulaire), `web/src/styles.css` si besoin
- Test de la page : `web/src/pages/RadarAffaires.test.tsx` (un cas ajouté)

**Interfaces:**
- Produces: `export function AjoutRadar(props: { slug: string; origines: string[]; onFerme: () => void; onAjoute: () => void })`.
- Consumes: `searchContacts` côté API existante `GET /api/i/:slug/contacts?q=` (suggestions de contacts connus), `origines` déduites des `origineCommerciale` des affaires déjà chargées dans `RadarAffaires`.

- [ ] **Step 1 : écrire les tests** (`AjoutRadar.test.tsx`, `// @vitest-environment jsdom`, `fetch` simulé comme dans `RadarAffaires.test.tsx`) :
  - `envoie le formulaire rempli : nom, mail, entreprise, canal LinkedIn par défaut, étape 0` (corps du POST vérifié).
  - `le nom est obligatoire : pas d'envoi sans lui, message en français`.
  - `proposer les contacts connus pendant la saisie du nom ou du mail, et en choisir un envoie son contactId`.
  - `les origines déjà utilisées sont proposées`.
  - `une erreur serveur s'affiche et garde le formulaire rempli`.
  - Dans `RadarAffaires.test.tsx` : `le bouton « Ajouter au Radar » ouvre le formulaire, et un ajout réussi recharge le Radar`.
- [ ] **Step 2 :** `npx vitest run web/src/pages/AjoutRadar.test.tsx web/src/pages/RadarAffaires.test.tsx` : échecs attendus.
- [ ] **Step 3 :** implémenter le composant (champs : prénom, nom, entreprise, mail, lien LinkedIn, fonction, origine avec liste de suggestions, canal, étape parmi « À contacter / Approchée / À relancer / A répondu », note) ; classes CSS et composants de formulaire existants du projet (`btn`, `empty`, etc.). Bouton dans l'en-tête de `RadarAffaires` ; après succès, `actualiser((n) => n + 1)` puis fermeture.
- [ ] **Step 4 :** relancer les deux fichiers : tout passe.
- [ ] **Step 5 :** commit `feat(radar): formulaire « Ajouter au Radar »`.

### Task 4 : Vérification, livraison

- [ ] **Step 1 :** `npm run verify` : tout vert.
- [ ] **Step 2 :** vérifier dans le navigateur (preview) : ouvrir le Radar de l'instance de démo, ajouter une personne fictive, la voir apparaître à la bonne étape et au bon canal, rouvrir sa fiche, retrouver la note.
- [ ] **Step 3 :** push, PR, revue de code, CI verte, merge dans `main` (AGENTS.md), puis reconstruire et relancer le conteneur depuis `origin/main` à jour.
- [ ] **Step 4 :** mettre à jour le second cerveau (`brain/outils/simatis-os-structure.md`, `simatis-os-feuille-de-route.md`, `log.md`), commit et push du dépôt privé.
