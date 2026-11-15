# Journal de consommation IA — design

## Pourquoi

Marc travaille avec deux abonnements IA (Claude et ChatGPT), chacun plafonné par une jauge sur 5 heures (L5) et une jauge hebdomadaire (LH). Ces jauges se vident sans qu'il sache pourquoi. Exemple réel : les 14 et 15 novembre, une routine de l'OS bouclait en tâche de fond (PR #344) et a vidé la jauge 5 h de Claude deux fois par jour, sans aucune trace visible.

Le but : à tout moment, voir dans la console de l'OS **qui consomme quoi**, pour repérer tout de suite une dérive.

## Décisions de Marc

- Lignes dans la **console de l'OS**, **cumulées par sujet et par heure** (pas une ligne par échange).
- Chaque ligne donne :
  - **IA-ext** (fait dans les outils IA : Chat, Cowork, Code, Codex…) ou **IA-int** (routines, recherches et tâches lancées par l'OS) ;
  - le fournisseur (Claude ou ChatGPT) et l'outil (Chat, Cowork, Code, Codex, Agent) ;
  - un sujet court (« PR #345 », « question », « Routine relance quotidienne · Mandat A ») ;
  - ce qui a été consommé sur la jauge 5 h (**L5**) et sur la jauge hebdomadaire (**LH**), au plus précis.
- ChatGPT est couvert autant que possible.
- Approche retenue : **A**, un relevé sur le Mac qui lit les fichiers locaux des outils (voir Approches).

Exemple de rendu :

```
14 h  IA-ext · Claude · Code    · PR #345                     · L5 +6,1 %  · LH +1,2 %
14 h  IA-int · Claude · Code    · Recherche quotidienne       · L5 +9,8 %  · LH +2,0 %
14 h  IA-ext · ChatGPT · Codex  · Question devis              · L5 +3,0 %  · LH +0,4 %
14 h  Claude · non attribué (Chat claude.ai ?)                · L5 +2,0 %  · LH +0,3 %
```

## Objectifs

1. Une ligne par (heure, origine, fournisseur, outil, sujet). Elle se met à jour pendant l'heure en cours et reste figée ensuite.
2. L5 et LH exprimés en points de jauge avec une décimale, estimés à partir des jetons réellement consommés (voir Conversion en %).
3. Une ligne « non attribué » par fournisseur et par heure, pour la part de la jauge que rien d'observé n'explique (en pratique : le Chat claude.ai).
4. Le passé reconstitué au premier lancement : 30 jours, dans la limite de ce que les outils ont gardé sur le disque.
5. Une dérive saute aux yeux : un sujet qui consomme 10 points de L5 ou plus dans l'heure s'affiche en niveau « À VOIR » *(choix de Claude, seuil réglable dans le code)*.

## Non-objectifs

- Pas de suivi du **chat ChatGPT classique** : il ne laisse rien sur le Mac, et la jauge que l'OS lit est celle de Codex, pas celle du chat.
- Pas de facturation en euros ni de suivi de la clé API OpenAI (enrichissement payé à l'usage, hors abonnement).
- Pas d'écran dédié dans cette livraison : la console suffit.
- Pas de blocage automatique des routines quand la jauge baisse (cela existe déjà pour la recherche quotidienne et reste à part).

## Anti-objectifs (échec même si « ça marche »)

- Des chiffres faux présentés comme sûrs. Une estimation encore mal calibrée doit être marquée comme telle (« ≈ »).
- Un relevé qui tombe en panne en silence, par exemple après un changement de format des fichiers. Il doit le dire dans la console.
- Le moindre contenu de conversation dans la base ou dans le dépôt. On ne garde que des compteurs, des heures, des identifiants, des titres et des noms de branche. Le dépôt est public : tests et exemples uniquement avec des données fictives.
- Un relevé qui consomme lui-même du quota : il ne fait aucun appel à un modèle.

## Constat technique (15 novembre 2026)

| Source | Où | Ce qu'on y trouve |
|---|---|---|
| Claude Code (app de bureau, CLI) | `~/.claude/projects/<dossier>/<session>.jsonl` (+ sous-agents) | par message : horodatage, modèle, `usage` (entrée, sortie, écriture et lecture de cache), `gitBranch`, `cwd`, `entrypoint` (`claude-desktop`, `cli`, `sdk-cli`…), ligne `custom-title` (titre de session) |
| Cowork | `~/Library/Application Support/Claude/local-agent-mode-sessions/**/.claude/projects/**/*.jsonl` | même format que Claude Code. Derniers fichiers datés d'août : à confirmer si Cowork écrit encore ici |
| Codex (app, `codex exec`, mode travail de ChatGPT) | `~/.codex/sessions/AAAA/MM/JJ/rollout-*.jsonl` (+ `session_index.jsonl`) | `originator` (`Codex Desktop`, `codex_exec`, `codex_work_desktop`), `cwd`, jetons cumulés (`total_token_usage`), **jauges après chaque échange** (`rate_limits.primary/secondary.used_percent`, fenêtres de 300 et 10 080 min) |
| Chat claude.ai, chat ChatGPT | — | rien en local |
| Jauges actuelles | `secrets/ia-limites.json`, écrit toutes les 5 min par `scripts/collect-ai-limits.cjs` (launchd `fr.simatis.ai-limits`) et lu par l'app (`src/ia/limites.ts`) | % restant 5 h et hebdo, Claude et ChatGPT. Le fichier est écrasé à chaque relevé : **aucun historique aujourd'hui** |
| Lancements de l'OS | `src/runner/runner.ts` (launchd `fr.simatis.runner`) | `claude -p` et `codex exec` pour les routines, l'Inbox, les campagnes, le diagnostic, la file recherches/enrichissements (`tourCodex`). Certains appels ont `--no-session-persistence` : pas de fichier local |

## Approches

- **A. Relevé des fichiers locaux sur le Mac** *(retenue)* : un relevé périodique lit les fichiers ci-dessus et envoie à l'OS des cumuls de jetons par session et par heure. L'exécuteur déclare ses propres lancements pour qu'ils soient classés IA-int. Avantages : un seul mécanisme pour tout, il voit même ce qui tourne hors de l'OS, et il reconstitue le passé. Limites : jusqu'à 5 min de décalage, et des formats de fichiers non garantis par les éditeurs (à surveiller, voir Anti-objectifs).
- **B. Crochets dans chaque outil** (hooks Claude Code, `notify` de Codex, comptes rendus de l'exécuteur) : temps réel, mais un branchement par outil, rien pour Cowork, aucun historique, et une modification des réglages globaux de Claude Code. Écartée.
- **C. Écart de jauge avant / après** : en % entiers et brouillé quand deux choses tournent en même temps. Écartée, contraire au « au plus précis ».

## Conception

### 1. Le relevé (sur le Mac)

- Il tourne **dans l'exécuteur** (`runner`), comme un tour de plus toutes les 5 minutes. L'exécuteur a déjà le client authentifié vers l'OS (`clientOs`, jeton de runner) *(choix de Claude)*.
- Il lit les fichiers modifiés depuis son dernier passage et retient une position par fichier, pour ne pas tout relire.
- Pour chaque message assistant, il garde **seulement** : session, horodatage, modèle, compteurs de jetons, outil, origine présumée, `cwd`, branche et titre. Dédoublonnage par identifiant de message : un même message apparaît sur plusieurs lignes du fichier.
- Les sous-agents sont comptés dans la session parente.
- Il envoie à l'OS des cumuls par (session, heure de Paris, modèle) : `POST /api/runner/conso-ia`. Un renvoi est idempotent : l'OS remplace le cumul de la même clé.
- Pour Codex, il envoie aussi les relevés de jauge horodatés trouvés dans les fichiers (`used_percent` après chaque échange).
- Premier passage : 30 jours d'historique.
- Quand une ligne ou un fichier ne correspond pas au format attendu, il le compte et le signale à l'OS. Il ne plante pas.

### 2. Classer chaque session

**Outil**, d'après l'emplacement et les métadonnées :
- Claude Code : `entrypoint` `claude-desktop` ou `cli`, sous `~/.claude/projects` ;
- Cowork : sous `local-agent-mode-sessions` ;
- Codex : `originator` `Codex Desktop` ;
- Agent ChatGPT : `codex_work_desktop` ;
- lancements de l'exécuteur : `sdk-cli` ou `codex_exec`.

**Origine** :
- IA-int si la session a été déclarée par l'exécuteur (voir 3) ;
- sinon, une session `sdk-cli` ou `codex_exec` non déclarée est classée « IA-int · non identifiée » ;
- tout le reste est IA-ext.

**Sujet** :
- Code : la branche, transformée en « PR #n » quand une PR existe (lookup `gh`, mis en cache). Sinon le nom de la branche. Sur `main` ou sans branche : le titre de session (`custom-title`).
- Cowork : le titre de session, sinon « Cowork ».
- Codex et Agent : le titre du fil (`session_index.jsonl`), sinon « question ».
- IA-int : le libellé déclaré par l'exécuteur, par exemple « Routine relance quotidienne · Mandat A », « Recherche quotidienne · SIMATIS », « Enrichissement IA », « Rapport de diagnostic », « Inbox (échange) ».

### 3. Les lancements de l'OS (IA-int)

- Avant chaque `claude -p`, l'exécuteur génère un identifiant, le passe en `--session-id` et le déclare à l'OS : identifiant, moteur, sujet, instance.
- Pour `codex exec`, même principe. Le lien se fait par l'identifiant de fil (sortie `--json`) ou par le `cwd` propre au lancement *(au choix du constructeur)*.
- Les appels faits aujourd'hui avec `--no-session-persistence` (file `tourCodex`) ne laissent pas de fichier. Deux possibilités *(au choix du constructeur)* :
  - retirer l'option ;
  - faire remonter directement par l'exécuteur les jetons lus dans la sortie `--output-format json` (`usage`).

  Dans les deux cas, aucun lancement de l'OS ne doit échapper au journal.
- Le relevé des jauges (`/usage`, toutes les 5 min) ne compte pas : c'est une commande locale, sans appel à un modèle. À vérifier pendant la construction.

### 4. Historique des jauges (dans l'OS)

- À chaque nouveau `actualiseLe` de `secrets/ia-limites.json`, l'OS enregistre une ligne : fournisseur, horodatage, % utilisé L5 et LH, et heures de renouvellement des deux jauges.
- Pour Codex, s'y ajoutent les relevés plus fins venus des fichiers.
- Conservation : 90 jours.

### 5. Conversion en %

1. **Coût équivalent** de chaque cumul : jetons × prix public de l'API du modèle. Les catégories comptent séparément : entrée, sortie, écriture de cache, lecture de cache. Une table de prix versionnée dans le code ; un modèle inconnu prend le prix de sa famille et est signalé.
2. **Coefficient** (points de jauge par unité de coût), par fournisseur et par jauge (L5, LH). Il s'estime en comparant, sur les 14 derniers jours, les hausses de jauge observées entre deux relevés au coût des sessions observées sur la même période.
3. La part non observée (le Chat) gonfle mécaniquement certains intervalles. Le coefficient ne doit donc pas être tiré vers le haut par ces intervalles : par exemple, prendre un quantile bas des rapports intervalle par intervalle plutôt que la moyenne. Méthode exacte laissée au constructeur, documentée dans le code et testée sur des séries fictives.
4. Pour Codex, les relevés de jauge après chaque échange donnent une mesure directe : on les utilise en priorité.
5. Tant que l'historique est trop mince, les valeurs s'affichent avec « ≈ ». Seuil : moins de 20 points de hausse cumulée de la jauge observés pour un fournisseur et une jauge *(choix de Claude)*.
6. **Avant tout calibrage**, il n'y a aucun coefficient. Il n'existe aucun historique de jauge Claude avant la livraison : le fichier des jauges est écrasé à chaque relevé. Pendant ce temps, la ligne affiche la quantité consommée en jetons pondérés (« 1,2 M jetons ») au lieu de L5 et LH. Dès qu'un premier coefficient existe, les % apparaissent avec « ≈ » *(choix de Claude)*.
7. **Les % sont calculés à la lecture**, avec le coefficient du moment, à partir des coûts stockés *(choix de Claude)*. Conséquences : les heures passées, y compris les 30 jours reconstitués, gagnent leurs % dès que le calibrage existe, et s'affinent avec lui. « Figée » ne concerne que les jetons d'une heure terminée.
8. Un renouvellement de jauge (retour vers 0 %) coupe l'intervalle : jamais de hausse négative.

### 6. Non attribué

- Par fournisseur et par heure : hausse observée de la jauge, moins la somme des estimations attribuées.
- Affiché seulement si la différence atteint 1 point, ce qui correspond à la résolution des jauges.
- Libellé : « Claude · non attribué (Chat claude.ai ?) ».
- Rien pour ChatGPT tant que seule la jauge Codex est lue.
- Seulement pour les heures où des relevés de jauge existent, donc à partir de la livraison pour Claude.

### 7. Base et console

- Données de compte, pas d'instance : tables globales sans `instance_id`, lues par la console de toutes les instances **réelles**. Elles ne sont jamais lues dans les instances de type Démo, qui peuvent être montrées à des prospects : les sujets contiennent des noms de mandats et des titres de conversation *(choix de Claude)*.
- Tables : cumuls par session et par heure (avec modèle et coût), sessions (outil, origine, sujet), relevés de jauge, et état du relevé (dernier passage, anomalies). Noms laissés au constructeur.
- `lireConsole` (`src/console/service.ts`) ajoute une source `conso` : une ligne par (heure, origine, fournisseur, outil, sujet), avec un identifiant stable pour qu'elle se mette à jour pendant l'heure.
- Format du texte : `IA-ext · Claude · Code · PR #345 · L5 +6,1 % · LH +1,2 %`.
- Niveau « À VOIR » à partir de 10 points de L5 dans l'heure.
- Relevé muet depuis plus de 15 min, ou anomalies de format : une ligne « À VOIR » qui le dit.
- La console garde sa fenêtre de 24 h. Les lignes de consommation ont leur propre plafond, pour ne pas chasser les lignes des routines du plafond actuel de 300 lignes (`MAX_LIGNES`) *(choix de Claude)*.

### 8. Ce qui reste au constructeur

- La forme exacte des tables, des routes et du découpage en livraisons.
- La méthode de calibrage, dans le cadre du point 5.
- Le lien entre lancements `codex exec` et fichiers.
- Le traitement de `--no-session-persistence`.
- Le rendu visuel de la ligne dans `Console.tsx` (badge, icône), tant qu'elle reste lisible en une ligne.

## Vérification attendue

- Tests unitaires de lecture sur des fichiers fictifs aux trois formats (Claude Code, Cowork, Codex) : dédoublonnage, sous-agents, découpage horaire à l'heure de Paris, lignes illisibles.
- Tests de classement : outil, origine, sujet.
- Tests de calibrage sur une série fictive avec une part « Chat » non observée : le coefficient ne doit pas être gonflé, et le « non attribué » doit apparaître.
- Essai réel :
  - après déploiement, les sessions Claude Code reconstituées apparaissent avec leur sujet, en jetons d'abord, puis en % une fois le calibrage établi ;
  - un lancement de l'OS fait après la livraison apparaît en IA-int avec son sujet ;
  - une consommation faite dans le Chat claude.ai après la livraison apparaît en « non attribué ».

## Limites connues

- Le passé des lancements faits avec `--no-session-persistence` (dont la boucle du 15 novembre) n'est pas reconstituable : ils n'ont laissé aucun fichier.
- Pas de « non attribué » Claude avant la livraison : aucun relevé de jauge n'a été conservé.
- Claude Code efface ses fichiers de session au bout de 30 jours par défaut (`cleanupPeriodDays`).
- Les formats de fichiers peuvent changer à une mise à jour de Claude ou de Codex.
