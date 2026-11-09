# Refonte de la section Gestion : pilotage, import Pennylane, projection reliée au pipe

Date : 2026-11-03. Statut : direction validée par Marc sur maquette (conversation du 03/11), spec à relire.

## Objectif

La section Gestion (Mon activité) est difficile à suivre : 6 onglets pour 3 questions, dépenses et recettes séparées, des chiffres sans verdict. Marc veut :

- comprendre en quelques secondes si la trésorerie tient, et pourquoi ;
- alimenter les données par import de fichiers exportés de Pennylane, sans ressaisie ;
- que les projections s'appuient sur le pipe : une affaire pondérée par sa probabilité, avec une date de signature estimée, devient un encaissement prévu.

Critères de réussite :

- l'écran d'ouverture dit en une phrase si la trésorerie tient et à partir de quand elle ne tient plus ;
- un export Pennylane (transactions, factures clients, factures fournisseurs) s'importe en moins de cinq clics, sans doublon à la deuxième importation ;
- modifier la date de signature ou la probabilité d'une affaire change la projection ;
- aucune donnée n'est écrite chez un tiers (Pennylane, HubSpot) par cette fonction.

Hors périmètre : API Pennylane (réservée à l'offre Essentiel), écriture vers Pennylane, grand livre, suites du Lot D (PDF, XLSX comptable, Agenda), Lot E.

## Décisions prises

| Question | Décision |
| --- | --- |
| Navigation | 4 onglets : **Pilotage**, **Mouvements**, **Importer**, **TVA & IK** (au lieu de 6). Les écrans TVA, IK et compte d'associé existants sont conservés tels quels. |
| Dépenses et recettes | Une seule liste (« Mouvements »), distinguées par signe et couleur. Les tables et services existants restent inchangés ; seule la vue les réunit. |
| Source des données | Import de fichiers Pennylane (.xlsx et .csv). Pas d'API. |
| Date de signature estimée | Nouvelle colonne OS-only `signature_estimee` sur les affaires, éditable depuis Gestion et la fiche, jamais envoyée à HubSpot (comme la probabilité manuelle). Repli : `echeance`, la date de clôture prévue HubSpot, qui n'est modifiable après création que par une écriture HubSpot protégée par le double verrou. Correction du 03/11 : la première version de cette spec croyait la date déjà éditable. |
| Probabilité | `probabiliteManuelle` si renseignée, sinon la probabilité de l'étape. Déjà en place. |
| Affaire sans date | Exclue de la projection et signalée. Aucune date n'est supposée. |
| Délai de paiement | Réglage existant `delaiPaiementJours`. Valeur par défaut de la maquette : 30 jours, à confirmer par Marc dans les réglages. |

## Fonctionnement

### 1. Pilotage

Un verdict en tête, calculé :

- *bon* : aucun scénario ne passe sous le seuil sur 12 mois ;
- *attention* : le scénario sécurisé passe sous le seuil, pas le central ;
- *alerte* : le central passe sous le seuil.

La phrase nomme le mois du franchissement et le nombre d'affaires dont la trésorerie dépend. Sous le verdict : quatre repères (solde, à encaisser 30 jours, à payer 30 jours, autonomie sans pipe), puis le graphique à trois scénarios :

- **Sécurisé** : recettes certaines seulement ;
- **Central** : plus le pipe pondéré (montant × probabilité) ;
- **Ambitieux** : plus les affaires à 50 % et plus, à 100 %.

Un curseur « Et si les signatures glissent ? » (0 à 6 mois) décale les dates de signature du pipe. C'est un calcul d'affichage : il n'écrit rien.

Le tableau « Ce que le pipe apporte » liste les affaires ouvertes avec interrupteur « compter », probabilité, montant, date de signature éditable (écrit `echeance`, comme dans le Pipeline) et montant pondéré. Une affaire récurrente compte `montant × durée d'engagement`.

Règle d'encaissement d'une affaire :

- ponctuelle : 50 % à signature + délai de paiement, 50 % 60 jours plus tard (répartition par défaut, réglable ensuite) ;
- récurrente : une échéance mensuelle à partir de signature + délai de paiement, sur la durée d'engagement.

Les encaissements issus du pipe sont distingués des recettes saisies ou importées et ne les remplacent jamais : quand la facture réelle est importée ou saisie, l'affaire correspondante est retirée de la projection (rapprochement par affaire liée, voir plus bas).

« À faire cette semaine » : mouvements à rapprocher, factures à émettre, TVA à déclarer, affaires sans date.

### 2. Mouvements

Liste unique avec filtres Tout, Dépenses, Recettes, À rapprocher, Prévus. Colonne **Origine** : Pennylane (importé), Saisi, Récurrent, Pipe, Obligation. Le tiroir de modification existant s'ouvre au clic.

### 3. Importer

Parcours en trois étapes : choisir, vérifier, importer.

1. **Choisir** la nature du fichier (transactions bancaires, factures clients, factures fournisseurs). L'écran affiche le chemin dans Pennylane :
   - transactions : Gestion › Transactions › tout sélectionner › Exporter, fichier dans Plus › Exports ;
   - factures clients : Ventes › Factures clients › Exporter ;
   - factures fournisseurs : Achats › Factures fournisseurs › Exporter.
   Pennylane exporte en Excel : l'import lit .xlsx et .csv.
2. **Vérifier** : colonnes reconnues (modifiables, correspondance mémorisée), compteurs nouvelles / déjà présentes / à vérifier, et la liste des lignes douteuses avec une action proposée.
3. **Importer** : écriture dans les tables de Gestion, avec un résumé.

Correspondances :

- transactions → dépenses (sortie) ou recettes (entrée), état « payée / encaissée » ;
- factures clients → recettes (référence de facture conservée, état selon le statut du fichier) ;
- factures fournisseurs → dépenses prévues tant que non payées.

Dédoublonnage : clé stable calculée par ligne (nature, date, montant, libellé normalisé, compte ou référence de facture). Une ligne déjà vue est ignorée ; une ligne proche d'un mouvement prévu (même montant, date à ± 7 jours) est proposée en **rapprochement** plutôt qu'en doublon. Les colonnes exactes de l'export Pennylane ne sont pas documentées : la correspondance se calera sur un vrai fichier fourni par Marc, d'où l'étape de vérification.

Le fichier n'est pas conservé après l'import ; seules les lignes retenues et leur clé le sont.

### 4. TVA & IK

Regroupe les écrans existants, sans changement fonctionnel.

## Données

- Nouvelle table `gestion_imports` : instance, nature, date, nombre de lignes par issue, correspondance de colonnes mémorisée.
- Ajout aux dépenses et recettes : `origine` (saisi, import, récurrent) et `cleImport` (nullable, unique par instance et nature). Migration additive, sans perte.
- Lien affaire ↔ facture : champ nullable `opportuniteId` sur les recettes, pour retirer de la projection une affaire déjà facturée.
- Toutes les tables restent isolées par instance (`instanceIsolation`).

## API

- `POST gestion/import/analyse` : reçoit le fichier, renvoie colonnes détectées, compteurs et lignes douteuses, sans rien écrire.
- `POST gestion/import/valider` : écrit les lignes retenues avec les décisions de Marc.
- `GET gestion/tresorerie` : étendu pour inclure le pipe, avec le décalage de signature en paramètre (`decalage` en mois).
- `GET gestion/pipe` : affaires comptées, pondérées et datées, plus celles sans date.

La lecture des .xlsx demande une bibliothèque côté serveur (aucune n'est présente) ; le choix se fait au plan d'implémentation, avec contrôle de licence et de taille.

## Erreurs et cas limites

- Fichier non reconnu ou colonnes manquantes : message nommant la colonne attendue, rien n'est écrit.
- Montants : décimale à virgule ou à point, signe ou colonnes débit / crédit séparées ; conversion en centimes entiers.
- Plage de dates incohérente (fichier à cheval sur plusieurs exercices) : avertissement, import possible.
- Affaire sans montant : exclue et signalée, comme celle sans date.
- Fichier volumineux : plafond de lignes réglable, refus explicite au-delà.
- Réimport du même fichier : 0 nouvelle ligne, aucune erreur.

## Tests

- Unitaires : lecture de fichiers factices (.xlsx et .csv, virgule et point, débit / crédit), clé de dédoublonnage, rapprochement, calcul de projection avec pipe (pondération, décalage, affaire récurrente, affaire sans date).
- API : analyse sans écriture, validation idempotente, isolation par instance.
- Interface : verdict selon les trois cas, curseur, interrupteur d'affaire, parcours d'import complet.
- Tous les fichiers de test utilisent des données **fictives** ; aucun export réel n'entre dans le dépôt.

## Livraisons proposées

1. **Navigation et Mouvements** : 4 onglets, liste unifiée, sans nouvelle donnée.
2. **Pipe dans la projection** : endpoint `gestion/pipe`, verdict, graphique à trois scénarios, curseur, tableau des affaires.
3. **Import** : analyse, validation, dédoublonnage, rapprochement, sur un vrai fichier fourni par Marc.

Chaque livraison : une branche, une PR, validation de Marc.

## Confidentialité

Dépôt public : aucun export, nom de client, montant ni solde réel. Les exemples et la maquette sont fictifs. Les exports Pennylane restent sur le poste de Marc ; le fichier d'essai servant à caler les colonnes n'est jamais committé.
