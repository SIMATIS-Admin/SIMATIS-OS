# Inbox : le lien entre le second cerveau et l'OS

Date : 2026-10-11. Statut : conception validée par Marc, à relire avant le plan.

## Objectif

L'écran « À valider » disparaît et devient l'**Inbox** : une liste unique, par mandat, des
sujets importants à traiter (mails qui attendent une réponse, devis à produire, rapports de
diagnostic, comptes rendus de rendez-vous, brouillons non envoyés, propositions des
routines). Pour chaque sujet, le pilote le transforme en tâche, ou non, et le coche pour
qu'il disparaisse du suivi.

L'Inbox est alimentée par une **routine Claude** qui tourne sur le poste : elle lit le second
cerveau, la messagerie et l'agenda, dépose les sujets dans l'OS et, au passage suivant,
reporte dans le second cerveau ce qui a été traité.

Critères de réussite :

- un seul écran à regarder le matin : l'Inbox de SIMATIS regroupe tout ;
- aucun sujet en double, même après qu'il a été coché ;
- rien d'irréversible : cocher ne supprime rien, nulle part ;
- l'OS (dépôt public) ne contient ni la méthode de repérage ni aucune donnée réelle.

## Décisions prises

| Question | Décision |
| --- | --- |
| Qui alimente l'Inbox ? | Une routine Claude sur le poste (pas de montage du Drive dans Docker). |
| Retour vers le second cerveau ? | Oui : la routine y note ce qui a été traité et y exporte les notes validées. |
| Et « À valider » ? | Supprimé. Les propositions deviennent des sujets « à valider » de l'Inbox. |
| Périmètre | Mandat : son seul périmètre. « Mon activité » (SIMATIS) : vue d'ensemble, son activité plus tous les mandats actifs, en cours et en Closing. Les démos n'y sont pas. |
| Utilisateurs | Le pilote est pour l'instant le seul utilisateur : pas de droits par personne. |
| Architecture | Approche A : un objet « sujet » nouveau ; le moteur de propositions reste dessous. |

Approches écartées : élargir la table des propositions (mélange « action à exécuter » et
« chose à traiter ») ; laisser les routines agir sans validation (perte du garde-fou).

## 0. Trois sortes de mandats (livraison préalable)

L'Inbox d'ensemble doit inclure les prospects réels qualifiés mais pas les démos. Or le type
d'instance `prospect` désigne aujourd'hui une démonstration (données fictives, faux
connecteurs, routines non planifiées, écritures réelles refusées, devis `DEMO-…`). On
distingue donc :

| | Démo | Mandat en Closing | Mandat en cours |
| --- | --- | --- | --- |
| Ce que c'est | Vitrine pour montrer l'OS | Prospect qualifié, en négociation | Client signé |
| Données et connexions | Fictives | Réelles | Réelles |
| Routines, écritures réelles | Non | Oui | Oui |
| Dans l'Inbox d'ensemble | Non | Oui | Oui |

**Définition d'une Démo** : un mandat qui ne contient que des données fictives et ne touche
aucun outil réel. Il sert à montrer l'OS et peut être partagé en copie isolée.

**Où vit le suivi d'un prospect** : le suivi commercial réel des prospects de SIMATIS
(diagnostic à préparer, rapport de diagnostic à remettre, devis à produire) se fait dans
« Mon activité », avec leurs fiches entreprise et contact, leur affaire et leurs devis. Les
sujets correspondants arrivent donc dans l'Inbox de « Mon activité ». Une démo ne sert qu'à
montrer l'OS au prospect. Un mandat (en Closing, puis en cours) n'est créé que lorsque la
signature approche et que le travail pour le client, avec ses propres outils, commence.

Mise en œuvre, au plus simple :

- Un mandat en Closing est une instance de type `mandat` avec `config.phase = 'closing'`. Il
  se comporte donc exactement comme un mandat en cours partout ailleurs. Sans `phase`, un
  mandat est en cours : les mandats existants ne changent pas.
