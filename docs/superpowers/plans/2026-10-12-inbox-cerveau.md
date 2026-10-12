# Inbox, livraison 3 (partie OS) — plan d'implémentation

> **Pour les agents :** sous-skill requise : superpowers:executing-plans. Cases `- [ ]`.

**Objectif :** outils de lecture (mails sans réponse, brouillons, rendez-vous passés) et accès
au second cerveau réservé à la routine Inbox.

**Architecture :** appels Google bruts dans `src/connecteurs/google/google.ts` ; sélection pure
(contacts, domaines, jour ouvré) dans `src/inbox/lecture.ts` ; outils MCP dans
`src/inbox/outils-mcp.ts` ; drapeau `cerveau` dans `ROUTINES`, `runner-api.ts` et `runner.ts`.

**Spec :** `docs/superpowers/specs/2026-10-12-inbox-cerveau-design.md`.

## Contraintes globales

- Lecture seule côté Google, scopes existants. Connexion fictive → `[]`. Pas d'`executionId` sur ces outils.
- Jamais d'accès fichiers pour une démo. Chemin du second cerveau seulement via `SECOND_CERVEAU_DIR` (poste).
- Données de test fictives (`*.example`).

## Review Focus

- Expéditeur au format `Nom <adresse>` et casse différente → test tâche 2 (`adresseDe`).
- Domaine générique (gmail.com) déclaré comme domaine d'une entreprise : ne pas rattacher tous les mails gmail → test tâche 2.
- Un fil dont le dernier message est une réponse du pilote → écarté, test tâche 2.
- Dossier `SECOND_CERVEAU_DIR` introuvable → lancement sans fichiers, message explicite → test tâche 4.
- Rendez-vous sans participant (seul) → écarté, test tâche 2.

---

### Tâche 1 : lectures Google

`src/connecteurs/google/google.ts` :

```ts
export async function compteGmail(ctx, options?): Promise<string>;            // GET users/me/profile → emailAddress (minuscules)
export type Fil = { threadId: string; de: string | null; date: string | null; objet: string | null; extrait: string };
export async function filsRecents(ctx, jours: number, options?): Promise<Fil[]>; // threads?q=in:inbox newer_than:{jours}d (100), puis threads/{id}?format=metadata ; garde le DERNIER message
export type Brouillon = { draftId: string; objet: string | null; a: string | null; date: string | null };
export async function brouillons(ctx, options?): Promise<Brouillon[]>;        // drafts?maxResults=50, puis drafts/{id}?format=metadata
export async function compteAgenda(ctx, options?): Promise<string>;           // GET calendars/primary → id
```
`Evenement` gagne `lien: string | null` (`htmlLink`).

- [ ] Tests `src/connecteurs/google/lecture.test.ts` (fetch simulé, sans base) : `reads the Gmail account`, `keeps the last message of each recent thread`, `lists drafts with subject, recipient and date`, `gives the link of a meeting`. RED → implémenter → GREEN → commit `Google : lire les fils récents, les brouillons et le compte`.

### Tâche 2 : sélection pure

`src/inbox/lecture.ts` :

```ts
export const adresseDe = (de: string | null): string | null;   // « Nom <a@b> » → a@b, minuscules
export const domaineDe = (adresse: string): string;
export function plusDunJourOuvre(date: Date, maintenant: Date): boolean; // Paris ; vendredi soir → vrai lundi soir seulement si un jour ouvré entier est passé
export type Annuaire = { contacts: { id: string; email: string | null; entrepriseId: string | null }[]; entreprises: { id: string; domaine: string | null }[] };
export function rattacher(adresse: string, a: Annuaire): { contactId: string | null; entrepriseId: string | null } | null; // adresse de contact, sinon domaine d'entreprise (domaines génériques ignorés : gmail.com, googlemail.com, outlook.com, outlook.fr, hotmail.com, hotmail.fr, yahoo.com, yahoo.fr, icloud.com, orange.fr, free.fr, wanadoo.fr, laposte.net)
export function mailsARepondre(fils: Fil[], moi: string, a: Annuaire, maintenant: Date): MailSansReponse[];
export function brouillonsAnciens(b: Brouillon[], jours: number, maintenant: Date): Brouillon[];
export function rendezVousExternes(e: Evenement[], domaineMoi: string, a: Annuaire, maintenant: Date): RendezVousPasse[];
```
`MailSansReponse` = `Fil` + `lien`, `contactId`, `entrepriseId` ; `RendezVousPasse` = `eventId`, `titre`, `debut`, `fin`, `participants` (extérieurs), `lien`, `contactId`, `entrepriseId`. Lien Gmail : `https://mail.google.com/mail/?authuser={moi}#all/{threadId}` (brouillons : `#drafts`).

