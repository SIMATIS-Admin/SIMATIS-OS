# Aide à la relance et à la prospection : conception

Maquette de référence : `maquettes/aide-relance.html` (données fictives).

## Intention

Marc veut qu'au lieu de chercher quoi faire, l'OS lui propose des activités commerciales à réaliser vite : relances par mail ou par téléphone, avec le mail déjà rédigé. Le modèle est son passage du matin pour OID (tâches du jour, brouillons Gmail, fiches d'appel), sans passer par une campagne.

## Objectifs

- Un bloc « À faire maintenant » dans le Cockpit : une liste courte d'actions classées par priorité.
- Trois sources : le Radar, les tâches en retard, les affaires en cours sans activité.
- Marc choisit le nombre d'actions qu'il peut réaliser (5, 10, 15 ou tout) ; son choix est retenu.
- Chaque ligne dit d'où elle vient et pourquoi elle est proposée.
- Un clic ouvre le mail déjà rédigé (brouillon Gmail) ou la fiche d'appel ; Marc relit et envoie.

## Hors périmètre

- Envoi automatique, campagnes, séquences multi-étapes automatiques.
- Remplacer la page Radar (elle garde son écran).
- Rafraîchissement du texte à la minute : les brouillons sont préparés par la routine du matin.

## Anti-objectifs

- L'OS n'envoie jamais seul : brouillon seulement, validation de Marc.
- Pas de liste interminable : la liste ne dépasse jamais le nombre choisi.
- Aucune donnée réelle dans le dépôt public : fixtures et maquette fictives.

## Approches étudiées

1. **Bloc dans le Cockpit, brouillons préparés d'avance (retenu par Marc)** : rapide à l'usage, s'appuie sur la routine de relance quotidienne existante. Contrepartie : un texte peut vieillir dans la journée.
2. Page « Relances » dédiée : plus complète, mais une page de plus à ouvrir.
3. Texte rédigé au clic : toujours à jour, mais une attente à chaque ligne.

## Conception retenue

- **Sources** : tâches de relance échues ; affaires ouvertes sans activité depuis un seuil réglable ; fiches signalées par le Radar. Une même entreprise n'apparaît qu'une fois, avec toutes ses raisons.
- **Priorité** (proposition de l'agent) : tâche en retard, puis affaire la plus avancée dans le pipeline sans activité, puis signal du Radar le plus récent.
- **Canal** (proposition) : mail par défaut ; appel si la tâche est un appel ou si un mail est déjà resté sans réponse.
- **Mail** : rédigé avec la skill « naturelle », salutation au prénom seul, 3 créneaux libres, jamais de signature ajoutée.
- **Appel** : fiche courte (contexte, dernier échange, objectif de l'appel).
- **Après l'action** : la ligne disparaît et l'OS propose la tâche de suite. Marc peut aussi reporter ou écarter (« pas pertinent »).
- **Écran** : en-tête avec le sélecteur du nombre d'actions, puis les lignes ; le détail s'ouvre en volet (texte modifiable, boutons Brouillon Gmail / Fait / Plus tard).

## Livraisons

- **Maquette** (faite) : `maquettes/aide-relance.html`.
- **1 : bloc du Cockpit** (décisions de l'agent, à relire) : la file est calculée dans l'interface à partir de données déjà exposées (`fetchPipeline`, tâches en retard), sans nouvelle table. Mail et fiche d'appel sont rédigés par des modèles fixes selon l'angle (suivi, relance, réponse reçue, premier contact), au prénom seul, sans créneaux ni signature. Boutons « Copier le mail » et « Ouvrir dans ma messagerie » ; « Mail envoyé » ou « Appel passé » clôt les tâches liées et crée la tâche de suite dans l'OS seulement (jamais dans HubSpot). Reports et « pas pertinent » sont retenus dans le navigateur.
- **2 : brouillons préparés et reports serveur** (décisions de l'agent, à relire) : la routine quotidienne existante (skill de relance, mails rédigés avec la skill « naturelle » et trois créneaux libres) dépose déjà des brouillons en attente de validation ; le bloc les retrouve par tâche liée ou par contact et les montre à la place du modèle. « Créer le brouillon Gmail » valide la proposition (dépôt dans la messagerie, simulé tant que l'écriture réelle est fermée) ; rien n'est envoyé. Reports et « pas pertinent » sont rangés côté serveur (préférences de l'instance, sans migration). Une tâche en retard depuis plus de 30 jours passe après les affaires sans activité et le Radar.
- **Hors livraison** : la routine ne prépare des brouillons que pour des tâches échues dans sa fenêtre de retard ; les affaires du Radar ou sans activité sans tâche gardent le modèle fixe. L'étendre demande de modifier la skill de la routine (hors dépôt).

## À la charge du constructeur

Détails d'écran, seuil de « sans activité », nommage, lien avec la routine existante de relance quotidienne.
