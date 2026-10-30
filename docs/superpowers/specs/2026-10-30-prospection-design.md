# Prospection : spécification de la maquette

Date : 30/10/2026. Statut : à relire par Marc. Périmètre de cette étape : **maquette HTML à données fictives**, sans branchement à Gmail ni à HubSpot. Le code produit viendra dans un second temps (plan, puis construction).

## Objectif

Permettre à Marc de produire le plus de mails de prospection possible en une journée, avec un outil simple qui donne envie de s'en servir. Il sert d'abord à Marc, puis aux mandats (même fonctionnement, bases, tâches, signatures et statistiques propres à chaque mandat).

## Trois cas, une seule notion de campagne

Une campagne est un lot de mails rédigés, relus et envoyés ensemble. Trois cas d'usage, deux points d'entrée :

1. **Relance ciblée** : quelques tâches HubSpot (cas de départ : 6 relances après une recommandation), avec une offre de remplacement (Test de VMA de 10 minutes au lieu du diagnostic).
2. **Relance de masse** : 5 à 30 tâches HubSpot, plus hétérogènes, un brouillon par tâche, basé sur le mail d'origine, avec des créneaux.
3. **Prospection à froid** : un échantillon de la base vivante, sur un thème (Test de VMA, Diagnostic d'endurance, les deux, Kairos).

Les cas 1 et 2 sont le même mécanisme (« Relancer des tâches »). Le cas 3 est « Prospecter à froid ».

## Parcours en cinq temps

1. **Choisir.**
   - Relances : sélection de tâches HubSpot en retard ou dues. Le fil Gmail d'origine fournit le style.
   - Froid : échantillon de la base vivante (nombre, filtre société ou secteur), avec les règles d'exclusion affichées (déjà contactés, invalides, clients, historique, contacts épuisés).
2. **Régler** (un seul panneau) : offre ; style (reprendre le ton du fil) ; créneaux (3, vérifiés dans l'agenda, entre 1 et 2 semaines après l'envoi, ou aucun) ; signature (A, B, C ou aucune) ; délai du prochain suivi ; nombre maximum de touches (froid).
3. **Rédiger** : un brouillon par contact. Vouvoiement, « Bonjour Prénom, » (prénom seul), court, « Bien à vous, », puis la signature choisie. Créneaux en liste à puces.
4. **Relire en lot** : liste des mails à gauche, brouillon à droite. Par mail : modifier, écarter, régénérer, changer le suivi (relancer dans N, date citée par le contact, dossier clos).
5. **Envoyer et suivre** : pour chaque mail, une occurrence de prospection et une tâche de suivi.

## Suivi (règles reprises des routines de relance existantes de Marc)

- Tâche de suivi obligatoire après un mail avec créneaux. Délai par défaut 2 à 3 semaines ; Marc peut choisir 1 à 2 mois ou une date précise au lancement de la campagne.
- Échéances étalées sur les jours travaillés de Marc pour l'instance (jours non travaillés de l'instance, jours « off » exclus, jours fériés exclus).
- Le canal d'origine est conservé : une tâche MAIL donne une tâche MAIL, une tâche TEL donne une tâche TEL.
- Refus explicite du contact : dossier clos, aucune tâche de suivi. Date de reprise citée par le contact : tâche à cette date exacte.
- Tâche de relance MAIL en retard sans mail envoyé : échéance reportée de 7 jours (jour travaillé).
- Anti-doublon avant toute création de tâche.
- Relances : tâche de suivi dans **HubSpot** (les contacts y sont tous). Froid : tâche dans **l'OS** (contacts peu qualifiés). Un contact qui répond passe dans HubSpot.

## Cycle de vie d'un contact à froid

| Étape | Effet |
|---|---|
| Jamais contacté | Peut être tiré dans un échantillon. |
| Touche 1 à N envoyée | Occurrence créée, tâche de suivi dans l'OS à l'échéance choisie. Angle différent à chaque touche. |
| Réponse | Sort du cycle, passe dans HubSpot. |
| Épuisé | Après N touches sans réponse (4 par défaut, réglable à chaque campagne). **Marqué seulement sur confirmation de Marc**, au cas par cas ou en lot. Ne reparaît plus dans les échantillons. Jamais supprimé. |

