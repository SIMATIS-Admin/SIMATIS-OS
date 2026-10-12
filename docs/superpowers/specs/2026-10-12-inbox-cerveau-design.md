# Inbox, livraison 3 : ce que l'OS donne à la routine « Inbox »

Date : 2026-10-12. Statut : conception validée par Marc dans la conversation, à relire.

Suite de `2026-10-11-inbox-design.md`. La livraison 3 prévoyait seulement d'écrire la skill
privée `alimenter-inbox`. En la préparant, un obstacle est apparu : l'exécuteur lance Claude
avec **uniquement** les outils MCP de l'OS (`--strict-mcp-config`, `--allowedTools
mcp__simatis__*`). Une skill lancée ainsi ne peut lire ni la messagerie, ni l'agenda, ni le
second cerveau, ni y écrire. Marc a choisi que tout passe par l'OS.

Ce document ne décrit que la partie **publique et générique**. La méthode de repérage, les
règles d'écriture et l'emplacement du second cerveau vivent dans la skill privée, hors dépôt.

## Objectif

Donner à la routine « Inbox » de quoi :

- lire, en lecture seule, les mails restés sans réponse, les brouillons oubliés et les
  rendez-vous passés de l'instance ;
- lire le second cerveau et y ajouter ses traces, sur le seul poste qui l'héberge, sans
  qu'aucune autre routine ni aucune démo n'y ait accès.

Critères de réussite :

- la routine n'obtient l'accès aux fichiers que pour l'Inbox, jamais pour une démo ;
- le chemin du second cerveau n'est jamais dans le dépôt ;
- sans second cerveau configuré, la routine tourne quand même et le dit dans son rapport ;
- aucun outil ajouté n'écrit dans Gmail ou l'agenda.

## Décisions prises

| Question | Décision |
| --- | --- |
| Accès aux outils du pilote | Par l'OS : nouveaux outils MCP de lecture, sur la connexion Google déjà branchée de l'instance. |
| Mails à répondre | Reçus d'un contact du CRM de l'instance (adresse) ou du domaine d'une de ses entreprises, sans réponse depuis plus d'un jour ouvré. |
| Comptes rendus | Rendez-vous terminés avec au moins un participant extérieur au domaine du pilote. |
| Devis, diagnostics | Lus dans le second cerveau par la skill (méthode privée). |
| Trace dans le second cerveau | Écrite par la skill (méthode privée), en ajout seulement. |
| Emplacement de la skill | Privé, sur le poste ; l'exécuteur la trouve dans `~/.claude/skills/` (dossier ou lien). |

## 1. Outils de lecture (MCP, portée instance)

Trois outils, dans `src/inbox/outils-mcp.ts`. Ils n'acceptent pas d'`executionId` : une
connexion absente renvoie une erreur lisible à Claude **sans arrêter la routine** (elle peut
encore reporter et lire le second cerveau). Pour une connexion fictive (démo), ils renvoient
une liste vide.

**`mails_sans_reponse`** (`jours` : 1 à 60, défaut 14 ; messagerie de l'instance)

- Fils de la boîte de réception plus récents que `jours` (Gmail, 100 au plus).
- Un fil est retenu si son **dernier** message n'est pas du pilote (adresse du compte Gmail),
  date de plus d'un jour ouvré (heure de Paris), et si son expéditeur est l'adresse d'un
  contact de l'instance ou appartient au domaine d'une entreprise de l'instance (champ
  `domaine`).
- Rend : `threadId`, `objet`, `de`, `date`, `extrait`, `lien` (ouverture du fil dans Gmail),
  `contactId`, `entrepriseId`.

**`brouillons_en_attente`** (`jours` : 1 à 30, défaut 3 ; messagerie)

- Brouillons Gmail (50 au plus) dont la date est plus ancienne que `jours`.
- Rend : `draftId`, `objet`, `a`, `date`, `lien`.

**`rendez_vous_passes`** (`depuis` : date ISO, défaut il y a 3 jours, 31 jours au plus ; agenda)

- Événements de l'agenda de l'instance (calendriers réglés dans la connexion), terminés entre
  `depuis` et maintenant, hors journées entières, avec au moins un participant dont le domaine
  diffère de celui du compte de l'agenda.
- Rend : `eventId`, `titre`, `debut`, `fin`, `participants` (extérieurs), `lien` (`htmlLink`
  de Google), `contactId`, `entrepriseId`.

Scopes Google déjà accordés (`gmail.readonly`, `calendar.readonly`) : aucune nouvelle
autorisation.

## 2. Accès au second cerveau par l'exécuteur

- Une routine peut déclarer `cerveau: true` dans `ROUTINES` (seule `inbox` le fait).
- `GET /api/runner/demandes` ajoute `cerveau: boolean` : vrai si la routine le déclare **et**
  que l'instance n'est pas une démo (`prospect`).
- L'exécuteur lit `SECOND_CERVEAU_DIR` (variable locale du poste, chemin absolu, nouvelle
  entrée sans valeur dans `.env.example`). Pour une demande `cerveau` et un dossier existant :
  - Claude est lancé avec ce dossier comme répertoire courant et `--add-dir` ;
  - outils permis en plus de `mcp__simatis__*` : `Read`, `Edit` et `Write` limités à ce
    dossier (règles de permission en chemin absolu), `Glob`, `Grep` ;
  - le message de lancement indique le dossier et rappelle : ajouter seulement, ne jamais
    supprimer, ne rien envoyer.
- Sans variable, avec un dossier introuvable, ou pour une demande sans `cerveau` : lancement
  inchangé (outils de l'OS seulement). Pour une demande `cerveau`, le message de lancement dit
  alors que le second cerveau n'est pas accessible sur ce poste et qu'il faut le signaler dans
  le rapport.

## 3. Santé de la routine

L'étape « Chercher les nouveaux sujets (messagerie, agenda, second cerveau) » déclare le
besoin `messagerie` : le feu de la routine Inbox signale une messagerie non branchée, comme
pour les autres routines. Le second cerveau n'est pas contrôlé par l'OS (il est sur le poste).

## 4. Hors dépôt (livraison 3, sur le poste avec Marc)

- Écrire la skill `alimenter-inbox` (méthode de repérage, clés stables, règles d'écriture dans
  le second cerveau) dans les skills privées, et la rendre visible dans `~/.claude/skills/`.
- Régler `SECOND_CERVEAU_DIR` pour l'exécuteur du poste.
- Premier passage accompagné, d'abord sans écriture, puis avec.

## Tests

- Outils : fil retenu ou écarté (dernier message du pilote, trop récent, expéditeur inconnu,
  domaine d'entreprise) ; brouillons trop récents écartés ; rendez-vous internes, en journée
  entière ou à venir écartés ; connexion fictive → liste vide ; connexion absente → erreur
  sans arrêt de l'exécution (Google simulé, comme `google.test.ts`).
- Exécuteur : arguments de lancement avec et sans `cerveau`, sans variable, dossier
  introuvable ; jamais d'accès aux fichiers pour une démo (`demandes` → `cerveau: false`).
- Santé : la routine Inbox signale une messagerie absente.
- `npm run verify` au complet.
