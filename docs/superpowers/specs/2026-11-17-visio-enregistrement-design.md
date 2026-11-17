# Visio : création et enregistrement depuis l'OS — conception

Date : 2026-11-17. Statut : à relire par Marc avant le plan d'implémentation.

## But

Marc crée une visio, l'enregistre et en obtient la transcription et le résumé sans quitter l'OS. Raison : Wispr Flow est un outil séparé et payant (environ 15 € par mois, autant côté client). Le cahier des charges d'un CRM client demande la même chose (F1) : programmer la visio, transcrire et résumer dans le même module, sans API payante.

## Hors périmètre

- Connecteur Outlook et Teams (autre CRM) : la brique est conçue pour être réutilisée, pas livrée ici.
- Robot qui rejoint la réunion (payant) et visio hébergée dans l'OS : écartés, voir Approches.
- Identification des voix au-delà de deux pistes (soi, les autres).
- Remplacement de la lecture des notes Wispr Flow dans l'Inbox : elle reste telle quelle.

## Approches

- **A. Bouton d'enregistrement dans le rendez-vous (retenue par Marc).** Création du lien Google Meet depuis l'OS, capture du micro et de l'onglet de la visio par le navigateur, transcription locale, résumé par Claude. Gratuit, dans l'existant. Limite : visio ouverte dans un onglet du navigateur.
- B. Visio hébergée dans l'OS : son séparé par participant, mais lourd, et les prospects devraient rejoindre un lien inhabituel.
- C. Robot qui rejoint la réunion : le plus propre, mais payant, contraire au but.

## Conception

### 1. Création de la visio

Un bouton « Nouvelle visio » (écran Rendez-vous) crée un événement Google Agenda avec :
- un lien Google Meet (`conferenceData` avec `conferenceDataVersion=1`) ;
- les invités (champ `attendees`), qui reçoivent l'invitation dans leur agenda ;
- le titre construit par la nomenclature de Marc.

`creerEvenement` ([google.ts:534](../../../src/connecteurs/google/google.ts)) crée déjà l'événement sans invité ni lien : il est étendu, sans changer son comportement quand on n'ajoute ni invité ni visio. La portée Google `calendar.events` déjà demandée couvre invités et Meet ; aucune nouvelle autorisation n'est attendue (à confirmer par un essai réel en dernier).

**Nomenclature** (fonction pure, testable) : `V - <Entreprise> x <Instance> - <Motif>`, motif facultatif ; sans motif, `V - <Entreprise> x <Instance>`. L'entreprise vient de la fiche choisie, l'instance est le nom de l'instance courante (ici SIMATIS), le motif est un texte libre avec quelques suggestions (Restitution, Point d'étape). Le titre reste modifiable avant création. Pour un autre déploiement, le nom de l'hôte et le format seront un réglage, pas du code.

**Garde-fou** : écriture vers un système tiers = dry-run par défaut, double verrou (variable serveur + interrupteur admin). Une invitation envoyée à un client est une écriture réelle : en simulation, rien ne part et l'écran le dit. Aucune invitation sans action explicite de Marc.

### 2. Enregistrement

Dans la fiche du rendez-vous, un bouton « Enregistrer » :
- demande au navigateur le micro de Marc et le partage de l'onglet de la visio avec son son ;
- garde deux pistes : micro de Marc (« moi ») et son de l'onglet (« les autres ») ; en visio à deux, cela suffit à savoir qui parle ;
- envoie le son à l'OS par morceaux d'environ 30 secondes, pour que la transcription avance pendant la réunion ;
- affiche un état visible (enregistrement en cours, durée) et un bouton d'arrêt. Aucune capture ne démarre sans clic de Marc ; un rappel invite à prévenir les participants.

Si le partage du son de l'onglet n'est pas donné, l'OS le dit et n'enregistre que le micro, sans faire semblant.

### 3. Transcription

