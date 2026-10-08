# Implémentation de la maquette : plan complet

> **Pour les agents :** sous-skill requis : `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans`, lot par lot. Chaque lot reçoit d'abord son plan détaillé dans `docs/plans/` (format de `2026-10-08-socle-s1.md`), puis suit les cases `- [ ]` ci-dessous.
>
> Rien de confidentiel ici : les mandats, sociétés et personnes cités sont fictifs. Le premier mandat réel est appelé « premier mandat sous HubSpot ».

**Objectif :** transformer la maquette `maquettes/os-commercial/` en OS réel. Marc pilote SIMATIS et ses mandats depuis l'OS sans ouvrir HubSpot, et lance ses routines Claude depuis l'OS.

**Architecture :** un seul processus Node (Fastify) sert l'API, le serveur MCP, l'interface React et les synchronisations, sur Postgres avec Row-Level Security par instance. Les routines Claude tournent sur le poste de Marc, via un petit exécuteur local qui lance `claude -p` avec un jeton MCP limité à une instance. Elles ne passent que par les outils de l'OS, qui imposent cloisonnement, simulation et journal.

**Pile :** TypeScript 6, Node 24, PostgreSQL 18, Drizzle 0.45, Fastify 5, Zod 4, SDK MCP TypeScript, React + Vite, Vitest + Testcontainers, Docker Compose.

**Spec :** `docs/plan.md` (principes, décisions, parties métier) et la maquette `maquettes/os-commercial/` (comportement des écrans). En cas d'écart, `docs/plan.md` prime pour les règles, la maquette pour l'interface.

## Contraintes globales

- Dépôt public : aucune donnée réelle (noms de mandats, de prospects ou de contacts, montants, exports). Les noms réels vivent en base, hors git. Fixtures et tests : données fictives uniquement, reprises de `maquettes/os-commercial/js/data.js`.
- Chaque table métier porte `instance_id`, `source`, `source_id`, `created_at` et `updated_at`, et est protégée par Row-Level Security. L'app se connecte avec le rôle `simatis_app`, jamais propriétaire des tables.
- Écriture vers un outil tiers : simulation par défaut. Le mode réel exige `REAL_WRITES=on` (serveur) **et** `config.ecrituresReelles = true` (instance).
- Aucun repli entre instances : une connexion absente arrête l'action, jamais d'emprunt à une autre instance.
- Brouillons Gmail créés **sans signature**. Aucun envoi direct d'email.
- Interface en français, sans sous-titre sous les titres ; une infobulle (`<Tip>`) explique ce qui n'est pas évident.
- Dates « du jour », « hier », « 7 jours » calculées en `Europe/Paris`.
- `npm run verify` vert avant chaque commit ; une PR par lot ; CI verte avant merge.
- Chaque lot se termine par une explication simple à Marc pour tester.

## Points de vigilance (non couverts par les tests de base)

Chaque ligne a son test, ajouté au lot indiqué.

1. **Fuite entre instances par l'URL** : un jeton ou une session de l'instance A qui appelle `/api/i/<B>/…` reçoit 404, jamais des données de B. Test dans S5 (MCP) et S7 (API).
2. **Synchronisation interrompue** (limite de débit HubSpot, coupure réseau) : rien n'est supprimé dans la copie, l'erreur s'affiche dans Paramètres, et la reprise se fait au passage suivant. Test dans M8a.
3. **Champ exclu** : un champ décoché dans Paramètres n'est ni lu ni écrit, même si l'OS le modifie localement. Test dans M8a.
4. **Fuseau horaire** : une tâche due à 23 h 30, heure de Paris, compte pour le bon jour dans « Tâches du jour » et dans « hier ». Test dans M2a.
5. **Routine lancée deux fois** : une seconde demande sur la même routine est refusée tant qu'une exécution est en cours. Test dans M6.

## Ordre des lots

