# Diagnostic, livraison 3 : import du PDF de l'outil et calcul du profil

Date : 2026-10-20. Statut : approuvée par Marc le 20/10/2026 (réponses aux questions ouvertes ci-dessous). Troisième livraison du processus : support (livraison 1), **PDF → profil** (ici),
rapport (livraison 2, déjà mergée), capitalisation.

Ce document ne décrit que la partie **publique et générique**. La grille de scoring, les questions,
les libellés des réponses et les PDF réels vivent dans le second cerveau et hors du dépôt.

## Objectif

À l'étape 2 d'un projet (« Entretien et résultat de l'outil »), le pilote importe le PDF produit par
l'outil d'entretien externe. L'OS en lit les réponses, calcule les trois dimensions et le profil avec
la grille, et affiche le résultat tout de suite. Les réponses restent corrigeables : le profil se
recalcule à chaque correction.

Critères de réussite :

- un PDF importé donne un profil sans saisie manuelle des notes ;
- le calcul se fait en code (jamais par Claude) avec la grille de référence ;
- « Non applicable » est exclu du calcul, au numérateur comme au dénominateur ;
- une réponse corrigée recalcule les dimensions et le profil, et l'historique des corrections est gardé ;
- le PDF original reste dans le projet ;
- aucune donnée réelle (nom d'entreprise, réponses, PDF, grille) dans le dépôt : les tests utilisent une
  grille et un PDF fictifs.

## Décisions prises (par Marc, 19/10 et 20/10)

| Question | Décision |
| --- | --- |
| Entretien | Toujours mené dans l'outil externe ; l'OS n'a pas de questionnaire pour l'instant. |
| Lecture du PDF | Claude lit le PDF et rend les réponses (une lettre par question). L'OS ne devine pas la mise en page. |
| Calcul | Par l'OS, en code, avec la grille de référence. Claude ne calcule rien. |
| Grille | Un seul fichier dans le second cerveau, lu par la skill et par l'OS. Tests : grille fictive. |
| « Non applicable » | Exclu du calcul (ni numérateur, ni dénominateur). |
| Validation | Aucune avant affichage : le profil s'affiche tout de suite, les réponses restent corrigeables. |
| Archivage | Le PDF et les réponses restent dans le projet de l'OS ; une copie part dans le dossier client du second cerveau (hors dépôt). |
| Seuil | 6/10 par défaut, lu dans la grille. |

## Parcours

1. **Import.** À l'étape 2, un bouton « Importer le PDF de l'outil » accepte un fichier PDF
   (taille maximale à fixer, proposition : 10 Mo). Le fichier est enregistré avec le projet.
2. **Lecture.** Une demande part au runner (même mécanisme que le support et le rapport). Claude
   lit le PDF et enregistre les réponses par l'outil MCP `enregistrer_reponses_entretien` : une
   entrée par question, avec son identifiant de la grille et sa lettre A à E (ou « N/A »).
3. **Calcul.** Dès l'enregistrement des réponses, l'OS calcule les trois dimensions et le profil,
   puis l'affiche dans l'étape 2 avec le détail par dimension.
4. **Correction.** Le pilote modifie une réponse dans l'OS. Les dimensions et le profil sont
   recalculés, et la correction est ajoutée à l'historique du projet.
5. **Retour arrière.** La saisie manuelle des trois notes (existante) reste disponible pour les
   projets déjà importés et pour les cas où le PDF n'est pas lisible.

## Changements techniques

**Schéma** (`src/diagnostic/schema.ts`, migration) :
- `reponsesEntretien` : jsonb, liste `{ question: string; reponse: 'A'|'B'|'C'|'D'|'E'|'N/A' }`,
  défaut `[]`.
- `pdfEntretien` : texte base64 du PDF (nullable), `pdfEntretienNom` : texte.
- `historiqueReponses` : jsonb, liste `{ question, ancienne, nouvelle, le }`, défaut `[]`.
- Les notes `dims` existantes restent la source d'affichage ; l'import les remplit.

**Calcul** (`src/diagnostic/score.ts`, fonction pure) :
- `scorer(reponses, grille)` renvoie `{ dims: Dimensions; profil: Profil }`.
- Chaque dimension = moyenne pondérée des scores des questions de cette dimension, avec A=10, B=7,
  C=4, D=1, E=0 ; les « N/A » sont retirés du numérateur et du dénominateur.
- Le profil reprend `profilDe` existant (cascade, seuil de la grille).
- Une dimension sans aucune réponse retenue renvoie une erreur explicite (pas de note inventée).

**Grille** :
- Fichier JSON produit à partir de l'onglet « Grille de scoring » du classeur, rangé dans le second
  cerveau, chemin donné par variable d'environnement (ex. `DIAGNOSTIC_GRILLE`). Ajouter la variable à
  `.env.example` sans valeur.
- Format attendu : `{ seuil, dimensions: { outils, strategie, polyvalence }, questions: [{ id, dimension, poids }] }`.
- Le serveur refuse de démarrer l'import si le chemin est absent (message clair, aucun calcul faux).

**Demandes au runner** : nouveau type de demande `entretien` (sur le modèle de `rapport`). Pendant le
traitement, statut `en_cours` ; à la fin, le statut revient à son état réel. Outils autorisés :
lecture du PDF du projet uniquement (dossier de travail), aucune écriture ailleurs.

**Outil MCP** : `enregistrer_reponses_entretien` (projetId, réponses). Validation : identifiants
présents dans la grille, lettres autorisées, une seule réponse par question.

**Interface** (`web/src/pages/Diagnostic.tsx`, étape 2) : zone d'import, état « Claude lit le PDF… »,
profil et notes par dimension, liste des réponses avec choix modifiable.

## Erreurs

- PDF illisible ou non conforme : Claude le dit dans le chat, aucun résultat n'est écrit.
- Question inconnue de la grille ou réponse hors A–E / N/A : refusée par l'outil MCP.
- Grille absente : l'import est refusé avec un message explicite.
- Dimension sans réponse retenue : profil non calculé, message affiché.

## Tests

- `scorer` : moyenne pondérée, « N/A » exclu, dimension vide refusée, cascade de profil, recalcul
  après correction (grille fictive).
- Outil MCP : identifiant inconnu refusé, lettre hors liste refusée, réponses enregistrées une fois.
- Historique : une correction garde l'ancienne valeur.
- Runner : demande `entretien` traitée, statut ramené à son état réel si Claude ne rend rien.
- Interface : import visible à l'étape 2, profil affiché après réponses, correction recalcule.
- `npm run verify` avant chaque commit.

## Hors périmètre

- Questionnaire dans l'OS (pas maintenant, selon la décision du 19/10).
- Capitalisation de la revue (livraison suivante).
- Import des 57 questions de la version entretien : seule la grille de scoring est lue par l'OS.

## Réponses de Marc (20/10/2026)

1. **PDF** : Marc importe lui-même le PDF dans l'OS. Claude le lit à partir de là ; aucun exemple n'est
   fourni hors de l'application.
2. **Grille** : l'onglet « Grille de scoring » actuel du classeur (21 questions pondérées).
3. **Saisie manuelle** : conservée comme secours à l'étape 2.
4. **Taille maximale du PDF** : 10 Mo.