- [ ] Tests `src/inbox/lecture.test.ts` : `keeps a mail from a known contact left unanswered for a working day`, `drops a thread whose last message is mine`, `drops a mail too recent, counting working days`, `matches a company by domain but never a generic one`, `drops an unknown sender`, `keeps only old drafts`, `keeps finished meetings with an outsider, never internal, all-day, future or solo ones`. RED → GREEN → commit `Inbox : sélection des mails, brouillons et rendez-vous`.

### Tâche 3 : outils MCP et santé

`mails_sans_reponse` (`jours` 1–60, défaut 14), `brouillons_en_attente` (`jours` 1–30, défaut 3), `rendez_vous_passes` (`depuis` ISO facultatif, défaut −3 jours, borné à 31 jours). Connexion lue comme dans `routines/outils-mcp.ts` (exporter `connexion` et `google` de ce fichier) **sans** `executionId`. L'annuaire est lu dans l'instance (contacts : id, email, entrepriseId ; entreprises : id, domaine). Étape 3 de la routine `inbox` : besoin `messagerie`.

- [ ] Tests `src/inbox/outils-mcp.test.ts` (ajouts) : `returns empty lists on a demo's fictive tools` (jeton sur `demo`) ; `answers a readable error without stopping the run when messaging is missing` (instance sans connexion, exécution `inbox` demandée → `isError`, exécution toujours `demandee`) ; dans `src/routines/sante.test.ts` : `flags the Inbox routine when messaging is missing`. RED → GREEN → commit `Inbox : outils de lecture pour la routine`.

### Tâche 4 : second cerveau pour l'exécuteur

- `ROUTINES` : `cerveau?: true`, posé sur `inbox`.
- `/api/runner/demandes` : `cerveau: boolean` (= déclaré et instance ≠ `prospect`).
- `runner.ts` : `RunnerOptions.cerveau?: string` (défaut `process.env.SECOND_CERVEAU_DIR` dans `main`) ; `export function argumentsClaude(d: Demande, config: string, cerveau: string | null): { args: string[]; cwd?: string }` ; `lancer(commande, args, cwd?)`. Avec cerveau accessible (`stat` → dossier) : `--add-dir <dir>`, outils `mcp__simatis__*`, `Read(/<dir>/**)`, `Edit(/<dir>/**)`, `Write(/<dir>/**)` (préfixe `//` pour un chemin absolu dans les règles Claude Code), `Glob`, `Grep`, `cwd` = dossier ; message de lancement augmenté (dossier, ajout seulement, jamais de suppression). Demande `cerveau` sans dossier : message « Second cerveau non accessible sur ce poste : saute ce qui en a besoin et signale-le dans le rapport. »
- `.env.example` : `SECOND_CERVEAU_DIR=` ; `docs/EXPLOITATION.md` : une phrase.
- [ ] Tests (`src/routines/routines.test.ts`) : `runner: opens the second brain to the Inbox routine only` (args et cwd) ; `runner: never opens files for a demo` (`demandes` → `cerveau: false` pour `demo`) ; `runner: launches without files and says so when the folder is missing`. RED → GREEN → `npm run verify` → commit `Exécuteur : second cerveau ouvert à la seule routine Inbox` → PR, CI, merge.
