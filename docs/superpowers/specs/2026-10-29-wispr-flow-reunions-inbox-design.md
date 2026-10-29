# Réunions Wispr Flow dans l'Inbox — conception

Date : 2026-10-29. Statut : à relire par Marc avant le plan d'implémentation.

## But

Les notes de réunion de Wispr Flow (Notetaker) arrivent dans l'Inbox de l'OS. Marc choisit à quoi les rattacher et si la réunion est critique. L'OS ne redemande plus un compte rendu qui existe déjà.

Hors périmètre : la dictée. Le bouton « Insérer depuis Wispr Flow » n'est plus nécessaire : la dictée ne passait pas dans le chat du Diagnostic parce que le champ était verrouillé pendant la réponse de Claude (corrigé, PR #167).

## Ce qu'offre Wispr Flow

Serveur MCP distant en lecture seule : `https://api.wisprflow.ai/connect/mcp`. Il expose les résumés, notes, transcripts, participants, tâches et événements d'agenda des réunions, pas les dictées. L'authentification est un OAuth standard (`openid offline_access`, serveur d'autorisation `mcp-auth.wisprflow.com`), sans clé d'API. Aucun jeton n'entre dans le dépôt.

## Contraintes

- L'exécuteur du poste lance Claude Code avec `--strict-mcp-config` ([runner.ts](../../../src/runner/runner.ts)) : il ne voit que les outils `simatis`. Wispr Flow doit y être ajouté explicitement, avec ses outils en lecture seule seulement.
- Les routines n'envoient rien par elles-mêmes : tout passe par des entrées d'Inbox ou des propositions à valider.
- Le dépôt est public : tests et exemples avec des données fictives uniquement.

## Conception

### 1. Lecture des réunions

La routine Inbox (skill `alimenter-inbox`) lit les réunions Wispr Flow récentes depuis son dernier passage, via le serveur MCP Wispr Flow ajouté à la configuration de l'exécuteur.

### 2. Entrée « Réunion à attribuer »

Pour chaque réunion non encore vue, elle dépose une entrée d'Inbox de type `compte_rendu`, origine `wispr`, clé stable = identifiant de la réunion Wispr Flow (une entrée par réunion, pour toujours, comme les autres dépôts). Elle porte : titre, date, participants, résumé.

Sur cette entrée, Marc :
- choisit le rattachement : mandat, contact ou entreprise (l'OS propose le plus probable d'après les participants) ;
- choisit **critique** ou **résumé seulement** (défaut : résumé seulement).

### 3. Critique ou non

- **Résumé seulement** : l'OS ne conserve que le résumé.
- **Critique** : l'OS conserve aussi le transcript complet, rattaché à la fiche choisie. Le transcript n'est lu qu'au moment où Marc coche « critique », pas avant.

La décision revient à Marc. Une règle automatique (mandat en Closing, Diagnostic…) pourra s'ajouter plus tard.

### 4. Pas de doublon

Avant de déposer, la routine cherche une entrée `compte_rendu` en attente qui correspond à la réunion (même personne, même jour). Si elle existe, elle ne crée pas d'entrée : elle relie la note Wispr Flow à l'entrée existante et propose à Marc de la clore. Cas d'usage : « CR du RDV d'hier avec Emmanuel ».

### 5. Connexion

Paramètres > Connexions affiche l'état de Wispr Flow et la marche à suivre : connexion unique dans le navigateur avec le compte Wispr Flow de Marc. Les jetons restent dans le magasin de Claude Code du poste, jamais dans la base ni dans git.

## À vérifier en premier

Le jeton de rafraîchissement est-il bien repris par `claude -p` avec `--strict-mcp-config`, sans écran ? Test avec Marc : connexion unique, puis un appel `claude -p` en lecture seule. Si cela échoue, repli : appeler Wispr Flow depuis l'OS, comme pour Google, avec son propre OAuth.

## Données

Pas de nouvelle table prévue au départ : l'entrée d'Inbox porte résumé et rattachement. Le transcript d'une réunion critique a besoin d'un stockage rattaché à la fiche (colonne ou table dédiée) : à trancher dans le plan, avec la migration.

## Tests

- Dépôt d'une entrée par réunion, sans doublon à la relance.
- Détection du CR existant et proposition de clôture.
- Résumé seulement : aucun transcript stocké. Critique : transcript stocké sur la bonne fiche.
- Faux serveur MCP Wispr Flow dans les tests, données fictives.
- Isolation par instance, comme le reste de l'Inbox.
