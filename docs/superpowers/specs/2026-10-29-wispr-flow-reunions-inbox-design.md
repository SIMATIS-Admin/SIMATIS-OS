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

Garde-fous : jamais pour une instance de démo, et l'OS refuse (« ignore ») de déposer dans un mandat une réunion dont aucun participant n'est un contact ou une entreprise de ce mandat. Wispr Flow est le même pour tous les mandats ; sans ce filtre, chaque mandat verrait les réunions des autres. Mon activité reçoit toutes les réunions.

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

Rien à connecter dans l'OS : Wispr Flow est lu par le connecteur claude.ai du compte de Marc, que le CLI du poste utilise déjà. Aucun jeton dans la base ni dans git. Si le connecteur est déconnecté, la routine le signale dans son rapport et ne dépose rien.

## Faisabilité vérifiée (2026-10-29)

Wispr Flow est déjà connecté au compte claude.ai de Marc : le CLI du poste le liste (`claude mcp list`, « claude.ai Wispr Flow », connecté). Test en `claude -p`, lecture seule (`get_account_info`) :

- avec `--strict-mcp-config` : l'outil est introuvable, le mode strict masque les connecteurs claude.ai ;
- sans `--strict-mcp-config`, avec `--allowedTools 'mcp__claude_ai_Wispr_Flow__*'` : réponse OK, sans écran.

Conséquence : pas d'OAuth à écrire dans l'OS. L'exécuteur doit retirer `--strict-mcp-config` pour la routine Inbox, et compenser : `--allowedTools` limité à `mcp__simatis__*` et aux seuls outils de lecture de Wispr Flow (en `-p`, tout outil non autorisé est refusé, donc Gmail, HubSpot et Drive restent inutilisables). À couvrir par un test sur les arguments construits par `argumentsClaude`.

## Données

Une table `reunions_wispr` (une ligne par réunion, liée à son entrée d'Inbox) porte résumé, participants, case « critique » et transcript. Le transcript est récupéré au passage suivant de la routine, une fois la réunion cochée « critique », et supprimé si Marc la décoche. Le rattachement se fait à un contact ou à une entreprise de l'instance de l'Inbox, pas à un autre mandat.

## Tests

- Dépôt d'une entrée par réunion, sans doublon à la relance.
- Détection du CR existant et proposition de clôture.
- Résumé seulement : aucun transcript stocké. Critique : transcript stocké sur la bonne fiche.
- Faux serveur MCP Wispr Flow dans les tests, données fictives.
- Isolation par instance, comme le reste de l'Inbox.