## Statistiques

- Section Prospection : compteur du jour en grand (par exemple « 14 mails sur 30 », avec un objectif réglable), mails de la semaine, réponses et rendez-vous, détail par thème et par numéro de touche, nombre de contacts épuisés à confirmer.
- **Les mêmes chiffres apparaissent dans le Brief du jour** (mails envoyés aujourd'hui, objectif, tâches de relance faites et restantes).
- Source : table d'occurrences de prospection (campagne, contact, date, thème, numéro de touche, état : brouillon, envoyé, réponse, rendez-vous). La base vivante en reçoit le statut (`contacté`, `a répondu`, `épuisé`).

## Réponses à une campagne, dans l'Inbox

L'Inbox de l'OS (section existante, entrées de plusieurs types : mails à répondre, devis, comptes rendus, brouillons non envoyés, etc.) reste le point d'arrivée des réponses. Elle gagne la reconnaissance des réponses de prospection :

- **Détection.** Une entrée « mail à répondre » dont le fil correspond à une occurrence de prospection (même fil Gmail ou même contact) est signalée comme « Réponse à une campagne », avec la campagne, l'offre et le numéro de touche.
- **Trois actions sur l'entrée**, dans l'esprit de celles qui existent déjà : **Rédiger la réponse** (brouillon Gmail), **Marquer comme traité**, **Transformer en tâche** (relance plus tard : la tâche réapparaît dans « Relancer des tâches », et Marc rédige alors son brouillon dans une campagne).
- **Rédiger la réponse** s'adapte à la teneur du message du contact, pas au seul cadre de prospection. Claude lit le fil et propose une intention que Marc peut changer : intérêt (créneaux d'échange), refus (accepter poliment et remercier, sans relancer), date de reprise citée (accuser réception, suivi à cette date), ou autre (réponse libre au message). Le résultat est un **brouillon Gmail, jamais un envoi direct** ; signature « aucune » par défaut, modifiable. Marc le relit dans Gmail, signe et envoie.
- **Effets sur la prospection.** À la réception de la réponse, l'occurrence passe à « réponse » ; en froid, la séquence s'arrête pour ce contact (statut `a répondu`, passage dans HubSpot) ; la tâche de suivi en attente est remplacée selon l'intention (refus : dossier clos, aucune tâche).
- Une réponse qui n'a pas de campagne d'origine reste une entrée Inbox ordinaire.

## Envoi et garde-fous

- Le droit Gmail existant (`gmail.compose`) couvre brouillons et envoi.
- Deux boutons en relecture : **« Mettre en brouillons Gmail »** (toujours disponible) et **« Valider et envoyer »**, actif seulement quand les deux verrous de la règle « écritures vers un système tiers » sont ouverts (variable serveur et interrupteur admin). Par défaut, simulation.
- Chaque lot envoyé est tracé dans le journal d'audit.
- Signatures : des images fournies par Marc, rangées dans l'OS (hors dépôt), intégrées au mail en pièce inline. Marc en a aujourd'hui deux (Simatis seul ; Simatis et Kairos, avec l'adresse Kairos) et doit pouvoir **en ajouter, renommer, remplacer ou supprimer facilement** : une rubrique « Signatures » dans Paramètres (nom, image, signature par défaut), qui alimente le menu de choix de chaque campagne. Le menu de la maquette affiche donc les signatures existantes, plus « Aucune ».

## Données fictives

La maquette n'utilise que des noms, sociétés et chiffres inventés (règle de confidentialité du dépôt public). Les mentions réelles (clients, contacts, noms de partenaires) sont exclues.

## Livrables de l'étape maquette

- Une page HTML dans `maquettes/` avec les trois écrans (accueil avec statistiques, réglage de campagne, relecture en lot) et une version des indicateurs dans le Brief du jour.
- Mise à jour de la ligne Prospection de `docs/plan.md` (maquette prête, construction à planifier).

## Hors périmètre de cette étape

Code produit, liaison Inbox et campagnes (détection des réponses, bouton de rédaction), connexion Gmail/HubSpot réelle, table d'occurrences, génération par Claude, import des signatures. Ils feront l'objet d'un plan de construction après validation de la maquette.
