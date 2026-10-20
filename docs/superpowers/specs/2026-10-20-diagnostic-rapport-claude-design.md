# Diagnostic, livraison 2 : rapport rédigé par Claude depuis l'OS

Date : 2026-10-20. Statut : conception validée dans la conversation (approche « demande au runner »,
lien vers le rapport une fois rédigé), spec à relire.

Deuxième livraison du processus du Diagnostic d'Endurance Commerciale dans l'OS. Elle suit la
livraison 1 (support d'ouverture) et reprend le même mécanisme : demande au runner, outil MCP
d'enregistrement, statut et lien sur le projet. Ce document ne décrit que la partie **publique et
générique**. Le contenu du rapport, sa trame et ses règles de rédaction vivent dans la skill privée
`diagnostic-endurance-commerciale-rapport`, hors dépôt.

## Objectif

À l'étape 4 d'un projet (« Rapport »), le pilote clique sur « Produire le rapport » une fois la
revue validée. Claude rédige le rapport du projet, le publie, et l'OS affiche un lien pour l'ouvrir,
comme le lien du deck d'ouverture à l'étape 1.

Critères de réussite :

- le bouton est désactivé tant que les étapes 1 à 3 ne sont pas validées ;
- une seule demande de rapport à la fois par projet ;
- le lien s'affiche dans le projet dès que le rapport est rédigé, et reste ouvrable depuis l'OS ;
- un nouveau rapport remplace le lien affiché, sans effacer l'historique des rapports précédents ;
- aucune donnée réelle (nom d'entreprise, contenu du rapport, lien vers un document client) dans le dépôt.

## Décisions prises

| Question | Décision |
| --- | --- |
| Qui rédige | Claude, lancé par le runner de ce poste, comme pour le support. |
| Où vit le rapport | Publié par Claude (artifact claude.ai). L'OS garde le lien, comme pour le deck. |
| Pré-requis du bouton | Étapes 1 à 3 validées (voir « Pré-requis » ci-dessous). |
| Lien affiché | Lien vers l'artifact, ouvert dans un nouvel onglet, même style que « Ouvrir le deck ». |
| Rapport déjà téléversé (import) | Conservé : le téléchargement du .docx importé reste disponible. |

## Pré-requis : étapes 1 à 3 validées

- Étape 1 : le projet a dépassé l'étape 1 (`etapeMax ≥ 2`).
- Étape 2 : le résultat de l'outil externe est saisi (`resultat` présent) — à vérifier dans le code
  avant implémentation, le champ exact reste à confirmer.
- Étape 3 : la revue est validée. **Choix à confirmer :** la revue porte aujourd'hui un champ
  `revue.statut` (affiché « brouillon » par défaut). On ajoute l'action « Valider la revue » à
  l'étape 3, qui pose `revue.statut = 'validée'`. Une revue modifiée après validation repasse en
  « brouillon ».

Le bouton ne se fie qu'à ces contrôles côté serveur : l'interface ne fait qu'afficher l'état.

## Changements techniques

**Schéma** (`src/diagnostic/schema.ts`, migration Drizzle) :
- `rapportLienStatut` : `aucun` | `en_cours` | `pret` (défaut `aucun`). Le statut `en_cours`
  signifie qu'une demande est en attente ou traitée par le runner.
- `rapportLien` : lien vers l'artifact du rapport (texte, nullable).
- `rapportLiens` : historique des liens (tableau JSON `{ lien, le }`), pour ne rien perdre quand un
  nouveau rapport remplace le précédent.
- Les champs `rapport` / `rapportNom` (fichier .docx importé) restent tels quels.

**Demandes au runner** (`src/diagnostic/support.ts` et son pendant `rapport.ts`) :
- Nouveau type de demande `rapport` dans `DEMANDES`, avec son message (« Rédige le rapport du
  projet à partir de la revue validée ») et son garde-fou : refus si la demande est déjà en cours,
  ou si les pré-requis ne sont pas réunis (`ChatIndisponible`).
- Même principe que `demanderSupport` : le serveur refuse, le runner traite, Claude répond.

**Outils MCP** (réservés au jeton de la demande, `src/diagnostic/outils-mcp.ts`) :
- `lire_projet_diagnostic` : déjà existant, Claude l'utilise pour lire la revue et le résultat.
- `enregistrer_rapport` (nouveau) : reçoit le lien, valide le format (`LIEN_ARTIFACT`, même regex
  que le deck), pose `rapportLien`, passe `rapportLienStatut` à `pret`, ajoute l'entrée dans
  `rapportLiens`. Refuse tout autre format de lien.
- `repondre_diagnostic` reste l'unique sortie dans le chat.

**Runner** (`src/runner/runner.ts`) :
- Pour une demande `rapport` : outils autorisés en plus de `mcp__simatis__*` : `Artifact`, lecture
  du second cerveau si présent. Pas d'écriture libre ailleurs.
- Si Claude ne produit pas de lien valide, la demande se termine sans changer le lien affiché et
  le statut repasse à `aucun`, avec un message dans le chat.

**Interface** (`web/src/pages/Diagnostic.tsx`, composant `Rapport`) :
- Bouton « Produire le rapport » (classe `btn go`), désactivé si les pré-requis manquent, avec la
  raison affichée (« Validez d'abord la revue à l'étape 3 »).
- Pendant `en_cours` : « Claude rédige le rapport… », bouton désactivé.
- Une fois `pret` : bouton « Ouvrir le rapport » vers `rapportLien`, dans un nouvel onglet.
  Historique des rapports précédents repliable sous le bouton.
- Le téléchargement du .docx importé reste visible s'il existe.
- Étape 3 : bouton « Valider la revue » et indication de son état.

## Erreurs

- Demande refusée (pré-requis, déjà en cours) : message clair dans le panneau, rien n'est modifié.
- Lien invalide renvoyé par Claude : refusé par `enregistrer_rapport`, demande terminée avec message
  dans le chat, le lien précédent reste affiché.
- Runner indisponible : la demande reste `en_cours` jusqu'à traitement ; le pilote peut annuler
  seulement si le runner ne l'a pas prise (même règle que le support, à vérifier dans le code).

## Tests

- Service : refus si pré-requis absents, refus si déjà `en_cours`, une seule demande à la fois.
- Outil `enregistrer_rapport` : lien valide accepté, lien hors `claude.ai` refusé, historique
  conservé lors d'un second rapport.
- Runner : demande `rapport` traitée, lien absent → statut repassé à `aucun`.
- Interface : bouton désactivé sans revue validée, bouton actif une fois les pré-requis réunis,
  lien affiché une fois `pret`.
- `npm run verify` avant chaque commit.

## Hors périmètre

- Capitalisation de la revue dans la bibliothèque (livraison 4, skill de capitalisation).
- Import / export du rapport vers le second cerveau (livraison à venir, à spécifier séparément).
- Modification du texte du rapport depuis l'OS : le rapport se corrige dans claude.ai.

## Questions ouvertes pour la relecture

1. Confirmer que « revue validée » = nouvelle action « Valider la revue » à l'étape 3 (ou une autre
   valeur existante).
2. Confirmer le champ du résultat de l'étape 2 utilisé comme pré-requis.
3. Confirmer que le téléchargement du .docx importé reste visible à côté du nouveau lien.
