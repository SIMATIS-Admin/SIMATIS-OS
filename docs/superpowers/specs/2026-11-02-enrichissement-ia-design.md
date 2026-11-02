# Enrichissement de listes par IA (API OpenAI + recherche web)

Date : 2026-11-02. Statut : conception validée par Marc dans la conversation, à relire.

## Objectif

Depuis une liste de prospection, Marc coche des fiches et lance un enrichissement en lot :

- **entreprise sans contact** : trouver des personnes (nom, fonction, mail, téléphone) ;
- **contact incomplet** : compléter le mail ou le téléphone manquant.

Marc choisit à chaque lancement le **profil recherché** (fonctions types saisies librement,
par exemple « dirigeant », « DRH », « responsable achats ») : l'outil doit servir aussi pour des
mandats où le contact visé n'est pas un décideur.

Critères de réussite :

- aucune donnée n'entre dans une fiche sans validation de Marc ;
- chaque donnée proposée porte sa source (URL) et un niveau de confiance ;
- une donnée sans source n'est jamais présentée comme trouvée ;
- la taille de lot est plafonnée et réglable, fixée après un essai mesuré (durée, coût, part
  de résultats sourcés) ;
- sans clé API, la fonction est absente ou désactivée, sans erreur ailleurs.

## Décisions prises

| Question | Décision |
| --- | --- |
| Méthode | API OpenAI (Responses) avec l'outil de recherche web, un appel par entreprise ou contact. |
| Profil recherché | Paramètre du lancement : liste de fonctions saisie par Marc, avec suggestions. Jamais figé dans le code. |
| Devenir du résultat | Suggestions à valider ; Marc coche ce qu'il garde, seul cela remplit la fiche. |
| LinkedIn | Pas de scraping. Seules les pages publiques remontées par la recherche web sont citées. |
| Mails déduits | Une adresse construite par motif (prénom.nom@domaine) est marquée « déduite », jamais « trouvée ». |
| Taille de lot | Plafond configurable ; valeur par défaut fixée après un essai réel sur 5 puis 10 fiches. |
| Clé API | Variable serveur dans `.env` (ajoutée à `.env.example`, sans valeur). Une clé ChatGPT Plus n'ouvre pas l'API. |

## Fonctionnement

1. Dans la barre de lot d'une liste, bouton **Enrichir** : une fenêtre demande le **type**
   (trouver des contacts / compléter mails et téléphones), le **profil recherché** (fonctions) et
   le nombre maximum de personnes par entreprise, puis affiche le coût indicatif du lot.
2. L'OS crée une **tâche d'enrichissement** et traite les fiches une à une, quelques-unes en
   parallèle, en arrière-plan. Un échec sur une fiche n'arrête pas le lot et reste visible,
   avec la possibilité de relancer.
3. Chaque réponse est validée par un schéma strict (nom, fonction, mail, téléphone, URL source,
   confiance, mode « trouvé » ou « déduit »). Toute réponse hors schéma est rejetée, jamais
   écrite telle quelle.
4. Un panneau **Suggestions à valider** liste, par fiche, ce qui a été trouvé, avec la source
   cliquable. Marc coche, puis valide : seules les lignes cochées créent ou complètent les
   contacts. Les contacts existants ne sont jamais écrasés : une valeur déjà présente est
   proposée comme alternative, pas comme remplacement.
5. Les doublons (même personne, même mail) sont écartés avant affichage.

## Composants

- **Client OpenAI** (un module, une interface) : envoie une demande, renvoie une réponse typée.
  Remplaçable par un faux dans les tests ; seul point qui connaît le fournisseur.
- **Consigne d'enrichissement** : texte générique construit à partir du profil saisi ; aucune
  méthode ni donnée propriétaire de SIMATIS.
- **Tâches d'enrichissement et suggestions** : tables par instance (cloisonnement existant),
  état par fiche (en attente, en cours, terminée, échec), suggestions liées à la tâche.
- **Traitement de lot** : file avec plafond de parallélisme, plafond de lot et plafond de
  dépense par lot ; reprise après redémarrage.
- **Interface** : bouton dans la barre de lot, fenêtre de lancement, panneau de validation.

## Limites et garde-fous

- Plafond de dépense et de taille de lot appliqués côté serveur, pas seulement dans l'écran.
- Jamais de clé ni de réponse brute du fournisseur dans les journaux.
- Les noms d'entreprises de la liste sont envoyés à OpenAI : c'est Marc qui déclenche chaque
  lot, et l'écran le dit.
- Hors périmètre : écriture vers HubSpot ou autre système tiers (le circuit existant avec
  dry-run et double verrou s'applique ensuite, inchangé), scraping de LinkedIn, vérification de
  la délivrabilité des mails.

## Tests

Faux client OpenAI et données fictives uniquement (dépôt public). À couvrir : validation de
schéma et rejet des réponses invalides, mails « déduits » jamais présentés comme trouvés,
non-écrasement des fiches, doublons, plafonds de lot et de dépense, échec partiel d'un lot,
reprise, cloisonnement par instance, absence de clé API, parcours de validation côté écran.

## Livraisons

1. Socle : client OpenAI, tables, traitement d'une tâche, tests (sans écran).
2. Écrans : lancement depuis la barre de lot, panneau de validation.
3. Essai réel sur 5 puis 10 fiches, mesures, réglage du plafond de lot par défaut.
