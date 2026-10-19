# Diagnostic, livraison 1 : le support d'ouverture préparé depuis l'OS

Date : 2026-10-19. Statut : conception validée par Marc dans la conversation, à relire.

Première des livraisons qui amènent tout le processus du Diagnostic d'Endurance Commerciale
dans l'OS, dans l'ordre du processus : support, import du PDF de l'outil et profil, rapport,
capitalisation. Ce document ne décrit que la partie **publique et générique**. Le contenu du
deck, ses règles de rédaction et l'emplacement des archives vivent dans la skill privée
`diagnostic-endurance-commerciale-support` et dans le second cerveau, hors dépôt.

## Objectif

À l'étape 1 d'un projet (« Préparer la présentation »), le pilote donne quelques informations
et clique : Claude prépare le deck d'ouverture propre à cette entreprise. Le pilote le corrige
sur claude.ai, puis le déclare final. L'OS en garde le lien et le texte, et une archive est
déposée dans le second cerveau.

Critères de réussite :

- un deck par projet : préparer une entreprise n'écrase jamais le deck d'une autre ;
- les corrections faites à la main dans l'éditeur claude.ai ne se perdent pas : l'archive
  relit le deck publié, jamais une copie gardée de mémoire ;
- après « Support final », le texte de chaque diapositive et ses notes d'orateur se lisent
  dans le projet, et la même archive est dans le second cerveau ;
- les archives déjà faites dans le second cerveau sont reliées à leur projet ;
- aucune donnée réelle (nom d'entreprise, contenu du deck, logo) dans le dépôt.

## Décisions prises

| Question | Décision |
| --- | --- |
| Où vit le deck | Sur claude.ai, en artifact Slides, avec son éditeur. L'OS garde le lien. |
| Demandes à Claude | Par le chat de l'étape 1 dans l'OS, répondu par le runner. |
| Corrections à la main | Dans l'éditeur claude.ai, sans repasser par l'OS. |
| Nombre de decks | Un par projet, repris du deck modèle. Le deck modèle n'est plus réécrit. |
| Lancement | Petit formulaire à l'étape 1 (date du diagnostic, ce que le dirigeant a dit, hypothèses à confirmer, logo), puis « Préparer le support ». Claude demande dans le chat ce qui manque. |
| Après « Support final » | Lien + texte lisible (diapositives et notes) dans le projet, même archive dans le second cerveau. |
| Archives existantes | Importées par le fichier d'import privé, comme les rapports. |

## Parcours

1. **Formulaire de l'étape 1.** Champs : date du diagnostic, « Ce que le dirigeant m'a dit »,
   « Mes hypothèses (à confirmer en entretien) », logo de l'entreprise (image déposée). Le
   contexte du projet existant reste en place. Enregistrement manuel, comme le reste du module.
2. **« Préparer le support ».** Le bouton crée une demande pour le runner. Le projet affiche
   « Claude prépare le support… » ; une seule demande à la fois par projet.
3. **Le runner** lance Claude Code avec la skill support. Claude lit le projet et le formulaire
   (outil MCP de lecture), la fiche de l'entreprise dans le second cerveau, recherche le marché,
   crée le deck du projet à partir du deck modèle, l'adapte, le publie, puis enregistre son lien
   dans le projet et répond dans le chat (ce qui a changé, sources, questions restantes).
4. **Corrections.** Par le chat de l'étape 1 : la réponse du runner peut alors modifier le deck
   du projet (et seulement lui). Ou à la main dans l'éditeur claude.ai.
5. **« Support final ».** Nouvelle demande au runner : Claude relit le deck publié, enregistre
   dans le projet le texte de chaque diapositive et ses notes d'orateur, et dépose l'archive
   dans le second cerveau selon la skill. Le projet affiche la date et le texte. Le pilote peut
   rouvrir le support (« Modifier le support ») : un nouveau « Support final » remplace le texte
   archivé dans l'OS et ajoute une nouvelle archive datée.

## Changements techniques

- **Projet** (`diagnostic_projets`) : champs du formulaire (`dateDiagnostic` existe déjà,
  `ditParDirigeant`, `hypotheses`, `logo` + `logoNom` en base64 comme le rapport), et support :
  `supportLien`, `supportStatut` (`aucun`, `preparation`, `pret`, `final`), `supportTexte`
  (diapositives : titre, texte, notes), `supportFinalLe`. Migration Drizzle.
- **Demandes au runner** : même principe que le chat (attente, démarrer, fin), avec un type
  `support_preparer` ou `support_final`. Le runner les traite avant les messages du chat.
- **Outils MCP** (réservés au jeton de la demande) : `lire_projet_diagnostic`,
  `enregistrer_support` (lien, statut, texte). `repondre_diagnostic` reste l'unique sortie
  dans le chat.
- **Runner** : pour ces demandes, outils autorisés en plus de `mcp__simatis__*` : `Artifact`,
  `WebSearch`, `WebFetch`, lecture du second cerveau, et écriture limitée à l'archive (même
  garde-fou que l'Inbox : ajout seulement). Sans second cerveau sur le poste, le deck se
  prépare quand même et l'archive est signalée comme non faite.
- **Détection des skills** : le runner ne regarde aujourd'hui que `~/.claude/skills/<nom>`.
  Les skills synchronisées depuis claude.ai sont rangées sous `~/.claude/skills/synced/<id>/<nom>` :
  il faut les compter aussi, sinon la demande s'arrête pour « skill absente ».
- **Import** : le fichier d'import privé accepte `supportLien` et `supportTexte` par projet.
- **Interface** : formulaire et boutons à l'étape 1, bouton « Ouvrir le deck », lecture du
  texte final diapositive par diapositive.

## Skill privée à mettre à jour (hors dépôt)

La skill support dit aujourd'hui de travailler toujours sur le même deck. Elle doit dire :
un deck par projet, créé à partir du deck modèle ; le lien et le texte rendus à l'OS par ses
outils ; l'archive écrite au moment du « Support final ». Le texte de mise à jour est proposé
à Marc, qui l'enregistre dans son compte claude.ai.

## Vérification préalable (faite le 19/10)

Depuis `claude -p` avec le seul outil `Artifact` autorisé : un nouveau deck Slides se crée, les
diapositives du modèle s'y recopient (une copie serveur d'un HTML est refusée : il faut le lire
puis le republier), et le deck se relit. Les images du modèle et le fichier de couleurs se
copient à part (assets) : c'est écrit dans la skill.

Les supports déjà archivés viennent de l'ancien deck unique, réécrit depuis : ils s'importent
avec leur texte final, sans lien de deck.

## Tests

Données fictives uniquement : projet, formulaire et texte de deck inventés. Service (statuts,
une demande à la fois, rouvrir après final), outils MCP (jeton limité au projet), runner
(arguments et outils autorisés, skills synchronisées détectées, sans second cerveau), import.
Vérification dans le navigateur de l'étape 1.

## Hors périmètre

Import du PDF de l'outil et calcul du profil (livraison 2), rapport (3), capitalisation (4).
Affichage du deck dans l'OS : la présentation se fait depuis claude.ai.

## Échéance

Visée : utilisable vers le 22/10, pour préparer le prochain entretien prévu le 26/10. À défaut,
le support se prépare comme aujourd'hui sur claude.ai.
