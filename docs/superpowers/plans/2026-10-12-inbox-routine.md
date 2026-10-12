# Inbox, livraison 2 : outils MCP et routine « Inbox » — plan d'implémentation

> **Pour les agents :** sous-skill requise : superpowers:executing-plans (ou
> superpowers:subagent-driven-development). Les étapes utilisent des cases `- [ ]`.

**Objectif :** donner à la routine Claude « Inbox » (skill privée `alimenter-inbox`, livraison 3)
les outils pour déposer des sujets, lire ceux qui ont été traités et marquer leur report dans le
second cerveau, et ajouter cette routine aux Routines Claude.

**Architecture :** trois outils MCP de portée instance dans un nouveau fichier
`src/inbox/outils-mcp.ts` (importé par `src/mcp/server.ts`), appuyés sur deux fonctions de
service dans `src/inbox/report.ts`. La routine `inbox` s'ajoute à `ROUTINES` avec ses réglages
(heure, jours) et sa planification ; les lignes `routines` sont créées d'elles-mêmes par
`listerRoutines`.

**Tech :** Fastify, Drizzle (Postgres + RLS), zod, SDK MCP, React 19, Vitest.

**Spec :** `docs/superpowers/specs/2026-10-11-inbox-design.md` (section 3).

## Contraintes globales

- Clé `inbox`, skill `alimenter-inbox`, nom « Routine Inbox ».
- Par défaut chaque jour ouvré, avant la routine quotidienne de relance (6h30 ; la quotidienne est à 7h00), ou à la demande ; rythme réglable comme les autres.
- Étapes affichées, mot pour mot : « Lire les sujets traités depuis le dernier passage » ; « Reporter le traitement et exporter les notes validées dans le second cerveau » ; « Chercher les nouveaux sujets (messagerie, agenda, second cerveau) » ; « Déposer les nouveaux sujets dans l'Inbox ».
- Outils : `deposer_sujet` (renvoie `cree` ou `existant`, sans erreur si la clé existe), `sujets_traites`, `marquer_reporte`.
- La routine ne voit que l'Inbox de l'instance de son jeton. Elle n'envoie rien, ne modifie rien dans la messagerie ; dans le second cerveau elle ne fait qu'ajouter.
- La skill `alimenter-inbox` n'est jamais dans ce dépôt.
- Node : `PATH=/opt/homebrew/opt/node@24/bin:$PATH`.

## Review Focus

- Un sujet reporté, remis à traiter puis retraité doit être reporté à nouveau → test tâche 1 (`remettreATraiter` efface `reporteAt`).
- Une note écartée ne doit jamais être exportée : seulement signalée traitée → test tâche 1.
- `marquer_reporte` avec un id d'une autre instance ou d'un sujet encore à traiter : ignoré, pas d'erreur → test tâche 1.
- Une routine ne peut pas déposer de faux sujet « à valider » (réservé aux propositions) ni d'origine `os` → test tâche 2.
- Un lien non web refusé au dépôt doit revenir à Claude comme une erreur lisible, pas casser la routine → test tâche 2.

---

### Tâche 1 : report des sujets traités (service)

**Fichiers :** créer `src/inbox/report.ts`, `src/inbox/report.test.ts` ; modifier `src/inbox/service.ts` (`remettreATraiter` remet `reporteAt` à `null`).

**Interfaces produites :**

```ts
export type SujetTraite = {
  id: string; type: TypeSujet; titre: string; statut: 'tache' | 'traite';
  traiteAt: string | null; traitePar: string | null; tacheId: string | null;
  source: string; sourceId: string | null; lien: string | null;
  // Proposals only: what the pilot decided, and the note to export when a second-brain note was validated.
  decision: 'appliquee' | 'ecartee' | 'echec' | null;
  note: { titre: string; texte: string; destination: string | null } | null;
};
export async function sujetsTraites(tx: Tx): Promise<SujetTraite[]>;   // statut ≠ a_traiter, reporteAt null, traiteAt croissant, 200 au plus
export async function marquerReporte(tx: Tx, ids: string[]): Promise<number>; // pose reporteAt sur ceux de l'instance, traités et non reportés ; renvoie le nombre
```

`note` n'est rempli que pour une proposition `note.second_cerveau` au statut `appliquee` (contenu `titre`, `texte`, `destination`). Pour les autres sujets `a_valider`, `decision` = statut de la proposition, `note` = `null`.