| # | Lot | Dépend de | Ce que Marc voit à la fin |
| --- | --- | --- | --- |
| 1 | S2 Sauvegarde | S1 | `/health` affiche la dernière sauvegarde |
| 2 | S3 Instances, cloisonnement, journal | S1 | Instances créées par commande, isolées |
| 3 | S4 Propositions et autonomie | S3 | (moteur, sans écran) |
| 4 | S5 Serveur MCP | S3 | Claude voit son instance et le journal |
| 5 | S6 Cadre des connexions | S3 | (moteur, sans écran) |
| 6 | S7 Coquille web | S3 | Menu, sélecteur groupé, favoris, Paramètres vide |
| 7 | M1 Objets commerciaux | S7 | Entreprises, Contacts (pipeline tenu par l'OS) |
| 8 | M8a Connecteur HubSpot | S6, M1 | Miroir HubSpot, reprise du premier mandat |
| 9 | M5a Pipeline | M1, M8a | Pipeline miroir, conversions, Gagnées/Perdues |
| 10 | M8b Gmail et Agenda | S6 | Connexions Google par instance |
| 11 | M2a Brief du jour et À valider | S4, M8a, M8b | Votre journée, tâches réalisées, validations |
| 12 | M6 Routines Claude | S5, M2a | Routines lancées depuis l'OS, réglages |
| 13 | M9 Mandats prospects | S3, M1 | Démos fictives, conversion en mandat |
| 14 | M2b Tableau de bord | M5a | Entonnoir et indicateurs |
| 15 | M5b Rendez-vous et Devis | M2a | Préparation, compte rendu, devis SIMATIS |
| — | M4 Prospection, Bases vivantes | spec à finir | Bloqué : Marc doit essayer la maquette, et la base partenaire est en conception |
| — | Reportés | — | Plan d'action, Diagnostic, Détection, Autonomie (écran), Second cerveau |

S4, S5, S6 et S7 peuvent avancer en parallèle après S3. Lots 7 à 12 : le chemin critique vers « Marc n'ouvre plus HubSpot ».

---

## Lot 1 — S2 Sauvegarde et exploitation

Contenu inchangé par rapport à `docs/plan.md` (S2).

**Fichiers :** `backup/Dockerfile`, `backup/backup.sh`, `backup/restore-test.sh`, `compose.yaml` (service `backup`), `src/backup-status.ts`, `src/health.ts`, `docs/EXPLOITATION.md`, `.env.example` (`RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `AWS_*`, sans valeur).

**Interfaces :**
- `backup.sh` écrit `/status/last.json` = `{ "lastBackupAt": ISO, "lastRestoreTestAt": ISO | null, "ok": boolean }` (volume `backup-status`, monté en lecture seule dans `app`).
- `readBackupStatus(path: string): Promise<{ lastBackupAt: string | null; lastRestoreTestAt: string | null }>`
- `/health` renvoie `lastBackupAt` et `lastRestoreTestAt`.

- [ ] Test `readBackupStatus` : fichier absent, puis `null` partout ; JSON valide, puis valeurs reprises ; JSON corrompu, puis `null` sans exception.
- [ ] Test `/health` : avec un statut de sauvegarde, `lastBackupAt` égal à la valeur du fichier.
- [ ] Rattrapage : la boucle horaire lance la sauvegarde si la dernière réussie a plus de 24 h. Vérifié à la main avec un dépôt restic local (`RESTIC_REPOSITORY=/backups/test`).
- [ ] Test de restauration hebdomadaire dans une base jetable ; le résultat est écrit dans `last.json`.
- [ ] `docs/EXPLOITATION.md` : démarrer, arrêter, mettre à jour, restaurer, déménager.
- [ ] PR, CI verte, merge.

**Tester (Marc)** : ouvrir `http://127.0.0.1:4300/health` ; la date de dernière sauvegarde est celle du jour.

## Lot 2 — S3 Instances, cloisonnement et journal

**Fichiers :**
- `src/instances/schema.ts`, `src/instances/service.ts`, `src/instances/context.ts`, `src/instances/*.test.ts` ;
- `src/journal/schema.ts`, `src/journal/service.ts`, `src/journal/*.test.ts` ;
- `src/db/metier.ts` (helper des colonnes communes), `src/db/roles.ts` ;
- `src/secrets/load.ts`, `src/admin/cli.ts` ;
- `drizzle/0001_*.sql` (tables, RLS, déclencheur d'ajout seul) ;
- `src/config.ts` : `APP_DB_PASSWORD`, `SECRETS_DIR` (défaut `./secrets/instances`), `REAL_WRITES` (`off` | `on`, défaut `off`).

**Interfaces :**
- Table `instances` : `id uuid`, `slug text unique`, `nom text`, `type 'propre'|'mandat'|'prospect'`, `statut 'actif'|'archive'`, `config jsonb`, `created_at`, `updated_at`. Sans RLS : seul le cœur la lit.
- Table `journal` : `id bigint identity`, `instance_id uuid`, `at timestamptz`, `acteur text` (`pilote` | `os` | `agent:<nom>` | `systeme`), `action text`, `niveau text null`, `details jsonb`. Ajout seul : `UPDATE` et `DELETE` lèvent une erreur, par déclencheur.
- `metierColumns()` renvoie les colonnes `instance_id`, `source`, `source_id`, `created_at`, `updated_at`. Chaque table métier active la RLS avec la politique `instance_id = current_setting('app.instance_id', true)::uuid`.
- `withInstance<T>(db: Database, instanceId: string, fn: (tx: Database) => Promise<T>): Promise<T>` : transaction, puis `set_config('app.instance_id', id, true)`.
- `ensureAppRole(ownerPool: pg.Pool, password: string): Promise<void>` : crée ou met à jour `simatis_app` et ses droits (lecture et écriture, sans être propriétaire), après les migrations.
- `createInstance(db, { slug, nom, type }): Promise<Instance>`, `archiveInstance(db, id)`, `purgeInstance(db, id)` (supprime les lignes métier, garde l'instance archivée et le journal), `listInstances(db): Promise<Instance[]>`.
- `logEvent(tx, { acteur, action, niveau?, details? }): Promise<void>` : instance prise dans le contexte. `recentEvents(tx, limit = 50)`.
- `loadInstanceSecrets(dir: string, slug: string): Record<string, string>` : lit `<dir>/<slug>.env`.
- CLI : `npm run admin -- instance:create --slug <s> --nom "<n>" --type mandat`, `instance:archive`, `instance:purge`, `instance:list`.

- [ ] Test : avec deux instances A et B et une table de test `essai` (créée dans le test via `metierColumns`), `withInstance(A)` ne lit que les lignes de A.
- [ ] Test : avec le rôle `simatis_app`, une requête SQL brute sans `app.instance_id` ne lit aucune ligne métier.
- [ ] Test : `UPDATE journal` et `DELETE FROM journal` lèvent une erreur, même avec le rôle `simatis_app`.
- [ ] Test : `purgeInstance` vide les tables métier de l'instance, garde le journal et met `statut = 'archive'`.
- [ ] Test : `loadInstanceSecrets` avec un fichier absent, puis un objet vide ; aucune valeur de secret dans le message d'erreur.
- [ ] Le démarrage appelle `runMigrations` (rôle propriétaire), puis `ensureAppRole`, puis ouvre le pool applicatif.
- [ ] Commande `npm run admin -- demo:seed` : crée les instances fictives de la maquette (`simatis`, `helioval`, `aquaterra`, `demo`).
- [ ] PR, CI verte, merge.

**Tester (Marc)** : `npm run admin -- instance:list` affiche les quatre instances fictives.

## Lot 3 — S4 Propositions et autonomie

**Fichiers :** `src/propositions/schema.ts`, `registry.ts`, `service.ts`, `gate.ts` et leurs tests.

**Interfaces :**
- Table `propositions` (métier) : `id`, `type`, `contenu jsonb`, `auteur`, `statut 'proposee'|'validee'|'modifiee'|'ecartee'|'appliquee'|'echec'`, `niveau 'L0'..'L3'`, `decide_par`, `decide_at`, `resultat jsonb`.
- Table `autonomie` (métier) : `action text`, `niveau text`. Défauts et limites verrouillées repris de `AUTONOMIE_DEFAUT` (maquette, `data.js`).
- `registerPropositionType<T>({ type: string; action: string; schema: z.ZodType<T>; apply(tx, contenu: T, ctx: ApplyCtx): Promise<unknown> }): void`
- `propose(tx, { type, contenu, auteur }): Promise<Proposition>` : valide le contenu avec le schéma du type. Selon le niveau de l'action :
  - L0 : refus ;
  - L1 et L2 : statut `proposee` ;
  - L3 : `apply` immédiat.
- `decide(tx, id, { decision: 'valider'|'ecarter', par: string, contenu? }): Promise<Proposition>` : refus si `par` est l'auteur. Valider applique la proposition.
- `canWriteReal(instance: Instance, env: Config): boolean` : vrai seulement si `REAL_WRITES` est à `on` et `instance.config.ecrituresReelles === true`. `ApplyCtx` contient `{ reel: boolean }`.

- [ ] Tests avec un type `test.note` : L0, refus ; L1, `proposee` ; L3, `appliquee` sans décision ; l'auteur qui valide sa propre proposition est refusé ; une limite verrouillée (`envoi`, minimum L2) ne descend pas sous L2.
- [ ] Test : `apply` reçoit `reel = false` quand l'une des deux clés manque.
- [ ] Chaque transition écrit une ligne au journal (test).
- [ ] PR, CI verte, merge.

## Lot 4 — S5 Serveur MCP

**Fichiers :** `src/mcp/server.ts`, `tools.ts`, `tokens.ts`, `src/mcp/*.test.ts`, `docs/EXPLOITATION.md` (brancher Claude).

**Interfaces :**
- Table `jetons` (hors RLS) : `id`, `instance_id uuid null`, `nom`, `hash`, `portee 'instance'|'portefeuille'|'runner'`, `created_at`, `revoked_at`. Hachage SHA-256 ; le jeton en clair n'est affiché qu'à la création.
- `registerTool<I>({ name: string; description: string; input: z.ZodType<I>; scope: 'instance'|'portefeuille'; handler(ctx: ToolCtx, input: I): Promise<unknown> })`, avec `ToolCtx = { instance: Instance; tx: Database; acteur: string }`. Le handler s'exécute dans `withInstance`, et chaque appel est journalisé.
- Outils de base : `instance_courante`, `journal_recent`, `propositions_en_attente`, `requete_lecture` (lecture seule, sur les vues `v_*` de l'instance du jeton).
- CLI : `npm run admin -- token:create --instance <slug> --nom claude-marc`, `token:revoke`.
- Transport Streamable HTTP sur `POST /mcp`, avec l'en-tête `Authorization: Bearer <jeton>`.

- [ ] Test : un jeton de A appelle `instance_courante`, réponse = slug de A.
- [ ] Test **vigilance 1** : un jeton de A ne voit dans `requete_lecture` aucune ligne de B, même en citant l'identifiant de B.
- [ ] Test : un jeton révoqué reçoit 401 ; un jeton `portefeuille` n'accède qu'aux compteurs.
- [ ] Test de fumée : brancher Claude Code sur l'instance `demo` (procédure dans `EXPLOITATION.md`).
- [ ] PR, CI verte, merge.

## Lot 5 — S6 Cadre des connexions

**Fichiers :** `src/connexions/schema.ts`, `types.ts`, `scheduler.ts`, `fake.ts` et leurs tests.

**Interfaces :**
- Table `connexions` (métier) : `kind 'crm'|'messagerie'|'agenda'`, `fournisseur 'hubspot'|'gmail'|'google-agenda'|'natif'|'fake'`, `reglages jsonb`, `etat 'ok'|'non_configuree'|'erreur'`, `derniere_synchro`, `derniere_erreur`.
- `interface Connector { fournisseur: string; sync(ctx: SyncCtx): Promise<SyncReport>; write?(ctx: SyncCtx, op: WriteOp): Promise<WriteResult> }` avec :
  - `SyncCtx = { instance; tx; secrets: Record<string, string>; reglages; reel: boolean }` ;
  - `SyncReport = { lus: number; crees: number; maj: number; erreurs: string[] }`.
- `registerConnector(c: Connector)`, `getConnector(instance, kind): Connector | null` : `null` si la connexion est absente ou non configurée, sans repli.
- `startScheduler({ db, tickMs = 60_000 }): () => void` : à chaque passage, synchronise chaque connexion dont `now - derniere_synchro >= frequence`. `syncNow(db, instanceId, kind)` lance une synchronisation à la demande.
- Fréquences : `5min`, `15min`, `1h`, `1j`, `manuel` (Paramètres).

- [ ] Test : le connecteur factice écrit dans l'instance A ; aucune ligne n'apparaît dans B.
- [ ] Test : rattrapage. Après une pause de 3 h et avec une fréquence de 15 min, une seule synchronisation au passage suivant, pas douze.
- [ ] Test : `getConnector(B, 'messagerie')` renvoie `null` quand seule A a une messagerie.
- [ ] PR, CI verte, merge.

## Lot 6 — S7 Coquille web

**Fichiers :**
- `web/` (racine Vite) : `index.html`, `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/styles.css` (repris de `maquettes/os-commercial/css/app.css`) ;
- `web/src/shell/Sidebar.tsx`, `InstanceSelector.tsx`, `Favoris.ts`, `Tip.tsx` ;
- `web/src/pages/Journal.tsx`, `web/src/pages/Parametres.tsx` (onglet Mandat seulement) ;
- `src/api/instances.ts`, `src/api/session.ts`, `src/web.ts` (`@fastify/static` sur `dist/web`) ;
- `vite.config.ts`. Tests web en Vitest (`environment: 'jsdom'`) avec `@testing-library/react`.

**Interfaces :**
- API : `GET /api/instances` renvoie `[{ slug, nom, type, statut }]`. Les routes métier sont préfixées `/api/i/:slug/`, et le hook `instanceContext` résout le slug puis ouvre `withInstance`. Slug inconnu ou archivé : 404.
- Accès : l'app écoute sur 127.0.0.1 ; pas d'authentification en V1 (poste de Marc). Les favoris sont rangés en base par utilisateur (`preferences { utilisateur text, favoris text[] }`), avec un seul utilisateur `marc` pour l'instant.
- Fonctions pures :
  - `groupInstances(list): { propre: I[]; mandat: I[]; prospect: I[] }` ;
  - `reorderFavoris(favoris: string[], id: string, cibleId: string, apres: boolean): string[]`.
- Menu (maquette `core.js` `NAV`) :
  - Pilotage : Routines Claude, Brief du jour, À valider, Tableau de bord ;
  - Générer la demande ;
  - Convertir : Pipeline, Entreprises, Contacts, Rendez-vous, Devis (seulement si `module devis`) ;
  - Réglages : Paramètres ;
  - Plus tard, replié.

  Un écran pas encore construit affiche « Bientôt ».

- Portefeuille : `GET /api/portefeuille` renvoie par instance `{ slug, nom, type, aValider, tachesEnRetard, rdv7j, routinesActives }`, des compteurs seulement (maquette `VIEWS.portefeuille`).
- [ ] Test : la réponse du portefeuille ne contient aucun champ autre que les compteurs (liste blanche des clés).
- [ ] Tests purs : `groupInstances` (ordre conservé dans chaque groupe) ; `reorderFavoris` (avant, après, sur lui-même, id absent : liste inchangée).
- [ ] Test API **vigilance 1** : `GET /api/i/inconnu/journal` renvoie 404.
- [ ] Test composant : la `Sidebar` affiche le groupe « Favoris » en premier, sans « Devis » pour un mandat.
- [ ] Le build produit `dist/web`, servi par `app` ; `npm run dev` lance Vite et l'API.
- [ ] Vérification dans le navigateur : sélecteur groupé, favoris réordonnés par glisser-déposer, Journal.
- [ ] PR, CI verte, merge.

**Tester (Marc)** : ouvrir `http://127.0.0.1:4300`, changer d'instance, réordonner les favoris, ouvrir le Journal.

## Lot 7 — M1 Objets commerciaux

**Fichiers :** `src/crm/schema.ts`, `service.ts`, `routes.ts`, tests ; `web/src/pages/Entreprises.tsx`, `Contacts.tsx`, `FicheEntreprise.tsx`, `FicheContact.tsx`.

**Interfaces :**
- Tables métier :
  - `entreprises` : `nom`, `secteur`, `ville`, `taille`, `domaine` ;
  - `contacts` : `entreprise_id`, `nom`, `fonction`, `email`, `telephone`, `role` ;
  - `opportunites` : `entreprise_id`, `contact_id`, `titre`, `etape`, `montant`, `echeance`, `clos 'gagne'|'perdu'|null`, `motif`, `proprietaire` ;
  - `taches` : `opportunite_id`, `contact_id`, `titre`, `canal 'email'|'appel'|'tache'`, `echeance timestamptz`, `fait_at`, `prepare boolean` ;
  - `activites` : `type`, `contact_id`, `at`, `resume`.

  `source` vaut `natif` ou `hubspot`, et `source_id` est l'identifiant chez la source.
- Routes : `GET /api/i/:slug/entreprises?q=` et `/contacts?q=` (recherche insensible à la casse sur nom, secteur, ville, fonction et email), `GET …/:id` (fiche avec liens), `POST …` (création).
- Si l'instance a un CRM en sens bidirectionnel, `POST` crée aussi chez le CRM via M8a. Avant M8a : 409 « CRM non branché ».

- [ ] Tests service : la recherche trouve « Plasturgie Mornand » avec `plast` ; la fiche entreprise liste ses contacts et ses opportunités ; la création en instance native n'écrit pas de `source_id`.
- [ ] Tests écrans : liste, recherche, ouverture d'une fiche, création d'un contact (maquette `v-conversion.js`, section Entreprises et contacts).
- [ ] `demo:seed` charge les entreprises, contacts, opportunités et tâches fictives de la maquette.
- [ ] PR, CI verte, merge.

## Lot 8 — M8a Connecteur HubSpot (miroir)

**Fichiers :** `src/connecteurs/hubspot/client.ts`, `mapping.ts`, `sync.ts`, `write.ts`, `fixtures/*.json` (fictives), tests ; `web/src/pages/parametres/ConnexionCrm.tsx`.

**Interfaces :**
- Secret : `HUBSPOT_TOKEN` dans `secrets/instances/<slug>.env` (jeton d'application privée).
- `hubspotClient(token, { fetch })` : réessaie sur 429 et 5xx avec attente exponentielle (3 essais), puis lève `HubspotError`.
- Mapping : `mapCompany(h): EntrepriseInput`, `mapContact`, `mapDeal` (étapes lues dans l'API Pipelines ; `closedwon` devient `clos = 'gagne'`, `closedlost` devient `clos = 'perdu'`), `mapTask` (`hs_task_type` EMAIL, CALL ou TODO devient `canal`).
- `syncHubspot(ctx): Promise<SyncReport>` est incrémental : recherche sur `hs_lastmodifieddate > derniere_synchro`, avec un historique complet au premier passage. Objets suivis : `reglages.objets`. Champs ignorés : `reglages.champsExclus`.
- Écritures (`write`) : `deal.stage`, `task.complete`, `contact.create`, `company.create`. Elles sont refusées si `reglages.sens === 'lecture'`, et passent en simulation si `!ctx.reel`.
- `reglages` = `{ frequence, sens: 'deux_sens'|'lecture', objets: string[], champsExclus: string[] }`. Défauts : `15min`, `deux_sens`, les quatre objets, `['annualrevenue']`.
- Écran Paramètres > Connexions > CRM : fréquence, sens, objets, champs, bouton Synchroniser, état et dernière erreur (maquette `v-plateforme.js`, `VIEWS.parametres`).

- [ ] Tests mapping sur les fixtures fictives.
- [ ] Test **vigilance 2** : avec un 429 permanent, la sync lève, ne supprime aucune ligne locale et laisse `etat = 'erreur'` avec le message ; le passage suivant réussit et repasse `etat = 'ok'`.
- [ ] Test **vigilance 3** : avec `phone` exclu, la valeur locale n'est pas écrasée par la sync, et `contact.update` n'envoie pas `phone`.
- [ ] Test : en `sens = 'lecture'`, `deal.stage` est refusé ; avec `reel = false`, aucune requête HTTP et un journal « simulation ».
- [ ] Reprise du premier mandat sous HubSpot :
  - l'agent crée l'instance avec son vrai nom, en base ;
  - Marc dépose le jeton dans `secrets/instances/<slug>.env` ;
  - premier passage complet en lecture seule, puis contrôle par Marc ;
  - passage en `deux_sens` sur sa décision.
- [ ] PR, CI verte, merge.

**Tester (Marc)** : Paramètres > Connexions : l'état est « Connecté » ; Entreprises et Contacts affichent les données HubSpot du premier mandat.

## Lot 9 — M5a Pipeline

**Fichiers :** `src/crm/pipeline.ts`, tests ; `web/src/pages/Pipeline.tsx`, `web/src/pages/pipeline/Colonne.tsx`, `ClotureModal.tsx`, `FicheOpportunite.tsx`.

**Interfaces :**
- `conversionRates(opps: Opp[], etapes: string[]): (number | null)[]` : rang atteint = index de l'étape, `etapes.length` si gagnée ; taux k = atteint(k+1) / atteint(k), arrondi ; `null` si le dénominateur vaut 0. Copier la règle de `rang` et `conversions` (maquette `v-conversion.js`).
- `PATCH /api/i/:slug/opportunites/:id` avec `{ etape }` ou `{ clos, motif }` ou `{ rouvrir: true }` : écrit chez le CRM si l'instance en a un et que le sens le permet, journalise, renvoie l'opportunité.
- Écran :
  - colonnes des étapes, puis Gagnées et Perdues ;
  - taux entre colonnes, avec `<Tip>` ;
  - glisser-déposer ; déposer sur Gagnées ou Perdues ouvre la fenêtre de clôture (motif) ;
  - badge « Miroir HubSpot, synchronisé il y a N min » et bouton Synchroniser ;
  - vue Matrice en option.

- [ ] Tests `conversionRates` : jeu fictif de la maquette (SIMATIS : 83, 80, 63, 60, 67) ; liste vide, toutes les valeurs à `null` ; une affaire perdue en qualification compte jusqu'à la qualification.
- [ ] Test API : déplacer en `negociation` appelle `write('deal.stage')` une fois ; `rouvrir` remet `clos` à `null`.
- [ ] Vérification dans le navigateur : glisser-déposer, clôture, réouverture.
- [ ] PR, CI verte, merge.

## Lot 10 — M8b Gmail et Agenda

**Fichiers :** `src/connecteurs/google/oauth.ts`, `gmail.ts`, `agenda.ts`, `creneaux.ts`, tests ; `src/admin/cli.ts` (`google:connect`).

**Interfaces :**
- `npm run admin -- google:connect --instance <slug>` : flux OAuth avec redirection locale sur le poste, puis écriture de `secrets/instances/<slug>.google.json` (jeton de rafraîchissement). Portées : `gmail.compose`, `gmail.readonly`, `calendar.readonly`. Le conteneur ne monte `secrets/` qu'en lecture seule.
- `createDraft(ctx, { to, subject, html }): Promise<{ draftId }>` : corps HTML sans bloc de signature ; simulé si `!ctx.reel`.
- `historique(ctx, email, { mois }): Promise<Message[]>` : extraits seulement, sauf réglage « corps complet ».
- `freeBusy(ctx, debut, fin): Promise<Intervalle[]>`.
- `creneauxLibres(occupe: Intervalle[], { nombre, delaiJours, plages: [string, string][], tamponMin, jours: 'ouvres'|'lun-jeu'|'tous', fuseau: 'Europe/Paris' }, maintenant: Date): Date[]` : fonction pure. Règle : créneaux variés, sur des jours différents, jamais avant J+`delaiJours` en jours ouvrés.

- Écran Paramètres > Connexions > Messagerie et Agenda :
  - historique lu (3, 12 ou 24 mois) et contenu lu (extraits ou corps complet) ;
  - calendriers lus et marge autour des rendez-vous ;
  - lignes verrouillées « sans signature » et « aucun envoi direct » ;
  - une connexion absente affiche la commande `google:connect` que l'agent lance.
- [ ] Tests `creneauxLibres` : un samedi n'est jamais proposé ; une réunion bloque son créneau et la marge ; trois créneaux sur trois jours différents ; `nombre = 0` renvoie une liste vide.
- [ ] Test `createDraft` : le HTML envoyé ne contient ni « -- » ni bloc de signature ; avec `reel = false`, aucun appel HTTP.
- [ ] Test : une instance sans `<slug>.google.json` a `getConnector(..., 'messagerie') === null`.
- [ ] PR, CI verte, merge.

## Lot 11 — M2a Brief du jour et À valider

**Fichiers :** `src/pilotage/brief.ts`, `realisees.ts`, `src/pilotage/types-propositions.ts`, tests ; `web/src/pages/Brief.tsx`, `AValider.tsx`.

**Interfaces :**
- `GET /api/i/:slug/brief` renvoie `{ rdv: Rdv[]; taches: Tache[] (en retard et du jour, non faites); realisees: { veille: Compte; semaine: Compte; mois: Compte } }`, avec `Compte = { email: number; appel: number; autre: number; total: number }`.
- `compterRealisees(taches: { canal; fait_at }[], maintenant: Date, fuseau = 'Europe/Paris'): { veille; semaine; mois }` : la veille est le dernier jour ouvré ; la semaine et le mois sont glissants (7 et 30 jours, aujourd'hui compris).
- `POST /api/i/:slug/taches/:id/fait` : met `fait_at` et écrit chez le CRM (`task.complete`).
- Types de propositions enregistrés (S4) :
  - `email.brouillon` (action `brouillon`, `apply` = `createDraft`) ;
  - `crm.tache` (action `tache`, `apply` = `task.create`) ;
  - `note.second_cerveau` (action `cerveau`, brouillon uniquement).
- À valider : liste filtrable (Tout, Brouillon, Tâche CRM, Second cerveau, Traités), détail, Valider, Modifier, Écarter. La jauge porte l'infobulle du niveau d'autonomie (texte dans la maquette `v-pilotage.js`).

- [ ] Test **vigilance 4** : une tâche due le 7 octobre à 23 h 30 (Paris), soit 21 h 30 UTC, est « hier » le 8 octobre et « du jour » le 7.
- [ ] Tests `compterRealisees` : un lundi, la veille est le vendredi ; une tâche de 31 jours est hors du mois.
- [ ] Test : valider un `email.brouillon` appelle `createDraft` une fois et passe la proposition à `appliquee` ; écarter n'appelle rien.
- [ ] Vérification dans le navigateur : filtres par canal, Marquer fait, badge « Brouillon prêt dans Gmail ».
- [ ] PR, CI verte, merge.

## Lot 12 — M6 Routines Claude

**Fichiers :** `src/routines/schema.ts`, `params.ts`, `service.ts`, `outils-mcp.ts`, `planification.ts`, tests ; `runner/runner.ts`, `runner/fr.simatis.runner.plist` ; `web/src/pages/Routines.tsx`, `web/src/pages/parametres/Routines.tsx`.

**Interfaces :**
- Table `routines` (métier) : `cle 'quotidienne'|'nettoyage'|'hebdo'|'evenement'`, `actif`, `params jsonb`, `skill text` (nom de la skill Claude).
- Table `executions` (métier) : `routine`, `statut 'demandee'|'en_cours'|'terminee'|'echouee'`, `demande_par`, `debut`, `fin`, `etapes jsonb`, `rapport jsonb { fait, attente, echec }`. Index unique partiel sur `(instance_id, routine)` où `statut in ('demandee', 'en_cours')`.
- `paramsSchemas` (Zod), valeurs et bornes reprises de `PARAMS_DEF` et `PARAMS_DEFAUT` (maquette `v-plateforme.js` et `data.js`). Exemple : `quotidienne.max` est un entier de 1 à 50, défaut 20.
- `demanderExecution(tx, routine, par): Promise<Execution>` : lève `DejaEnCours` si une exécution est ouverte.
- La planification crée les demandes à l'heure réglée, avec rattrapage d'une seule exécution manquée par jour.
- Exécuteur local (`npm run runner`, lancé par launchd sur le poste) :
  - il interroge `GET /api/runner/demandes` (jeton `runner`) ;
  - pour chaque demande, il crée un jeton MCP temporaire limité à l'instance (une heure) ;
  - il lance `claude -p "<prompt>" --mcp-config <fichier temporaire> --allowedTools "mcp__simatis__*"`, où le prompt nomme la skill, l'identifiant d'exécution et l'instance ;
  - il remonte l'état.
- Outils MCP pour les skills :
  - `parametres_routine()` ;
  - `taches_du_jour({ canaux, retardMaxJours })` ;
  - `historique_contact({ contactId })` ;
  - `creneaux_libres()` (utilise les paramètres) ;
  - `proposer_brouillon({ tacheId, objet, corps })` ;
  - `proposer_tache(...)` ;
  - `etape_routine({ executionId, etape, statut })` ;
  - `rapport_routine({ executionId, fait, attente, echec })`.

  Un outil qui a besoin d'une connexion absente lève « Messagerie non configurée pour <instance> », puis la routine s'arrête.
- Les skills existantes (relance quotidienne, nettoyage des tâches) sont adaptées hors dépôt pour n'utiliser que ces outils.
- Écrans :
  - Routines Claude : cartes, étapes, rapport, Lancer maintenant avec suivi pas à pas par interrogation de `GET …/executions/:id` ;
  - Paramètres > Routines Claude : formulaires enregistrés à chaque modification.

- [ ] Test **vigilance 5** : deux `demanderExecution` successives, la seconde lève `DejaEnCours` ; après `terminee`, une nouvelle demande passe.
- [ ] Tests paramètres : `max = 99` est rejeté par le schéma ; `canaux = ['email']` exclut les appels de `taches_du_jour`.
- [ ] Test : sur une instance sans messagerie, `proposer_brouillon` lève l'erreur attendue et l'exécution passe à `echouee` avec ce message dans `rapport.echec`.
- [ ] Test runner (commande `claude` remplacée par un faux script) : le fichier MCP passé contient un jeton de l'instance de la demande, et pas d'une autre.
- [ ] Test de bout en bout sur l'instance `demo` : Lancer maintenant, brouillons dans À valider.
- [ ] PR, CI verte, merge.

**Tester (Marc)** : Brief du jour > Lancer la routine quotidienne ; les étapes défilent ; les brouillons attendent dans À valider puis dans Gmail.

## Lot 13 — M9 Mandats prospects

**Fichiers :** `src/demo/fixtures.ts` (jeu fictif repris de la maquette), `src/demo/service.ts`, tests ; `web/src/pages/parametres/Mandat.tsx`.

**Interfaces :**
- `creerProspect(db, { nom }): Promise<Instance>` : type `prospect`, `config.ecrituresReelles = false` verrouillé, connexions `fake`, données du jeu fictif.
- `reinitialiserDemo(db, id)` : purge, puis rechargement du jeu.
- `convertirProspect(db, id, { crm: 'hubspot' | null }): Promise<Instance>` : purge les données fictives, passe le type à `mandat`, crée les connexions à l'état `non_configuree`, journalise. Refusée si l'instance n'est pas un prospect.
- Partage d'une démo isolée : reporté (hébergement serveur, voir « Plus tard » dans `docs/plan.md`).

- [ ] Test : une instance `prospect` ne peut jamais passer `ecrituresReelles` à vrai.
- [ ] Test : après `convertirProspect`, zéro entreprise et trois connexions `non_configuree` ; une seconde conversion est refusée.
- [ ] Test : `reinitialiserDemo` restaure le nombre d'opportunités du jeu fictif.
- [ ] PR, CI verte, merge.

## Lot 14 — M2b Tableau de bord

**Fichiers :** `src/pilotage/funnel.ts`, test ; `web/src/pages/Tableau.tsx`.

- `simulerFunnel({ leads, l2p, p2d, d2c, panier, objectif }): { prospects; devis; commandes; caAnnuel; leadsNecessaires }`, avec les formules de `VIEWS.tableau` (maquette `v-pilotage.js`).
- Indicateurs : pipeline ouvert, opportunités chaudes, taux de réponse de la dernière campagne.
- [ ] Test : les paramètres SIMATIS de la maquette donnent le même chiffre d'affaires annuel que la maquette.
- [ ] PR, CI verte, merge.

## Lot 15 — M5b Rendez-vous et Devis

**Fichiers :** `src/conversion/rdv.ts`, `devis.ts`, tests ; `web/src/pages/RendezVous.tsx`, `Devis.tsx`.

- Rendez-vous lus dans l'agenda de l'instance. Préparation : questions selon les critères de qualification incomplets ; la grille vit dans la configuration privée de l'instance, jamais dans le dépôt. Compte rendu, puis proposition `crm.tache`.
- Devis : module `devis`, actif pour l'instance `propre` seulement. Lignes préparées, prix fixés par Marc, transmission par proposition de niveau L2.
- [ ] Test : `GET /api/i/<mandat>/devis` renvoie 404.
- [ ] Test : un devis dont un prix est vide ne peut pas être validé.
- [ ] PR, CI verte, merge.

## Bloqué ou reporté

- **M4 Prospection et Bases vivantes** : spec à finir. Marc doit essayer la maquette, et la base de données partenaire est en conception. Le plan détaillé sera écrit quand les deux seront tranchés.
- **Plan d'action, Diagnostic, Détection, écran Autonomie, vue du second cerveau** : reportés (voir `docs/plan.md`).
- **Démo isolée partageable** : quand l'OS sera hébergé sur un serveur.

## Questions à trancher, sans bloquer les premiers lots

1. Sens de synchronisation HubSpot par défaut pour un nouveau mandat : lecture seule d'abord (proposé), puis dans les deux sens sur décision de Marc. Avant le lot 8.
2. Google Workspace ou gmail.com pour SIMATIS (vérification de l'application Google). Avant le lot 10.
3. « Tâches réalisées » : compter les tâches CRM marquées faites (proposé) ou les emails réellement envoyés et les appels passés ? Avant le lot 11.
4. Une collaboratrice utilisera-t-elle l'OS (plusieurs utilisateurs, favoris et brief par personne) ? Avant le lot 6 si oui.
