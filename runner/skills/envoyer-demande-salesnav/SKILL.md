---
name: envoyer-demande-salesnav
description: Routine « Envoi SalesNav » de SIMATIS OS - envoie dans le Chrome du pilote une seule demande de connexion Sales Navigator / LinkedIn, avec la note validée par le pilote, puis rend compte à l'OS. À utiliser quand l'exécuteur lance la routine « Envoi SalesNav » d'une instance.
---

# Routine Envoi SalesNav

À installer sur le poste de l'exécuteur : copier ce dossier dans `~/.claude/skills/`. Il faut Chrome ouvert, l'extension Claude in Chrome connectée et le pilote connecté à LinkedIn / Sales Navigator dans ce Chrome.

Tu envoies **une seule demande de connexion**, celle que le pilote vient de valider dans l'OS, avec **exactement** la note validée. Rien d'autre : tu n'envoies aucun message, tu n'acceptes aucune invitation, tu ne suis personne, tu ne modifies aucune liste, tu ne cliques sur aucune publicité ni aucun lien extérieur. Tu n'enchaînes **jamais** sur un deuxième profil, même s'il en reste dans l'OS : le pilote valide chaque demande une à une.

Signale chaque étape avec `etape_routine`, puis termine avec `rapport_routine` (fait / attente / échec).

## 1. Prendre la demande

1. Appelle `salesnav_envoi_a_faire`. Réponse `envoi: null` : rapport « rien à envoyer », et **n'ouvre pas LinkedIn**.
2. Sinon retiens `id`, `nom` (nom attendu), `lien`, `note` (à utiliser mot pour mot, sans la reformuler, la raccourcir ni l'allonger) et `essaiABlanc`.

## 2. Ouvrir le profil et vérifier la personne

1. `tabs_context_mcp`, puis ouvre un onglet dans le groupe Claude sur le `lien`.
2. Connexion, vérification d'identité, code, captcha ou message demandant d'« activer » quelque chose : **arrête-toi**, ne tente rien, appelle `salesnav_envoi_rapport` avec `echec` et le détail « LinkedIn demande une connexion ou une vérification, à faire par le pilote », puis rapport « attente ».
3. Compare le nom affiché en haut du profil avec `nom` (sans tenir compte des majuscules ni des accents). **Prénom et nom doivent correspondre.** Sinon : n'envoie rien, `salesnav_envoi_rapport` avec `nom_different` et le nom vu à l'écran. Page introuvable ou profil indisponible : `introuvable`.
4. Regarde l'état de la relation :
   - déjà en relation (mention « 1er » ou bouton « Message » à la place de « Se connecter ») : `deja_connecte`, sans rien envoyer ;
   - invitation déjà envoyée (« En attente » ou « Retirer l'invitation ») : `invitation_en_attente`, sans rien envoyer ;
   - sinon, passe à l'étape suivante.

## 3. Envoyer la demande

1. Trouve « Se connecter ». Sur un profil Sales Navigator il peut se trouver dans le menu « … » ou « Plus » : ouvre-le, ne clique sur rien d'autre que « Se connecter ». Si le bouton n'existe pas (profil qui n'accepte pas les invitations, option « Suivre » seule) : `echec` avec ce que tu vois.
2. Dans la fenêtre qui s'ouvre, choisis d'**ajouter une note**, puis saisis la `note` dans la zone de texte prévue (c'est le seul endroit où tu écris du texte). Vérifie à l'écran que le texte saisi est identique à la `note` et que le compteur de caractères n'est pas dépassé. Si la note ne peut pas être ajoutée (option absente, limite atteinte, zone refusée) : **n'envoie pas sans note**, ferme la fenêtre sans envoyer et rapporte `echec` avec la raison.
3. **Essai à blanc (`essaiABlanc` vrai)** : n'appuie **pas** sur « Envoyer ». Ferme la fenêtre avec « Annuler » ou la croix, vérifie que le bouton « Se connecter » est toujours là (rien n'est parti), puis rapporte `envoye` avec le détail « essai à blanc : note saisie et vérifiée, rien envoyé ». L'OS sait qu'il s'agit d'un essai et ne touche à rien.
4. **Envoi réel (`essaiABlanc` faux)** : clique **une seule fois** sur « Envoyer l'invitation » (ou « Envoyer »). Ne double-clique pas, ne réessaie pas. Puis vérifie à l'écran : un message de confirmation, ou le bouton qui devient « En attente ». Confirmation visible : `envoye`. Rien de visible après quelques secondes : **ne recommence pas**, rapporte `echec` avec « envoi non confirmé, à vérifier par le pilote ».

## 4. Avertissement de LinkedIn

À n'importe quelle étape, si LinkedIn affiche un avertissement ou une limite (limite d'invitations atteinte, « trop d'invitations », activité inhabituelle, compte restreint, demande de vérification après l'envoi) : **arrête tout immédiatement**, n'essaie ni de contourner ni de réessayer, ferme la fenêtre si elle est ouverte, et appelle `salesnav_envoi_rapport` avec `avertissement` et le texte affiché. L'OS met alors le canal en pause pour sept jours : c'est voulu, ne fais rien de plus.

## 5. Rendre compte et finir

1. `salesnav_envoi_rapport` avec l'`id`, le `resultat` (`envoye`, `deja_connecte`, `invitation_en_attente`, `nom_different`, `introuvable`, `avertissement` ou `echec`) et un `detail` court de ce qui est affiché à l'écran. Un seul rapport par demande, jamais deux.
2. Le rapport de routine dit seulement le résultat : n'y recopie ni la note ni le contenu du profil.
3. Ferme l'onglet que tu as ouvert. Ne touche pas aux autres onglets du pilote.
