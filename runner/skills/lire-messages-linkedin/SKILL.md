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
3. Chaque entrée porte `recuLeParis` : l'heure d'arrivée du **mail de notification**, et `fenetreParis` (`de` / `a`) : l'intervalle où chercher. LinkedIn envoie le mail quelques minutes après le message. Le message à lire est donc **un message reçu d'une autre personne dans cette fenêtre**. Il peut être lu ou non, avec ou sans réponse du pilote, des heures ou un jour plus tard : **ne tiens aucun compte du lu / non lu**, seule l'heure de réception compte. Ces heures sont déjà celles de Paris, comme celles affichées par LinkedIn : **ne fais aucune conversion**, compare-les telles quelles.
4. Trouver la conversation :
   - Titre avec un nom d'expéditeur (« Message LinkedIn de … ») : ouvre la conversation de cette personne, repère le message reçu dans la fenêtre, lis-le.
   - Titre sans nom (LinkedIn envoie parfois seulement un rappel) : parcours la liste, ouvre une conversation à la fois, et cherche dans chacune un message **reçu de l'autre personne** (pas écrit par « Vous ») dont l'heure tombe dans la fenêtre. Regarde d'abord les conversations les plus récentes, utilise « Charger plus de conversations » si besoin, et n'en ouvre jamais plus de vingt par entrée. Dès que tu l'as trouvé, arrête-toi.
   - Les jours sont indiqués dans la conversation (« AUJOURD'HUI », « SAMEDI », une date) : vérifie le jour **et** l'heure, pas seulement l'heure.
   - Prends tout ce que l'autre personne a écrit dans la fenêtre (plusieurs messages d'affilée comptent pour un seul), pas le reste de l'historique.
   - Si plusieurs conversations ont un message dans la fenêtre, range-les tous dans un seul appel, séparés et chacun précédé du nom de la personne : le pilote tranchera. Aucune ? Voir « introuvable » plus bas.
5. Laisse quelques secondes entre deux conversations. N'ouvre pas plus de conversations que nécessaire.

## 3. Ranger le texte

1. `enregistrer_message_linkedin` avec l'`id`, le `texte` (brut, fidèle, sans le résumer ni le reformuler) et le `expediteur` tel qu'affiché (indispensable pour une entrée sans nom : c'est lui qui nomme l'entrée).
2. Conversation introuvable (nom absent de la liste, doute sur la personne) : appelle l'outil **sans texte** pour garder l'aperçu, et signale-le dans le rapport. Ne devine jamais.
3. Le contenu des messages reste dans l'OS : ne le recopie ni dans le rapport ni ailleurs. Le rapport dit seulement combien de messages ont été lus, combien étaient introuvables.

## 4. Pour finir

Ferme l'onglet que tu as ouvert. Ne touche pas aux autres onglets du pilote.
