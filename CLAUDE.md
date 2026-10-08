# Règles du projet SIMATIS OS

## Confidentialité (règle absolue)

Ce dépôt est **public** sur GitHub. Ne jamais y écrire, committer ni pousser :

- noms de clients, prospects, contacts, mandats réels, ni montants, tarifs ou marges réels ;
- données extraites de HubSpot, Gmail, Google Agenda ou tout autre outil réel ;
- identifiants, mots de passe, clés d'API, jetons, fichiers `.env` ;
- méthodes ou contenus propriétaires (questionnaires, grilles de scoring détaillées, trames de rapport) ;
- contenu du second cerveau, en tout ou partie.

Les exemples, tests et démonstrations utilisent **uniquement des données fictives**.
Un secret poussé une fois reste récupérable dans l'historique : en cas de doute, ne pas committer, demander.

## Second cerveau

Le second cerveau est privé et contient toute l'information confidentielle et métier. Ce dépôt peut le **référencer par concept** (« voir le second cerveau, fiche mandat »), jamais en copier le contenu.
La configuration locale (chemins, URL, jetons) passe par des variables d'environnement ou des fichiers ignorés par git.

## Avant chaque commit

1. Relire `git diff --staged` en cherchant toute donnée réelle ou secret.
2. Ne jamais utiliser `git add -A` à l'aveugle : ajouter les fichiers explicitement.
3. Pas de push sans demande explicite de Marc.

## Langue

Documentation et interface en français. Code et identifiants techniques en anglais ou français, de façon cohérente.