- [ ] **Étape 1 : tests** `src/inbox/report.test.ts` (`setupTestApp`, mandats `a` et `b`, niveaux d'autonomie par défaut, `pilotage/types-propositions.js` importé) :
  - `lists treated subjects not yet reported, never those to handle` ;
  - `gives the note content of a validated second-brain note` (proposer `note.second_cerveau`, la valider → `decision: 'appliquee'`, `note` = `{ titre, texte, destination }`) ;
  - `only flags a rejected note as treated, without its content` (`decision: 'ecartee'`, `note: null`) ;
  - `marks reported subjects once, ignoring other instances and subjects to handle` (`marquerReporte` → 1 ; relu, il n'est plus listé ; id de `b` et id `a_traiter` comptent 0) ;
  - dans `src/inbox/service.test.ts` : `reports again a subject put back then treated again` (report posé, `remettreATraiter`, `marquerTraite` → de nouveau dans `sujetsTraites`).
- [ ] **Étape 2 :** `npx vitest run src/inbox` → échec (module absent).
- [ ] **Étape 3 :** implémenter ; corriger le commentaire de `note.second_cerveau` dans `src/pilotage/types-propositions.ts` (l'export passe désormais par la routine Inbox).
- [ ] **Étape 4 :** `npx vitest run src/inbox src/propositions` → vert.
- [ ] **Étape 5 :** commit `Inbox : lire les sujets traités et marquer leur report`.

### Tâche 2 : outils MCP

**Fichiers :** créer `src/inbox/outils-mcp.ts`, `src/inbox/outils-mcp.test.ts` ; modifier `src/mcp/server.ts` (import).

**Consomme :** `deposerSujet`, `SujetInvalide` (livraison 1), `sujetsTraites`, `marquerReporte` (tâche 1), `registerTool` (`src/mcp/tools.ts`).

| Outil | Entrée (zod) | Sortie |
| --- | --- | --- |
| `deposer_sujet` | `type` ∈ types sauf `a_valider` ; `titre` 1–300 ; `resume` ≤ 5 000 facultatif ; `origine` ∈ `messagerie`, `agenda`, `cerveau` ; `cle` 1–300 ; `lien` ≤ 2 000 facultatif ; `echeance` ISO avec fuseau facultative ; `contactId`, `entrepriseId` uuid facultatifs ; `executionId` facultatif | `{ statut: 'cree' \| 'existant', id }` (source `routine`, `sourceId` = `cle`) |
| `sujets_traites` | `executionId` facultatif | `SujetTraite[]` |
| `marquer_reporte` | `ids` : uuid[], 1–200 ; `executionId` facultatif | `{ reportes: number }` |

Descriptions (français, pour Claude) : dire que le dépôt est sans effet si la clé existe déjà, même traitée ; que `sujets_traites` donne le contenu des notes validées à exporter dans l'inbox du second cerveau ; que `marquer_reporte` se fait après le report ou l'export. `SujetInvalide` est rendu comme erreur d'outil avec son message.

- [ ] **Étape 1 : tests** `src/inbox/outils-mcp.test.ts` (même montage que `src/routines/routines.test.ts` : `seedDemoIfEmpty`, `app.listen`, client MCP avec jeton `instance` sur `helioval`) :
  - `deposits a subject, then answers existant for the same key` ;
  - `refuses an a_valider subject or an os origin` (erreur de validation) ;
  - `returns a readable error for a link that is not a web address` (`isError`, texte contenant « Lien invalide ») ;
  - `lists treated subjects and marks them reported` (déposer, marquer traité via `marquerTraite`, `sujets_traites` le contient, `marquer_reporte` → `{ reportes: 1 }`, relu vide) ;
  - `only sees the token instance` (sujet déposé dans `aquaterra` absent de `sujets_traites` côté `helioval`, et `marquer_reporte` sur son id → 0).
- [ ] **Étape 2–4 :** échec, implémentation, `npx vitest run src/inbox src/mcp src/routines` → vert.
- [ ] **Étape 5 :** commit `Inbox : outils MCP pour la routine`.

### Tâche 3 : la routine « Inbox »

**Fichiers :** modifier `src/routines/schema.ts` (`CleRoutine` et les deux `enum` de `cle`/`routine` : ajouter `'inbox'`), `src/routines/params.ts`, `src/routines/planification.ts`, `web/src/pages/parametres/Routines.tsx` ; tests dans `src/routines/routines.test.ts`, `web/src/pages/Routines.test.tsx` si une liste fixe y est vérifiée, `src/api/routes.test.ts` si un nombre de routines y est attendu.

- `paramsSchemas.inbox = z.object({ heure: z.enum(HEURES), jours: z.enum(JOURS) })` ; défaut `{ heure: '6h30', jours: 'Jours ouvrés' }`.
- `ROUTINES` : `{ cle: 'inbox', nom: 'Routine Inbox', skill: 'alimenter-inbox', etapes: [les quatre étapes, sans besoin de connexion] }`, placée en tête (elle passe avant la quotidienne).
- `rythme('inbox')` : même formulation que la quotidienne (« Chaque jour ouvré à 6h30, ou à la demande »). `resume('inbox')` : « Chaque jour ouvré à 6h30 : reporte dans le second cerveau ce qui a été traité, puis dépose les nouveaux sujets dans l'Inbox. »
- `heurePrevue('inbox', …)` : mêmes règles de jours que la quotidienne.
- Écran Paramètres > Routines : `CHAMPS.inbox` = heure (select `HEURES`) et jours (select des trois valeurs).
- Si `drizzle-kit generate` produit une migration (enum texte), la garder ; sinon rien.

- [ ] **Étape 1 : tests** dans `src/routines/routines.test.ts` :
  - `adds the Inbox routine with its skill, steps and default rhythm` (GET `/api/i/helioval/routines` → entrée `inbox`, skill `alimenter-inbox`, 4 étapes exactes, rythme « Chaque jour ouvré à 6h30, ou à la demande ») ;
  - `plans the Inbox routine on working days before the daily one` (`heurePrevue('inbox', {}, lundi)` < `heurePrevue('quotidienne', {}, lundi)` ; `null` un samedi) ;
  - `launches the Inbox routine on demand` (POST `/api/i/helioval/routines/inbox/executions` → 200, statut `demandee`).
- [ ] **Étape 2–4 :** échec, implémentation, `npx vitest run src/routines src/api web` → vert.
- [ ] **Étape 5 :** `npm run verify` complet → vert. Contrôle navigateur (base de démo jetable) : la carte « Routine Inbox » dans Routines Claude et ses réglages dans Paramètres.
- [ ] **Étape 6 :** commit `Inbox : routine Inbox dans Routines Claude`, PR, revue, CI verte, merge.