- Le type `prospect` garde son nom technique (il sert dans une quinzaine d'endroits) mais
  s'affiche « Démo » partout dans l'interface.
- Menu des instances : Mon activité · Mandats en cours · Mandats en Closing · Démos.
- Paramètres d'un mandat : la ligne Type affiche « Mandat en Closing » ou « Mandat en
  cours », et un choix « Phase » permet de passer de l'un à l'autre (inscrit au journal).
  Passer en cours à la signature n'efface rien.
- Création en ligne de commande : `instance:create --type mandat --phase closing`.
- Une démo reste une démo. Si son prospect se qualifie, on crée à côté un mandat en Closing
  propre, sans données fictives.

**Créer un mandat depuis une affaire** : sur la fiche d'une affaire de « Mon activité », un
bouton « Créer le mandat » crée une instance `mandat` en phase Closing, nommée d'après
l'entreprise de l'affaire, avec les connexions à brancher (comme la conversion d'une démo).

- À la création, l'OS **recopie** dans le mandat la fiche de l'entreprise et ses contacts
  (`source = 'simatis'`, `sourceId` = identifiant d'origine, pour la traçabilité). Ensuite les
  deux vivent séparément et peuvent diverger : aucune synchronisation.
- Les devis ne sont pas recopiés : la brique Devis reste propre à SIMATIS.
- Le lien est gardé dans la configuration du mandat (`config.origine` : affaire et entreprise
  d'origine). La fiche de l'affaire affiche « Mandat : <nom> » avec un lien pour l'ouvrir ;
  les Paramètres du mandat affichent l'affaire d'origine.
- Un bouton « Lier à un mandat existant » pose le même lien sans rien recopier, pour les
  mandats déjà créés.
- Une affaire n'est liée qu'à un mandat au plus.

Hors périmètre : adapter les données fictives d'une démo à un prospect particulier (chantier
à part ; les données de démonstration du dépôt restent fictives et génériques).

## 1. Le sujet

Nouvelle table `sujets` (colonnes communes `metierColumns`, cloisonnement par instance
`instanceIsolation`, comme les autres tables métier).

| Champ | Contenu |
| --- | --- |
| `type` | `mail_a_repondre`, `devis`, `diagnostic`, `compte_rendu`, `brouillon_non_envoye`, `a_valider`, `autre` |
| `titre` | court, rédigé par la routine |
| `resume` | quelques lignes, rédigé par la routine (texte brut) |
| `origine` | `messagerie`, `agenda`, `cerveau`, `os` (proposition interne) |
| `lien` | URL pour ouvrir la source (fil Gmail, événement, fiche du second cerveau), facultatif |
| `echeance` | date facultative |
| `contactId`, `entrepriseId` | facultatifs, si la routine les reconnaît dans le CRM |
| `propositionId` | pour un sujet `a_valider`, la proposition liée |
| `statut` | `a_traiter`, `tache`, `traite` |
| `tacheId` | la tâche créée quand le sujet a été transformé |
| `traiteAt`, `traitePar` | quand et par qui il a été traité |
| `reporteAt` | quand la routine a reporté le traitement dans le second cerveau |

**Pas de doublon** : la colonne commune `sourceId` porte une clé stable fournie par la
routine (par exemple l'identifiant du fil de messagerie, ou le chemin d'une fiche suivi
d'un repère). Index unique sur `(instance, source, sourceId)`, comme pour les tâches. Un
dépôt dont la clé existe déjà ne crée rien, quel que soit le statut du sujet existant.

**Cycle de vie** :

- `a_traiter` → `tache` : « Transformer en tâche » crée la tâche avec la règle existante
  (dans HubSpot si le mandat y est connecté, sinon dans l'OS) et garde son `tacheId`.
- `a_traiter` → `traite` : la case à cocher ou « Marquer comme traité ».
- `tache` ou `traite` → `a_traiter` : « Remettre à traiter » (la tâche créée reste).

Cocher ne supprime rien, ni dans l'OS, ni dans la messagerie, ni dans le second cerveau.

**Propositions** : quand une proposition est créée avec le statut `proposee`, un sujet
`a_valider` lié est créé dans la même transaction. Valider ou écarter la proposition fait
passer ce sujet à `traite`. Une proposition appliquée directement (niveau d'autonomie
suffisant) ne crée pas de sujet.

## 2. L'écran Inbox

**Périmètre selon l'instance** :

- Instance `mandat` : uniquement les sujets du mandat.
- Instance `propre` (« Mon activité », SIMATIS) : vue d'ensemble, ses propres sujets plus
  ceux de tous les mandats **actifs** de type `mandat`, en cours comme en Closing. Les démos
  et les instances archivées n'y figurent pas.
- La vue d'ensemble est une lecture : chaque sujet reste rangé dans son instance. Le service
  lit chaque instance dans sa propre transaction cloisonnée (`withInstance`) et assemble le
  résultat ; aucune requête ne contourne le cloisonnement.
- Toute action (cocher, transformer en tâche, valider) s'exécute dans l'instance du sujet :
  une tâche créée depuis la vue d'ensemble pour un sujet d'un mandat va dans le CRM de ce
  mandat. Le contrôle des écritures réelles reste celui de l'instance du sujet.
- Dans la vue d'ensemble, chaque ligne porte une pastille du mandat (nom et couleur de
  l'instance) et un filtre « Mandat » s'ajoute aux filtres de type. Le compteur du menu
  compte tous les sujets à traiter du périmètre.

- Menu : « À valider » devient **Inbox** (même place, groupe Pilotage, icône inbox), avec un
  compteur des sujets à traiter. L'ancienne route `validations` redirige vers `inbox`.
- Disposition de l'écran actuel : liste à gauche, détail à droite.
- Filtres : Tout · Mails · Devis · Diagnostics · Comptes rendus · À valider · Traités.
  « Mails » regroupe `mail_a_repondre` et `brouillon_non_envoye` ; `autre` n'apparaît que
  sous « Tout ». Une note proposée pour le second cerveau est une proposition, donc un sujet
  `a_valider`.
- Ligne : case à cocher, icône du type, titre, contact ou entreprise, échéance (rouge si
  dépassée), date d'arrivée.
- Ordre : échéances dépassées, puis échéances à venir (la plus proche d'abord), puis sans
  échéance (le plus récent d'abord).
- Détail : résumé, bouton « Ouvrir la source » (si `lien`), « Transformer en tâche »
  (fenêtre de création de tâche existante, préremplie avec titre, échéance, contact),
  « Marquer comme traité ». Pour un sujet `a_valider` : le détail actuel de la proposition
  avec Valider / Modifier / Écarter.
- « Traités » : sujets `tache` (avec lien vers la tâche) et `traite`, bouton « Remettre à
  traiter ».

Hors périmètre : reporter à plus tard, tri manuel, ajout manuel d'un sujet.

## 3. La routine « Inbox »

Nouvelle entrée dans `ROUTINES` (`src/routines/params.ts`) : clé `inbox`, skill
`alimenter-inbox`. Par défaut chaque jour ouvré, avant la routine quotidienne de relance, ou à
la demande ; rythme réglable comme les autres. Elle tourne par instance avec le jeton
d'exécution existant : elle ne voit que l'Inbox du mandat.

Étapes affichées :

1. Lire les sujets traités depuis le dernier passage.
2. Reporter le traitement et exporter les notes validées dans le second cerveau.
3. Chercher les nouveaux sujets (messagerie, agenda, second cerveau).
4. Déposer les nouveaux sujets dans l'Inbox.

Nouveaux outils MCP (`src/routines/outils-mcp.ts`) :

- `deposer_sujet` : type, titre, résumé, origine, clé de source, lien, échéance, contact ou
  entreprise. Renvoie `cree` ou `existant`. Ignoré sans erreur si la clé existe déjà.
- `sujets_traites` : sujets passés à `tache` ou `traite` dont `reporteAt` est vide. Pour un
  sujet `a_valider` lié à une note pour le second cerveau validée (proposition
  `appliquee`), il renvoie aussi le contenu de la note, à exporter dans l'inbox du second
  cerveau. Une note écartée est seulement signalée comme traitée.
- `marquer_reporte` : pose `reporteAt` sur les sujets que la routine a reportés (ou dont elle
  a exporté la note). Un même mécanisme sert donc aux traces et aux exports.

La **skill** `alimenter-inbox` (méthode de repérage, emplacement des fichiers dans le second
cerveau) est **privée** : elle vit dans les skills du poste, jamais dans ce dépôt.

Sécurité : la routine n'envoie rien et ne modifie rien dans la messagerie. Dans le second
cerveau, elle ajoute seulement (traces, notes dans l'inbox), sans jamais supprimer. Écrire
dans le second cerveau reste au niveau L2 (l'export ne porte que sur des notes validées).

## 4. Transition, démo, tests

- **Migration** : création de la table `sujets`, puis un sujet `a_valider` pour chaque
  proposition encore `proposee`.
- **Démo** : le mandat de démonstration reçoit des sujets fictifs, un par type
  (`src/demo/fixtures.json`).
- **Tests** (écrits avec le code) :
  - service : dépôt, pas de doublon (y compris après coche), cocher, remettre à traiter,
    transformer en tâche (HubSpot simulé et OS) ;
  - cloisonnement : un mandat ne voit pas les sujets d'un autre ;
  - vue d'ensemble : « Mon activité » voit ses sujets et ceux des mandats actifs, pas ceux
    des démos ni des archivés ; une action sur un sujet de mandat s'applique dans le
    mandat ;
  - outils MCP : déposer, lire les traités, marquer reporté ;
  - propositions : créer crée le sujet, valider ou écarter le passe à `traite` ;
  - migration : reprise des propositions en attente ;
  - écran : filtres, ordre, case à cocher, fenêtre « Transformer en tâche », redirection.
- `npm run verify` au complet et contrôle dans le navigateur avant chaque merge.

## Livraisons

0. Trois sortes de mandats : phase Closing / en cours, libellé « Démo », menu, Paramètres,
   ligne de commande, création d'un mandat depuis une affaire (copie de l'entreprise et des
   contacts) et lien affaire ↔ mandat.
1. Table `sujets`, service, API, écran Inbox à la place de « À valider », lien avec les
   propositions, migration, démo.
2. Outils MCP et routine « Inbox » dans Routines Claude.
3. Skill privée `alimenter-inbox`, écrite avec Marc sur le poste (hors dépôt).
