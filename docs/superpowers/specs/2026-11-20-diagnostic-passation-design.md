# Diagnostic d'Endurance Commerciale : passation sur le site, relève par l'OS

Date : 2026-11-20. Statut : approuvé par Marc le 20/11/2026 (maquette cliquable validée, plan en 4 livraisons validé).
Ce document ne décrit que la partie **publique et générique** : le questionnaire (questions, réponses A à E),
la grille et les données d'entreprise restent hors du dépôt.

## Intention

Marc mène l'entretien du Diagnostic d'Endurance Commerciale dans l'outil externe MatuDiag, puis importe un PDF.
Il veut une passation **dans une page de son site**, calquée sur le Test de VMA (une question par écran,
jauge, chrono), que l'OS relève ensuite pour calculer les scores. Le but : ne plus utiliser l'outil externe.

## Buts, non-buts

- Buts : 57 questions et 3 questions préliminaires reprises du questionnaire actuel (A à E, commentaire
  facultatif par question) ; compte à rebours de 1 h 30 avec pause ; console « Mes diagnostics » (en cours,
  terminés, mode essai) ; fiche préparée depuis l'OS (aucune ressaisie) ; relève par l'OS, calcul des
  dimensions et du profil avec le code existant.
- Non-buts : lien à envoyer au dirigeant (Marc seul saisit) ; modification du questionnaire (repris tel quel,
  version du 10/09) ; refonte du calcul ou de la grille ; suppression de l'import PDF et de la saisie
  manuelle (gardés comme secours).
- Anti-but : des données d'entreprise ou le questionnaire dans le dépôt ; des réponses perdues si l'onglet se ferme.

## Décisions

| Sujet | Décision |
| --- | --- |
| Hébergement | Fonctions Cloudflare Pages du site, KV `VMA` existant, préfixe `diag:`. Secrets déjà en place : `VMA_OS_TOKEN` (OS vers site), `OS_PULL_TOKEN` (relève). Aucun nouveau secret. |
| Questionnaire | `config/diagnostic-endurance.json` du site (hors dépôt). Chaque rubrique porte `section` (nom court de la grille, ex. « Force de vente ») et `titre` (affiché). Numéros d'origine gardés pour la grille, affichage de 1 à 57. |
| Réponses | Lettres A à E ; « E » = non applicable, envoyé à l'OS sous la forme `N/A`. Envoi possible seulement quand les 57 questions ont une réponse. |
| Console | Liste les documents `diag:` : en cours (question atteinte), à faire, terminés (profil), plus un mode essai (document marqué essai, expire à 7 jours, jamais relevé). |
| Fiche préparée | L'OS pousse entreprise, interlocuteur, activité, taille, rendez-vous, contexte au clic sur « Lancer le diagnostic » (`POST /api/diagnostic/preparer`, jeton `VMA_OS_TOKEN`) et reçoit le lien de la console (session 12 h). |
| Sauvegarde | À chaque réponse, `PUT` du document (réponses, commentaires, position, temps écoulé). Reprise depuis n'importe quel navigateur tant que la session vit. |
| Relève | L'OS lit `GET /api/diagnostic/en-attente` (jeton `OS_PULL_TOKEN`) dans sa boucle de relève existante, enregistre dans le projet, puis `POST /api/diagnostic/acquitter` : le site garde un résumé (nom, date, durée, profil) et supprime les réponses. |
| OS : stockage | Colonnes ajoutées à `diagnostic_projets` : `passation` (jsonb : 57 réponses, commentaires, durée, version du questionnaire). `reponsesEntretien` reçoit seulement les questions de la grille (le calcul refuse les autres). Les dimensions sont calculées par `scorer`. |
| Revoir un terminé | Le bouton mène au projet dans l'OS (les réponses complètes y vivent). |

## Livraisons

1. **Questionnaire et API du site** : fichier de configuration, fonctions `preparer`, `liste`, lecture et sauvegarde d'un document, `envoyer`, `en-attente`, `acquitter`, tests d'API.
2. **Page du site** : console, fiche préparée, passation (jauge, cadran 1 h 30, pause, commentaire, vue d'ensemble, fin), mode essai. Style du Test de VMA, bandeau sobre.
3. **OS** : bouton « Lancer le diagnostic » (étapes 1 et 2), route de préparation, relève, migration, enregistrement et calcul, affichage de la durée et des commentaires à l'étape 2.
4. **Suite du processus** : vérifier que revue, rapport et capitalisation lisent bien les commentaires.

## Laissé au réalisateur

Détails de mise en page, textes d'erreur, nombre maximal de documents listés (proposition : 50), format exact du résumé gardé par le site.

## Tests

Tests d'API du site avec questionnaire fictif (`node outils/test-api-diagnostic.mjs`, sur le modèle de `test-api-vma.mjs`) ;
tests OS avec grille et passation fictives : relève, correspondance A–E / `N/A`, réponses hors grille mises de côté,
calcul des dimensions, acquittement, route de préparation, bouton. `npm run verify` avant chaque commit.