Moteur local libre (whisper.cpp ou équivalent) exécuté sur le poste de Marc, pas dans le conteneur Docker (pas d'accélération matérielle dans le conteneur). L'exécuteur du poste, qui lance déjà Claude en local, est le candidat pour recevoir les morceaux et rendre le texte. Le texte est ajouté au rendez-vous au fil de l'eau, horodaté et attribué à « moi » ou « les autres ». Si le texte en direct est trop lent ou trop imprécis, la transcription finale se refait sur l'enregistrement complet après l'arrêt : quelques minutes de délai sont acceptées par Marc.

### 4. Résumé

À l'arrêt, une tâche Claude locale (abonnement existant, comme les routines) rédige le résumé depuis le transcript, avec la skill « naturelle ». Résumé et transcript sont rattachés au rendez-vous, et le circuit existant de comptes rendus de l'Inbox est réutilisé (`reunionsWispr` et `conversion/reunion-rdv.ts`) pour ne pas redemander un compte rendu qui existe. Le plan décide s'il faut généraliser cette table (aujourd'hui nommée d'après Wispr Flow) ou en ajouter une.

### 5. Données et confidentialité

Le son brut est supprimé après transcription réussie (choix par défaut de cette conception, modifiable par Marc). Le transcript est une donnée métier : base de l'instance, isolation par instance comme le reste, jamais dans git. Exemples et tests : données fictives uniquement, faux moteur de transcription et faux agenda.

### 5 bis. Interface entre la capture et l'OS

La capture (bouton du navigateur aujourd'hui, petite appli à part demain) ne connaît que cette interface de l'OS, jamais ses tables :
- lister les rendez-vous en cours ou proches, pour que l'appli sache à quel rendez-vous rattacher l'enregistrement, sans « réunion à attribuer » ;
- ouvrir une session d'enregistrement pour un rendez-vous ;
- envoyer des morceaux de son, ou directement du texte déjà transcrit (l'appli à part transcrira elle-même) ;
- clore la session, ce qui lance le résumé et le rattachement à la fiche, au contact et à l'Inbox.

Le bouton du navigateur est le premier client de cette interface, et il doit l'utiliser comme le ferait l'appli : pas de raccourci interne. Un jeton propre à l'appli (révocable, jamais dans git) sera nécessaire à la livraison de l'appli, pas avant. L'avantage visé sur Wispr Flow : l'enregistrement arrive déjà rattaché au bon rendez-vous, avec ses contacts, sans tri manuel.

### 6. Réutilisation pour un autre CRM

Trois pièces indépendantes : nomenclature, capture audio dans le navigateur, transcription et résumé. Seule la création de l'événement dépend de Google ; dans un CRM sous Microsoft, elle serait remplacée par Outlook et Teams derrière la même interface.

## Tests

- Nomenclature : avec et sans motif, accents, espaces superflus.
- Création : simulation sans écriture ; mode réel sur faux Google (lien Meet et invités présents, aucun cas sans verrou).
- Enregistrement : morceaux reçus dans l'ordre, reprise après coupure réseau, refus sans partage du son.
- Transcription et résumé : faux moteur, transcript rattaché au bon rendez-vous, bonne instance, son brut supprimé.
- Vérification dans le navigateur de l'écran Rendez-vous (`npm run verify` puis essai réel de Marc).

## Livraisons proposées

1. Nomenclature et création de la visio avec lien Meet et invités (simulation par défaut).
2. Enregistrement et transcription après arrêt.
3. Texte en direct pendant la réunion.
4. Résumé automatique et rattachement à l'Inbox.
5. Plus tard, hors de cette conception : petite appli à part (barre de menus, son système), second client de la même interface.

## Laissé au constructeur

Choix précis du moteur et du modèle de transcription, format des morceaux audio, nom de la table, emplacement du bouton dans l'écran.

## Décisions de cette conception à vérifier

- Suppression du son brut après transcription (par défaut).
- Texte en direct reporté en livraison 3 : la transcription après arrêt arrive d'abord.
