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
| **Brief du jour** | Votre journée : rendez-vous et tâches du jour issues de HubSpot, filtrables par canal, avec le bouton pour lancer la routine quotidienne. À côté, les tâches réalisées (hier, 7 jours, 30 jours), détail emails et appels. |
| **À valider** | Les relances à planifier et les brouillons à envoyer. Vous validez, modifiez ou écartez. Les brouillons Gmail sont créés sans signature. |
| **Tableau de bord** | L'entonnoir lead → prospect → devis → commande, avec curseurs pour simuler l'objectif annuel. |
| **Prospection** | Règles de sélection explicites (base utilisée, ciblage, exclusions), simulation, puis lot de brouillons. |
| **Bases vivantes** | Ce qu'est une base vivante, statuts, import, enrichissement, instantanés. Branchement à la base de données commune à venir. |
| **Pipeline** | Étapes en glisser-déposer avec le taux de conversion entre chaque étape, colonnes Gagnées et Perdues ; ou matrice potentiel × faisabilité. Pour un mandat sous HubSpot (Helioval), le pipeline est le miroir de HubSpot, avec synchronisation à la demande. |
| **Entreprises, Contacts** | Les fiches de l'instance, avec recherche. Sous HubSpot (Mon activité, Helioval), ce sont des miroirs de HubSpot, comme le pipeline. |
| **Paramètres** | Par instance. Connexions : HubSpot (fréquence, sens, objets et champs synchronisés), Gmail, agenda. Routines Claude : heure, jours, tâches traitées, brouillons, créneaux. |
| **Rendez-vous** | Préparation (questions selon les trous de qualification, binôme) et compte rendu. |
| **Devis** | Brique propre à l'activité SIMATIS, absente des mandats. L'OS prépare les lignes, vous fixez les prix. |
| **Relais internes** | Points mensuels avec les experts du mandat (instance Helioval). |

**Plus tard** (menu replié en bas) : Plan d'action, Diagnostic, Détection, Autonomie, Journal d'audit, Second cerveau. Ces écrans restent consultables mais seront refaits.

Le sélecteur en haut à gauche range les instances en trois groupes : **Mon activité** (SIMATIS), **Mandats en cours** (Helioval, Aquaterra) et **Mandats prospects** (Dupont Industrie). Un mandat prospect est un espace de démonstration aux données fictives : on le montre soi-même ou on en partage une copie isolée avec le prospect. « Nouveau mandat prospect » en crée un. Dans **Paramètres**, onglet Mandat, un prospect qui signe se transforme en mandat en cours : l'espace repart vide et il reste à brancher les outils du client. Le **Portefeuille** ne croise que des compteurs.

### Vrais noms, sur votre poste seulement

Le dépôt est public : il ne contient que des noms fictifs. Pour voir les vrais noms de vos mandats sur votre poste, créez `js/instances.local.js` (ignoré par git, jamais publié) :

```js
window.INSTANCES_LOCAL = { helioval: 'Nom du premier mandat', demo: 'Nom du mandat prospect' };
```

Seuls les noms changent : les données affichées restent fictives.

## Ce que la maquette ne tranche pas

Les décisions ouvertes du cadrage restent ouvertes : emplacement des bases, exécution des routines, authentification, interface définitive, périmètre du portefeuille. Les seuils et le modèle de l'entonnoir sont des hypothèses à valider.
