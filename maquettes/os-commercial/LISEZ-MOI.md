# SIMATIS OS : maquette interactive

Prototype cliquable de l'**OS commercial** : le cockpit d'un directeur commercial à temps partagé, où l'IA prépare et le pilote décide.

Toutes les données sont **fictives** : sociétés, personnes, montants et mandats (Helioval, Aquaterra et Dupont Industrie sont inventés). Rien n'est connecté : ni Gmail, ni agenda, ni CRM. Aucun message ne part.

## Ouvrir

Double-cliquez sur `index.html`. Vos actions sont mémorisées dans le navigateur ; « Tout réinitialiser » (en bas du menu) remet la maquette à zéro.

## Ce qu'on peut tester

Priorité actuelle : l'activité commerciale de SIMATIS. Les écrans en favoris (étoile) s'affichent en haut du menu ; par défaut **Pipeline**, **Brief du jour** et **Prospection**. Cliquez sur l'étoile à côté d'un titre pour ajouter ou retirer un favori ; faites glisser un favori pour changer leur ordre.

| Écran | Ce qu'il montre |
| --- | --- |
| **Routines Claude** | En tête du menu. Les connexions de l'instance (CRM, Gmail, agenda) et les routines, à lancer d'un clic : relance quotidienne, nettoyage des tâches, revues. Sans Gmail configuré (Aquaterra), la routine s'arrête au lieu d'utiliser une autre boîte. |
| **Brief du jour** | Ce qui vous attend ce matin et le rapport de la routine de nuit. |
| **À valider** | Les relances à planifier et les brouillons à envoyer. Vous validez, modifiez ou écartez. Les brouillons Gmail sont créés sans signature. |
| **Tableau de bord** | L'entonnoir lead → prospect → devis → commande, avec curseurs pour simuler l'objectif annuel. |
| **Prospection** | Règles de sélection explicites (base utilisée, ciblage, exclusions), simulation, puis lot de brouillons. |
| **Bases vivantes** | Ce qu'est une base vivante, statuts, import, enrichissement, instantanés. Branchement à la base de données commune à venir. |
| **Pipeline** | Étapes en glisser-déposer avec le taux de conversion entre chaque étape, colonnes Gagnées et Perdues ; ou matrice potentiel × faisabilité. Pour un mandat sous HubSpot (Helioval), le pipeline est le miroir de HubSpot, avec synchronisation à la demande. |
| **Rendez-vous** | Préparation (questions selon les trous de qualification, binôme) et compte rendu. |
| **Devis** | Brique propre à l'activité SIMATIS, absente des mandats. L'OS prépare les lignes, vous fixez les prix. |
| **Relais internes** | Points mensuels avec les experts du mandat (instance Helioval). |

**Plus tard** (menu replié en bas) : Plan d'action, Diagnostic, Détection, Autonomie, Journal d'audit, Second cerveau. Ces écrans restent consultables mais seront refaits.

Le sélecteur en haut à gauche change d'instance (activité propre, deux mandats fictifs, démonstration) et ouvre le **Portefeuille**, qui ne croise que des compteurs. L'instance **Dupont Industrie** affiche le bandeau de démonstration et le scénario en sept étapes.

## Ce que la maquette ne tranche pas

Les décisions ouvertes du cadrage restent ouvertes : emplacement des bases, exécution des routines, authentification, interface définitive, périmètre du portefeuille. Les seuils et le modèle de l'entonnoir sont des hypothèses à valider.
