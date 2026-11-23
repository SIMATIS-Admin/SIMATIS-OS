---
name: lire-messages-linkedin
description: Routine « Messages LinkedIn » de SIMATIS OS - ouvre dans le Chrome du pilote les conversations LinkedIn dont l'OS a reçu la notification, lit le texte du message et le range dans l'entrée de l'Inbox. À utiliser quand l'exécuteur lance la routine « Messages LinkedIn » d'une instance.
---

# Routine Messages LinkedIn

À installer sur le poste de l'exécuteur : copier ce dossier dans `~/.claude/skills/`. Il faut Chrome ouvert, l'extension Claude in Chrome connectée et le pilote connecté à LinkedIn dans ce Chrome.

Tu **lis** : tu ne réponds à rien, tu n'envoies rien, tu ne saisis aucun texte (ni dans la zone de réponse, ni dans la recherche), tu ne cliques ni sur « Répondre », « Envoyer », « Se connecter », « Accepter », ni sur un lien extérieur ou une pièce jointe. Tu n'utilises `computer` que pour **cliquer sur une conversation** de la liste et faire défiler.

Signale chaque étape avec `etape_routine`, puis termine avec `rapport_routine` (fait / attente / échec).

## 1. Ce qu'il y a à lire

1. Appelle `messages_linkedin_a_lire`. Liste vide : rapport « rien à lire », et **n'ouvre pas LinkedIn**.
2. Sinon, retiens pour chaque entrée son `id`, son titre (le nom de l'expéditeur quand il y est) et l'aperçu.

## 2. Lire sur LinkedIn

1. `tabs_context_mcp`, puis ouvre un onglet dans le groupe Claude sur `https://www.linkedin.com/messaging/`.
2. Si LinkedIn demande de se connecter ou une vérification : **arrête-toi**, rapport « attente » (« LinkedIn demande une connexion, à faire par le pilote »). N'essaie rien d'autre.
3. Pour chaque entrée **avec un nom** d'expéditeur, trouve la conversation dans la liste avec ce nom et l'aperçu, ouvre-la, puis lis le texte avec `get_page_text`. Prends les derniers messages **reçus** de cette personne depuis la notification, pas tout l'historique.
3. bis. Pour une entrée **sans nom** (titre « Message LinkedIn » seul : LinkedIn envoie parfois seulement un rappel du type « 1 nouveau message attend votre réponse »), ne cherche pas de nom : le message à lire est celui de la liste qui est **non lu**, c'est-à-dire la conversation en gras ou marquée d'une pastille, dont le dernier message vient de l'autre personne et non du pilote. Ouvre-la et lis-la. S'il y a plusieurs conversations non lues et plusieurs entrées sans nom, lis les conversations non lues les plus récentes, dans l'ordre, sans en ouvrir plus que d'entrées. Si plus aucune conversation n'est non lue (le pilote a pu ouvrir le message entre-temps), prends la conversation la plus récente dont le dernier message vient de l'autre personne et date d'après l'arrivée de la notification. Ne conclus « introuvable » que si aucune ne convient.
4. Laisse quelques secondes entre deux conversations. N'ouvre jamais plus de conversations qu'il n'y a d'entrées à lire.

## 3. Ranger le texte

1. `enregistrer_message_linkedin` avec l'`id`, le `texte` (brut, fidèle, sans le résumer ni le reformuler) et le `expediteur` tel qu'affiché (indispensable pour une entrée sans nom : c'est lui qui nomme l'entrée).
2. Conversation introuvable (nom absent de la liste, doute sur la personne) : appelle l'outil **sans texte** pour garder l'aperçu, et signale-le dans le rapport. Ne devine jamais.
3. Le contenu des messages reste dans l'OS : ne le recopie ni dans le rapport ni ailleurs. Le rapport dit seulement combien de messages ont été lus, combien étaient introuvables.

## 4. Pour finir

Ferme l'onglet que tu as ouvert. Ne touche pas aux autres onglets du pilote.
