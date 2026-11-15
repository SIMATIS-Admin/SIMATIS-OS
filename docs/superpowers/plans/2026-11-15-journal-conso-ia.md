# Journal de consommation IA — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** afficher dans la console de l'OS, par heure et par sujet, ce qui consomme les jauges Claude et ChatGPT (L5, LH), et archiver chaque journée pendant 13 mois.

**Architecture :** l'exécuteur (`src/runner`, sur le Mac) lit toutes les 5 min les fichiers de session locaux de Claude Code, Cowork et Codex. Il envoie à l'OS des cumuls de jetons par session, heure et modèle, ainsi que les relevés de jauge de Codex. Il déclare aussi chacun de ses propres lancements. L'OS conserve l'historique des jauges, convertit le coût équivalent en points de jauge par un coefficient calibré, ajoute les lignes à la console et fige chaque nuit la veille dans une archive.

**Tech Stack :** TypeScript, Fastify, Drizzle (Postgres, migrations `npm run db:generate`), Vitest, React.

**Spec :** `docs/superpowers/specs/2026-11-15-journal-conso-ia-design.md`

## Global Constraints

- Dépôt public : fixtures et tests **uniquement fictifs**. Jamais de contenu de conversation, en base comme dans le dépôt. On ne garde que des compteurs, des horodatages, des identifiants, des modèles, des titres, des branches et des `cwd`.
- Le relevé ne fait **aucun** appel à un modèle.
- Seau horaire = `date_trunc('hour')` en UTC (les décalages de Paris sont des heures entières). Affichage à l'heure de Paris.
- Jauges : seuil « À VOIR » à **10 points de L5 dans l'heure** ; « ≈ » tant que la hausse cumulée observée est inférieure à **20 points** pour un fournisseur et une jauge ; « non attribué » affiché à partir de **1 point**.
- Calibrage sur les **14 derniers jours**. Historique reconstitué : **30 jours**. Conservation : cumuls, sessions, jauges et lancements **90 jours** ; archive **13 mois**.
- Relevé muet depuis plus de **15 min** : ligne « À VOIR ».
- Aucune ligne de consommation dans les instances de type `prospect` (démo). Plafond propre aux lignes de consommation (**200**), en plus des 300 lignes existantes.
- Textes en français. Format de ligne : `IA-ext · Claude · Code · PR #345 · L5 +6,1 % · LH +1,2 %`.
- `npm run verify` vert avant chaque commit ; `git add` fichier par fichier ; relire `git diff --staged` (aucune donnée réelle).

## Review Focus

