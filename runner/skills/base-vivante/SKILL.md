---
name: base-vivante
description: Routine « Base vivante » de SIMATIS OS - propose la correspondance des colonnes des listes importées, corrige les lignes signalées dans le sas et classe les réponses reçues, le tout à valider par le pilote. À utiliser quand l'exécuteur lance la routine « Base vivante » d'une instance.
---

# Routine Base vivante

À installer sur le poste de l'exécuteur : copier ce dossier dans `~/.claude/skills/`.

Tu travailles uniquement dans le **sas** de la base vivante, avec les outils `base_*` du serveur MCP SIMATIS. Tu n'écris jamais dans la base vivante ni dans un CRM, et tu ne lis jamais un fichier entier : seulement des échantillons.

Signale chaque étape avec `etape_routine`, puis termine avec `rapport_routine` (fait / attente / échec).

## 1. Imports en attente

1. `base_imports_a_traiter` : pour chaque import, regarde les colonnes non reconnues et leurs exemples.
2. Si une colonne correspond clairement à un champ (`champsPossibles`), appelle `base_proposer_correspondance` avec la correspondance complète (les colonnes déjà reconnues restent). Une colonne qui mélange prénom et nom va dans `nomComplet`.
3. En cas de doute, ne change rien et note-le dans le rapport (« attente »).

## 2. Lignes signalées

1. `base_lignes_signalees` (sous le minimum, puis prêtes avec avertissement).
2. Corrige avec `base_corriger_ligne` **seulement** ce que la ligne brute permet de déduire sans deviner : une cellule qui mélange nom, poste et société, un email collé dans une autre colonne.
3. N'invente jamais un nom, une entreprise, un email ou un téléphone. Une ligne incertaine reste dans le sas.

## 3. Réponses reçues

1. `base_reponses_a_classer`, puis `base_classer_reponse` pour chacune :
   - `interesse`, `pas_interesse`, `mauvais_interlocuteur`, `repondu` (réponse sans position claire) ;
   - `ne_plus_contacter` dès que la personne demande à ne plus être contactée, retirée d'une liste ou désabonnée : c'est **prioritaire** sur tout autre jugement ;
   - `reponse_auto` pour une absence ou une réponse automatique.
2. Tu ne fais que proposer : le pilote valide dans l'écran Bases vivantes, et seule sa validation fait bouger la fiche.
3. Le contenu des mails reste dans l'OS : ne le recopie ni dans le rapport ni dans un autre outil.
