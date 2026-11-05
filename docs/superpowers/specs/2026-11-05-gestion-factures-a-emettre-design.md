# Gestion — Factures à émettre par mandat

Date : 2026-11-05. Suite de la refonte de Gestion (`2026-11-03-gestion-refonte-design.md`).
Tous les exemples de ce document sont fictifs.

## 1. Objectif

Une section **Factures à émettre** dans Gestion, organisée par mandat. Pour chaque mandat, l'OS
réunit ce qu'il faut facturer, calcule le total hors taxes, permet d'émettre la facture, et fait
entrer ce total dans le plan de trésorerie.

Une facture de mandat regroupe quatre sortes de lignes :

| Sorte | Source dans l'OS |
|---|---|
| Récurrent | Recettes prévues de type `abonnement` du mandat |
| Commission | Recettes prévues de type `commission` ou `autre`, saisies à la main |
| Frais | Recettes prévues de type `refacturation` du mandat |
| IK | Trajets IK cochés « refacturer », au montant du barème IK |

## 2. Décisions prises avec Marc

- Les frais se calculent **depuis les dépenses** : Gestion crée déjà, pour toute dépense marquée
  refacturable, une recette de refacturation par mandat (type `refacturation`, liée à la dépense par
  `depense_id`, même cadence). Cette mécanique est conservée : aucune nouvelle colonne sur les
  dépenses. Un rattrapage de frais déjà payés se saisit comme une recette `refacturation` du mandat.
- Arrivée d'argent : **date d'émission prévue du mandat + délai de paiement du mandat**.
- IK : une **case « refacturer » par trajet**. Un trajet reste dans les IK et alimente le compte
  d'associé ; refacturé, il entre en plus dans la facture du mandat, au montant du barème.
- Marc ne facture que le **hors taxes** et émet souvent une facture groupée qui rattrape plusieurs
  mois de frais.
- Livraison en deux temps (section 8).

## 3. Modèle de données

### 3.1 Trajets IK refacturables
Colonne booléenne `refacturer` (défaut `false`) sur `gestion_ik_trajets`, qui exige un mandat sur le
trajet. Montant d'une ligne IK = `indemniteCents` calculé par `etatIkMois` (barème progressif). Sans
barème validé le montant est inconnu : la ligne est signalée et exclue du total. Livraison 2 ajoute
`facture_id` (nullable) pour marquer un trajet comme facturé.

### 3.2 Réglages par mandat
Table `gestion_mandat_reglages` : `instance_id`, `mandat` (slug), `delai_paiement_jours` (nullable,
repli sur le délai général de Gestion). Unique `(instance_id, mandat)`, isolation par instance. La
cadence est fixée à « fin de mois » pour l'instant ; elle n'est pas stockée.

### 3.3 Factures émises (livraison 2)
Table `gestion_factures` : `id`, `mandat`, `numero`, `date_emission`, `total_ht_cents`, `etat`
(`emise` | `encaissee`), `date_encaissement`, `lignes` (jsonb, photographie figée).

## 4. Calcul d'une facture à émettre

Pour un mandat, la date d'émission prévue `E` est le dernier jour du mois en cours. Les lignes sont :

- Les échéances de recettes du mandat (`occurrencesRevenus`) à l'état `prevue`, de certitude autre
  que `hypothese`, de date ≤ `E`, rangées en Récurrent, Commission ou Frais selon leur type.
- Les trajets IK `refacturer = true` du mandat, de date ≤ `E`, non encore facturés.

« Déjà facturé » se lit dans l'état de la recette (`emise` ou `encaissee`) ou dans `facture_id` du
trajet ; rien n'est facturé deux fois. Les recettes sans mandat sont listées à part, avec un
avertissement. Total hors taxes = somme des lignes avec montant.

## 5. Écran

Onglet **Factures** dans Gestion : une carte par mandat avec le total hors taxes, la date d'émission
prévue, la date d'encaissement attendue (émission + délai du mandat), le détail des lignes par sorte
et les avertissements (« montant IK inconnu », « TVA à renseigner » quand une ligne a une TVA
inconnue, « recette sans mandat »). Un champ permet de régler le délai de paiement du mandat. La case
« refacturer » apparaît sur chaque trajet IK qui a un mandat. L'ancienne liste de 30 jours de
l'onglet Mouvements renvoie vers ce nouvel onglet.

## 6. Émission (livraison 2)

Dans une transaction : créer la facture (photographie), passer les échéances de recettes à `emise`
avec le numéro en `reference_facture`, renseigner `facture_id` sur les trajets. L'encaissement se
marque sur la facture et fait passer ses échéances à `encaissee`. Une facture émise ne change plus.

## 7. Plan de trésorerie (livraison 2)

Les recettes entrent déjà dans la projection à leur date + le délai général. Livraison 2 : pour un
mandat, une recette prévue entre à la date d'émission de cadence qui la suit (fin de mois) + le délai
du mandat, et les trajets IK refacturés entrent de la même façon, comme une entrée estimée. Aucun
double compte : une recette ou un trajet n'est compté que dans sa facture. Certitudes inchangées pour
les recettes ; les trajets IK sont comptés comme certains.

## 8. Livraisons

1. **Calcul et écran** : colonne `refacturer` et case sur les trajets, réglage du délai par mandat,
   calcul des factures à émettre, onglet Factures en lecture seule.
2. **Émission et trésorerie** : tables de factures, bouton Émettre, encaissement, intégration à la
   projection.

Chaque livraison suit la règle du dépôt : tests avec le code, `npm run verify`, relecture
indépendante, CI verte, validation de Marc avant fusion.

## 9. Cas limites

- Mandat sans réglages : délai général de Gestion ; sans aucun délai, l'encaissement n'est pas daté et un avertissement le dit.
- Barème IK absent : ligne signalée, hors total.
- Recette sans mandat : jamais comptée dans une facture, toujours signalée.
- Annulation d'une facture émise : hors périmètre ; une correction passe par un avoir saisi à la
  main.

## 10. Hors périmètre

Document de facture (PDF), envoi par mail, avoirs, TVA collectée détaillée, cadences autres que fin
de mois, devises.