1. **Session à cheval sur deux heures** : ses jetons sont répartis dans les deux seaux selon l'horodatage de chaque message, pas tout dans la première heure. Test dans la tâche 8.
2. **Message répété sur plusieurs lignes du fichier** (même `message.id`, contenus découpés) : compté une seule fois. Test dans la tâche 8.
3. **Renouvellement de jauge au milieu d'une heure** : l'heure n'a pas de hausse mesurée (`null`), jamais une hausse négative ni un « non attribué » faux. Test dans la tâche 3.
4. **Relevé envoyé deux fois** (redémarrage de l'exécuteur, reprise des 30 jours) : les cumuls sont remplacés, pas additionnés. Test dans la tâche 4.
5. **Fichier tronqué ou ligne JSON illisible** (écriture en cours) : la ligne est sautée et comptée en anomalie, le reste du fichier est lu. Test dans la tâche 8.

---

### Tâche 1 : tables et migration

**Fichiers :**
- Créer : `src/ia/conso/schema.ts`, migration générée dans `drizzle/`
- Ne **pas** les ajouter à `METIER_TABLES` (`src/db/metier-tables.ts`) : ce ne sont pas des tables d'instance, la purge d'une instance ne doit pas les toucher.

**Interfaces — produit :** tables Drizzle, globales (sans `instance_id`, sans RLS, sur le modèle de `preferences`) :
- `iaSessions` (`ia_sessions`) : `id` text PK (`claude:<sessionId>` ou `chatgpt:<id>`), `fournisseur` ('claude'|'chatgpt'), `outil` ('code'|'cowork'|'codex'|'agent'|'executeur'), `origine` ('ext'|'int'), `sujet` text, `branche` text null, `titre` text null, `cwd` text null, `debut` timestamptz, `vuLe` timestamptz.
- `iaCumuls` (`ia_cumuls`) : `sessionId` → `ia_sessions.id` (cascade), `heure` timestamptz, `modele` text, `entree`, `sortie`, `cacheEcriture`, `cacheLecture` bigint (mode number), `cout` double precision. PK (`session_id`, `heure`, `modele`), index sur `heure`.
- `iaLancements` (`ia_lancements`) : `id` uuid PK, `moteur` ('claude'|'codex'), `sessionId` text null, `cwd` text null, `debut` timestamptz, `sujet` text, `createdAt`.
- `iaJauges` (`ia_jauges`) : `fournisseur`, `at` timestamptz, `source` ('collecteur'|'codex'), `utilise5h` real, `utiliseHebdo` real, `reset5h` timestamptz null, `resetHebdo` timestamptz null. PK (`fournisseur`, `at`, `source`).
- `iaReleve` (`ia_releve`) : `id` text PK ('mac'), `dernierPassage` timestamptz, `anomalies` integer, `detail` text null.
- `iaArchive` (`ia_archive`) : `jour` date, `heure` timestamptz, `origine` text ('ext'|'int'|'non_attribue'), `fournisseur`, `outil` text null, `sujet` text, `entree`, `sortie`, `cacheEcriture`, `cacheLecture` bigint, `cout` double, `l5` real null, `lh` real null, `estime` boolean. PK (`heure`, `origine`, `fournisseur`, `sujet`, `outil`) ; index sur `jour`.

- [ ] **Étape 1 :** écrire `schema.ts`, puis lancer `npm run db:generate`. Attendu : une migration `0094_*.sql` qui crée les 6 tables sans `ENABLE ROW LEVEL SECURITY`.
- [ ] **Étape 2 :** lancer `npm run typecheck`. Attendu : vert.
- [ ] **Étape 3 :** commit `feat(conso-ia): tables du journal de consommation IA`.

### Tâche 2 : coût équivalent

**Fichiers :** créer `src/ia/conso/cout.ts`, `src/ia/conso/cout.test.ts`

**Interfaces — produit :**
```ts
export type Jetons = { entree: number; sortie: number; cacheEcriture: number; cacheLecture: number };
export function coutEquivalent(fournisseur: 'claude' | 'chatgpt', modele: string, j: Jetons): { cout: number; modeleConnu: boolean };
```

Seuls les **rapports** comptent : le calibrage absorbe l'échelle. Pour chaque famille, une table de prix par million de jetons (entrée, sortie, écriture et lecture de cache), relevée sur les pages de prix publiques d'Anthropic et d'OpenAI le jour de l'implémentation. Mettre la date du relevé en commentaire.
- Familles Claude : `opus`, `sonnet`, `haiku`, `fable`, par sous-chaîne du nom de modèle.
- Familles ChatGPT : `gpt-5*` / `codex` par défaut.
- Modèle inconnu : prix de la famille la plus chère du fournisseur, `modeleConnu: false`.

- [ ] **Étape 1 :** tests :
  - `'la lecture de cache coûte une fraction de l'entrée'` : `coutEquivalent('claude','claude-sonnet-5-5',{entree:0,sortie:0,cacheEcriture:0,cacheLecture:1e6}).cout` est strictement inférieur au même calcul avec `entree:1e6` ;
  - `'opus coûte plus que sonnet à jetons égaux'` ;
  - `'un modèle inconnu est signalé'` : `modeleConnu === false`, avec un `cout > 0`.
- [ ] **Étape 2 :** `npx vitest run src/ia/conso/cout.test.ts`. Attendu : FAIL (module absent).
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** relancer. Attendu : PASS. Commit `feat(conso-ia): coût équivalent par modèle`.

### Tâche 3 : calibrage (fonctions pures)

**Fichiers :** créer `src/ia/conso/calibrage.ts`, `src/ia/conso/calibrage.test.ts`

**Interfaces — produit :**
```ts
export type PointJauge = { at: Date; utilise: number; reset: Date | null };
export function hausseParHeure(points: PointJauge[], heures: Date[]): Map<number, number | null>; // clé = heure.getTime()
export type Coefficient = { k: number; points: number; estime: boolean } | null;
export function coefficient(hausses: Map<number, number | null>, couts: Map<number, number>): Coefficient;
export function nonAttribue(hausse: number | null, cout: number, c: Coefficient): number | null;
```

Règles :
- `hausseParHeure` : hausse = utilisé au dernier relevé ≤ fin de l'heure, moins utilisé au dernier relevé ≤ début de l'heure.
  - `null` s'il manque un relevé à l'un des deux bouts, si le `reset` a changé entre les deux, ou si la valeur a baissé.
- `coefficient`, sur les heures avec `cout > 0` et une hausse non nulle :
  - calculer `r = hausse / cout` ;
  - ne garder que les heures dont `r` est inférieur ou égal à la médiane des `r` (celles où une part non observée, le Chat, gonfle la hausse sont écartées) ;
  - `k = Σhausse / Σcout` sur ces heures ;
  - `points = Σhausse` sur toutes les heures retenues au départ, `estime = points < 20` ;
  - `null` sans aucune heure exploitable.
- `nonAttribue` : `hausse − k·cout`. Renvoie `null` si `hausse` ou `c` est `null`. Sinon, la valeur arrondie au dixième si elle est ≥ 1, et `0` en dessous.

- [ ] **Étape 1 :** tests sur séries fictives :
  - `'un renouvellement dans l'heure donne null'` (Review Focus 3) ;
  - `'une baisse donne null, jamais une hausse négative'` ;
  - `'le coefficient n'est pas gonflé par une part non observée'` : 10 heures où hausse = 2 × coût, plus 3 heures où hausse = 2 × coût + 5. Attendu : `k` à 2 ± 0,01 ;
  - `'non attribué apparaît pour la part non observée'` : sur une heure de la série précédente avec +5, la fonction renvoie 5 ;
  - `'estimé sous 20 points'`.
- [ ] **Étape 2 :** lancer, vérifier FAIL. **Étape 3 :** implémenter. **Étape 4 :** PASS, commit `feat(conso-ia): calibrage des jauges`.

### Tâche 4 : réception côté OS (relevé et lancements)

**Fichiers :** créer `src/ia/conso/service.ts`, `src/ia/conso/service.test.ts` ; modifier `src/routines/runner-api.ts` (deux routes authentifiées comme les autres)

**Interfaces :**
- Consomme : tables (tâche 1), `coutEquivalent` (tâche 2).
- Produit :
```ts
export type SessionReleve = { id: string; fournisseur: 'claude'|'chatgpt'; outil: 'code'|'cowork'|'codex'|'agent'|'executeur'; sujet: string; branche: string|null; titre: string|null; cwd: string|null; debut: string };
export type CumulReleve = { sessionId: string; heure: string; modele: string } & Jetons;
export type JaugeReleve = { fournisseur: 'chatgpt'; at: string; utilise5h: number; utiliseHebdo: number; reset5h: string|null; resetHebdo: string|null };
export type Releve = { passage: string; anomalies: number; detail?: string; sessions: SessionReleve[]; cumuls: CumulReleve[]; jauges: JaugeReleve[] };
export async function enregistrerReleve(db: Database, r: Releve): Promise<void>;
export async function declarerLancement(db: Database, l: { moteur: 'claude'|'codex'; sessionId?: string; cwd?: string; debut: string; sujet: string }): Promise<{ id: string }>;
```
- Routes :
  - `POST /api/runner/conso-ia` (corps `Releve`, validé par zod, au plus 5 000 cumuls par appel) ;
  - `POST /api/runner/lancements`.

Règles d'`enregistrerReleve` :
- upsert des sessions ;
- upsert des cumuls avec **remplacement** des compteurs et recalcul du `cout` ;
- insertion des jauges sans doublon (`on conflict do nothing`) ;
- upsert de `ia_releve` ;
- **origine** : une session est `int` et prend le `sujet` du lancement si un lancement a le même `sessionId`, ou, pour Codex, le même `cwd` avec un `debut` à moins de 60 s ;
- une session d'outil `executeur` sans lancement correspondant reçoit `int` et le sujet « Lancement de l'OS non identifié » ;
- toutes les autres sont `ext`.

- [ ] **Étape 1 :** tests (`setupTestApp`) :
  - `'un relevé renvoyé deux fois remplace les cumuls'` (Review Focus 4) ;
  - `'une session déclarée par l'exécuteur est IA-int avec son sujet'` ;
  - `'un lancement Codex est rattaché par cwd et heure'` ;
  - `'une session exécuteur non déclarée est IA-int non identifiée'` ;
  - `'la route refuse sans jeton runner'`.
- [ ] **Étape 2 :** FAIL. **Étape 3 :** implémenter. **Étape 4 :** PASS, commit `feat(conso-ia): réception du relevé et des lancements`.

### Tâche 5 : historique des jauges du collecteur

**Fichiers :** créer `src/ia/conso/jauges.ts`, `src/ia/conso/jauges.test.ts` ; modifier `src/app.ts` (minuteur de 60 s dans `onListen`, sur le modèle de `timerSignaux`, arrêté dans `onClose`)

**Interfaces — produit :** `export async function noterJauges(db: Database, limites: LimitesIA): Promise<number>`. Elle insère une ligne par fournisseur `ok` (source `collecteur`, `at = actualiseLe`, `utilise = 100 − restant`) et renvoie le nombre de lignes insérées. Un `actualiseLe` déjà noté ne s'insère pas une deuxième fois.

- [ ] **Étape 1 :** tests :
  - `'note chaque relevé une seule fois'` ;
  - `'ignore un fournisseur indisponible'`.
- [ ] **Étape 2 :** FAIL. **Étape 3 :** implémenter + minuteur (`lireLimitesIA(limitesIAFile)` puis `noterJauges`). **Étape 4 :** PASS, commit `feat(conso-ia): historique des jauges`.

### Tâche 6 : lignes de la console

**Fichiers :**
- Créer : `src/ia/conso/console.ts`, `src/ia/conso/console.test.ts`
- Modifier :
  - `src/console/service.ts` (`LigneConsole.source` accepte `'conso'` ; `fusionnerConsole(evenements, runs, maintenant, conso: LigneConsole[] = [])` garde les 300 dernières lignes non-conso et les 200 dernières lignes conso, triées ensemble ; `lireConsole(tx, maintenant, opts?: { conso?: boolean })`) ;
  - `src/api/routes.ts` (route console : `conso: i.type !== 'prospect'`) ;
  - `web/src/api.ts` (type) ;
  - `web/src/shell/Console.tsx` (icône `📊` pour `source === 'conso'`) ;
  - `src/console/service.test.ts`.

**Interfaces — produit :** `export async function lignesConso(tx: Executor, maintenant: Date): Promise<LigneConsole[]>`

Règles :
- une ligne par (heure, origine, fournisseur, outil, sujet) sur les dernières 24 h, avec `at = heure`, `acteur = 'ia'` et un `id` stable : `conso:<heure ISO>:<origine>:<fournisseur>:<outil>:<sujet>` ;
- L5 et LH = `k × coût`, où `k` vient de `coefficient` sur 14 jours (tâche 3), par fournisseur et par jauge. Les points de jauge sont ceux de `ia_jauges`, **toutes sources confondues** (collecteur et Codex), triés par `at` ;
- texte : `IA-ext · Claude · Code · PR #345 · L5 +6,1 % · LH +1,2 %` ;
  - `≈` devant les valeurs si `estime` (`L5 ≈ +6,1 %`) ;
  - sans coefficient : `· 1,2 M jetons` (jetons pondérés = coût ramené en jetons d'entrée du modèle Sonnet, arrondi) ;
  - nombres au format `fr-FR`, une décimale ;
- niveau `attention` si L5 ≥ 10, sinon `info` ;
- lignes « non attribué » : `Claude · non attribué (Chat claude.ai ?) · L5 +2,0 % · LH +0,3 %`, uniquement quand `nonAttribue` est ≥ 1 sur L5 ou LH ;
- état du relevé :
  - `dernierPassage` plus vieux que 15 min → ligne `attention` « Relevé de consommation IA muet depuis HH:MM : vérifiez l'exécuteur sur le Mac. » ;
  - `anomalies > 0` au dernier passage → ligne `attention` « Relevé de consommation IA : N lignes illisibles (format des fichiers changé ?). ».

- [ ] **Étape 1 :** tests :
  - `'cumule par sujet et par heure'` : deux sessions au même sujet dans la même heure donnent une seule ligne ;
  - `'affiche les jetons tant qu'aucun coefficient n'existe'` ;
  - `'marque ≈ sous 20 points'` ;
  - `'passe en À VOIR à 10 points de L5'` ;
  - `'signale un relevé muet depuis 15 minutes'` ;
  - `'aucune ligne conso dans une instance prospect'` (dans `service.test.ts`, via `lireConsole(..., { conso: false })` et le test de route) ;
  - `'les lignes conso ne chassent pas les lignes des routines'` : 300 lignes de journal et 50 lignes conso → les 350 sont présentes.
- [ ] **Étape 2 :** FAIL. **Étape 3 :** implémenter. **Étape 4 :** PASS. Vérifier dans le navigateur (preview, console d'une instance réelle avec des données insérées en base locale) que la ligne tient sur une ligne. Commit `feat(conso-ia): lignes de consommation dans la console`.

### Tâche 7 : archive quotidienne et purge

**Fichiers :** créer `src/ia/conso/archive.ts`, `src/ia/conso/archive.test.ts` ; modifier `src/app.ts` (minuteur de 10 min)

**Interfaces :**
- Consomme : le calcul des lignes de la tâche 6. Extraire de `console.ts` une fonction partagée `lignesHeures(tx, depuis: Date, jusqua: Date, maintenant: Date): Promise<LigneHeure[]>`, avec `LigneHeure = { heure, origine, fournisseur, outil, sujet, jetons: Jetons, cout, l5: number|null, lh: number|null, estime }`, utilisée par la console et par l'archive.
- Produit : `export async function archiverEtPurger(db: Database, maintenant: Date): Promise<{ jours: string[] }>`

Règles :
- après 1 h (heure de Paris), fige chaque jour terminé non encore archivé, en remontant jusqu'au plus ancien cumul disponible et au plus à 30 jours, dans `ia_archive`. L'insertion se fait **une seule fois** par jour (rien n'est réécrit ensuite) ;
- purge : `ia_archive` de plus de 13 mois ; `ia_cumuls`, `ia_jauges` et `ia_lancements` de plus de 90 jours ; `ia_sessions` sans cumul.

- [ ] **Étape 1 :** tests :
  - `'fige la veille une seule fois'` : deux appels laissent le même nombre de lignes ;
  - `'rattrape un jour manqué'` ;
  - `'les valeurs archivées ne changent plus quand le coefficient évolue'` ;
  - `'n'archive pas avant 1 h du matin'` ;
  - `'purge au-delà de 13 mois et de 90 jours'`.
- [ ] **Étape 2 :** FAIL. **Étape 3 :** implémenter. **Étape 4 :** PASS, commit `feat(conso-ia): archive quotidienne`.

### Tâche 8 : lecture des fichiers de session (exécuteur, fonctions pures)

**Fichiers :** créer `src/runner/conso/lecture.ts`, `src/runner/conso/lecture.test.ts` et les fixtures fictives `test/fixtures/conso-ia/claude-code.jsonl`, `cowork.jsonl`, `codex.jsonl`

**Interfaces — produit :**
```ts
export type MessageLu = { sessionId: string; at: Date; modele: string; jetons: Jetons; branche: string|null; cwd: string|null; entrypoint: string|null };
export type LectureClaude = { messages: MessageLu[]; titre: string|null; anomalies: number };
export function lireClaude(texte: string): LectureClaude;
export type LectureCodex = { sessionId: string; originator: string|null; cwd: string|null; debut: Date|null; cumuls: { at: Date; modele: string; jetons: Jetons }[]; jauges: JaugeReleve[]; anomalies: number };
export function lireCodex(texte: string): LectureCodex;
export function cumulerParHeure(sessionId: string, messages: { at: Date; modele: string; jetons: Jetons }[]): CumulReleve[];
```

Règles :
- Claude :
  - ne garder que les lignes `type: 'assistant'` qui portent `message.usage` ;
  - dédoublonner par `message.id`, à défaut par `uuid` ;
  - correspondance des champs : `input_tokens` → entrée, `output_tokens` → sortie, `cache_creation_input_tokens` → écriture de cache, `cache_read_input_tokens` → lecture de cache ;
  - titre = dernière ligne `custom-title`.
- Codex :
  - les compteurs sont **cumulés** (`total_token_usage`) : convertir en écarts entre deux événements `token_count` successifs ;
  - correspondance des champs : entrée = `input_tokens − cached_input_tokens`, lecture de cache = `cached_input_tokens`, sortie = `output_tokens` ;
  - jauges : `rate_limits.primary.used_percent` → `utilise5h`, `secondary` → `utiliseHebdo`, `resets_at` (secondes epoch) → `reset*` ;
  - `originator` et `cwd` viennent de la ligne `session_meta`.
- Ligne JSON illisible : sautée, `anomalies++`.

- [ ] **Étape 1 :** tests sur les fixtures (inventées, au format réel) :
  - `'un message répété est compté une fois'` (Review Focus 2) ;
  - `'une session à cheval sur deux heures est répartie'` (Review Focus 1) ;
  - `'une ligne tronquée est sautée et comptée'` (Review Focus 5) ;
  - `'lit le titre de session'` ;
  - `'Codex : convertit les cumuls en écarts et lit les jauges'`.
- [ ] **Étape 2 :** FAIL. **Étape 3 :** implémenter. **Étape 4 :** PASS, commit `feat(conso-ia): lecture des fichiers de session`.

### Tâche 9 : le relevé dans l'exécuteur

**Fichiers :** créer `src/runner/conso/releve.ts`, `src/runner/conso/releve.test.ts` ; modifier `src/runner/runner.ts` (`main` : un tour toutes les 5 min, plus un premier passage au démarrage sur 30 jours)

**Interfaces :**
- Consomme : `lireClaude`, `lireCodex`, `cumulerParHeure` (tâche 8), `POST /api/runner/conso-ia` (tâche 4).
- Produit :
```ts
export type DossiersConso = { claude: string; cowork: string; codex: string }; // par défaut ~/.claude/projects, ~/Library/Application Support/Claude/local-agent-mode-sessions, ~/.codex/sessions
export function classerClaude(chemin: string, dossiers: DossiersConso, entrypoint: string|null): 'code'|'cowork'|'executeur';
export function classerCodex(originator: string|null): 'codex'|'agent'|'executeur';
export async function sujetDe(s: { outil: string; branche: string|null; titre: string|null }, pr: (branche: string) => Promise<number|null>): Promise<string>;
export async function tourConso(opts: RunnerOptions, etat: { depuis: Date }, dossiers?: DossiersConso, pr?: (branche: string) => Promise<number|null>): Promise<void>;
```

Règles :
- **Fichiers relus** : ceux modifiés depuis `etat.depuis − 10 min`, en entier. Le relevé est sans état : l'OS remplace les cumuls. Au premier passage, `depuis` = maintenant − 30 jours.
- **Sous-agents** : un fichier sous `<session>/subagents/` compte pour la session parente.
- **Classement de l'outil** :
  - `sdk-cli` ou un `cwd` sous un dossier temporaire `simatis-*` → `executeur` ;
  - un chemin sous le dossier Cowork → `cowork` ;
  - sinon `code`.
  - Codex : `Codex Desktop` → `codex`, `codex_work_desktop` → `agent`, `codex_exec` → `executeur`.
- **Sujet** :
  - branche autre que `main` → `PR #n` si `pr(branche)` renvoie un numéro, sinon le nom de la branche ;
  - sinon le titre, sinon « question » ;
  - Cowork sans titre → « Cowork ».
  - Le `pr` par défaut appelle `gh pr list --head <branche> --state all --json number --limit 1`, avec un cache mémoire d'1 h, et renvoie `null` en cas d'échec.
- Envoi par lots de 5 000 cumuls au plus. Un échec réseau est journalisé et repris au tour suivant (`etat.depuis` n'avance qu'après un succès).

- [ ] **Étape 1 :** tests avec un dossier temporaire garni des fixtures et un faux `fetch` :
  - `'envoie un cumul par session, heure et modèle'` ;
  - `'un sous-agent compte pour sa session'` ;
  - `'classe Cowork, Code, exécuteur et Codex'` ;
  - `'sujet : PR, branche, titre, question'` ;
  - `'n'avance pas après un échec d'envoi'`.
- [ ] **Étape 2 :** FAIL. **Étape 3 :** implémenter et brancher dans `main`. **Étape 4 :** PASS, commit `feat(conso-ia): relevé des sessions dans l'exécuteur`.

### Tâche 10 : déclaration des lancements de l'OS

**Fichiers :** modifier `src/runner/runner.ts` et `src/runner/runner.test.ts`

**Interfaces :**
- Consomme : `POST /api/runner/lancements` (tâche 4).
- Produit : `export async function declarer(api, l: { moteur: 'claude'|'codex'; sessionId?: string; cwd?: string; sujet: string }): Promise<void>`. Elle n'échoue jamais : une erreur est avalée, pour qu'une panne du journal n'empêche aucune routine de partir.

Pour **chaque** lancement Claude, générer `randomUUID()`, l'ajouter en `--session-id <uuid>` aux arguments, puis `declarer`. Pour chaque lancement Codex, `declarer` avec son `cwd`. Les sites à couvrir, avec le sujet attendu :

| Site (`runner.ts`) | Sujet |
|---|---|
| `tour` (routines, l. ~345-348) | `Routine <libelle> · <nom>` |
| `tourEchanges` (l. ~448) | `Inbox (échange) · <nom de l'instance>` |
| `tourCampagnes` (l. ~547) | `Campagne · <nom de l'instance>` |
| `tourDiagnostic` (l. ~1813) | `Diagnostic · <étape ou type de l'attente> · <nom de l'instance>` |
| `tourCodex` (l. ~1862 et ~1893) | `Recherche et enrichissement` |

Dans `tourCodex`, **retirer `--no-session-persistence`**, pour que la session laisse un fichier lisible par le relevé. Pour le nom d'instance, prendre le champ disponible sur l'objet de demande du site ; s'il n'y en a pas, l'identifiant `instance`.

- [ ] **Étape 1 :** tests (faux `lancer` + faux `fetch` qui note les appels) :
  - `'une routine Claude part avec --session-id et est déclarée'` ;
  - `'une routine Codex est déclarée avec son cwd'` ;
  - `'une panne de la déclaration n'empêche pas la routine'` ;
  - `'tourCodex ne passe plus --no-session-persistence'`.
- [ ] **Étape 2 :** FAIL. **Étape 3 :** implémenter. **Étape 4 :** PASS, `npm run verify`, commit `feat(conso-ia): l'exécuteur déclare ses lancements`.

### Tâche 11 : livraison et essai réel

- [ ] **Étape 1 :** PR vers `main`, revue de code, CI verte, merge.
- [ ] **Étape 2 :** reconstruire l'image depuis `origin/main` (`git archive` → `docker build -t simatis-os-app` → `docker compose up -d --no-build app` → `curl localhost:4300/health`). Vérifier que la migration est appliquée (`\d ia_cumuls`).
- [ ] **Étape 3 :** redémarrer l'exécuteur : `launchctl kickstart -k gui/$(id -u)/fr.simatis.runner`. Attendu dans la console, sous 5 min : les sessions Claude Code des derniers jours avec leur sujet, en jetons.
- [ ] **Étape 4 :** lancer une routine depuis l'OS. Attendu : une ligne `IA-int` avec son sujet.
- [ ] **Étape 5 :** second cerveau : mettre à jour `simatis-os-structure.md`, `simatis-os-feuille-de-route.md` et `log.md`, puis commit et push.
