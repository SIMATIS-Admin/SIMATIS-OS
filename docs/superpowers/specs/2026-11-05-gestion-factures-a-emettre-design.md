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
| Récurrent | Recettes prévues de type abonnement du mandat |
| Commission | Recettes ponctuelles prévues, saisies à la main |
| Frais | Dépenses refacturables, selon une répartition par mandat |
| IK | Trajets IK cochés « refacturer », au montant du barème IK |

## 2. Décisions déjà prises avec Marc

- Les frais se calculent **automatiquement depuis les dépenses** : sur chaque dépense refacturable,
  Marc indique à quels mandats elle est refacturée et pour quelle part.
- La date d'arrivée d'argent est : **date d'émission prévue du mandat + délai de paiement du mandat**.
- Pour les IK, une **case « refacturer » par trajet**. Un trajet reste dans les IK et alimente le
  compte d'associé ; refacturé, il entre en plus dans la facture du mandat, au montant du barème.
- Marc ne facture que le **hors taxes**. Il émet souvent une facture groupée qui rattrape plusieurs
  mois de frais.
- Livraison en deux temps (section 9).

## 3. Modèle de données

### 3.1 Répartition de la refacturation d'une dépense
Nouvelle colonne `refacturations` (jsonb, défaut `[]`) sur `gestion_depenses` : liste de
`{ mandat, mode: 'pourcentage' | 'montant', valeur }`. Pour `pourcentage`, `valeur` va de 1 à 100 et
la somme des pourcentages d'une dépense ne dépasse pas 100. Pour `montant`, `valeur` est un montant
en centimes hors taxes, par échéance. Elle est distincte de `affectations`, qui répartit le **coût**
(Simatis, Kairos, mandat), alors que la refacturation répartit ce qui est **revendu**.
`refacturable` reste l'intention déjà présente ; une dépense refacturable sans répartition est
signalée, jamais comptée.

### 3.2 Trajets IK refacturables
Nouvelle colonne booléenne `refacturer` (défaut `false`) sur `gestion_ik_trajets`. Elle exige que le
trajet porte un mandat ; sinon la saisie est refusée. Montant d'une ligne IK = `indemniteCents` du
trajet tel que `etatIkMois` le calcule (barème progressif). Sans barème validé, le montant est
inconnu : la ligne est signalée et exclue du total, jamais inventée.

### 3.3 Réglages par mandat
Nouvelle table `gestion_mandat_reglages` : `instance_id`, `mandat` (slug), `cadence` (`fin_de_mois`
pour l'instant, extensible), `delai_paiement_jours` (nullable : repli sur le délai général de
Gestion). Unique `(instance_id, mandat)`. Table soumise à l'isolation par instance comme les autres.

### 3.4 Factures émises
Nouvelle table `gestion_factures` : `id`, `mandat`, `numero`, `date_emission`, `total_ht_cents`,
`etat` (`emise` | `encaissee`), `date_encaissement`, `lignes` (jsonb, photographie figée).
Nouvelle table `gestion_facture_lignes` : `facture_id`, `type` (`recurrent` | `commission` | `frais` |
`ik`), `cle_source` (voir 4), `montant_ht_cents`, unique `(instance_id, mandat, cle_source)` : une
source ne peut être facturée qu'une seule fois à un mandat.

## 4. Calcul d'une facture à émettre

Pour un mandat et une date d'émission `E` (défaut : la prochaine date de cadence), les lignes sont
les **sources non encore facturées** à ce mandat, de date ≤ `E` :

- **Récurrent / commission** : échéances de recettes prévues du mandat (`occurrencesRevenus`), de
  clé `revenu:<id>|<date>`. Hypothèses exclues.
- **Frais** : échéances de dépenses `payee` (réelles) refacturables au mandat, de clé
  `depense:<id>|<date>`. Montant = part du mandat sur le HT de l'échéance (TTC − TVA ; si la TVA
  n'est pas renseignée, le TTC est repris et la ligne est signalée « TVA à renseigner »).
- **IK** : trajets `refacturer = true` du mandat, de clé `ik:<trajetId>`.

« Non encore facturé » se lit dans `gestion_facture_lignes`, jamais d'une date de coupure : un
rattrapage sur plusieurs mois est donc naturel (la facture de fin de mois reprend tout ce qui
n'a jamais été facturé), et rien n'est facturé deux fois.

Total hors taxes = somme des lignes avec montant. Marc peut décocher ou corriger une ligne avant
d'émettre ; la correction n'est conservée que dans la facture émise.

## 5. Écran

Nouvel onglet **Factures** dans Gestion. Une carte par mandat : total hors taxes, date d'émission
prévue, date d'encaissement attendue, puis le détail des lignes groupé par sorte, avec les
avertissements (« montant IK inconnu », « TVA à renseigner », « répartition manquante »). Bouton
**Émettre** : numéro et date de la facture, confirmation du total. Liste des factures déjà émises du
mandat avec leur état. L'ancienne liste « Factures à émettre (30 jours) » de l'onglet Mouvements est
remplacée par un lien vers ce nouvel onglet.

## 6. Émission

Dans une seule transaction : créer la facture et ses lignes, passer les échéances de recettes
concernées à `emise` avec le numéro en `reference_facture`, enregistrer les clés dans
`gestion_facture_lignes`. Une facture émise ne change plus. L'encaissement se marque ensuite sur la
facture : les échéances de recettes liées passent à `encaissee`.

## 7. Plan de trésorerie

Pour chaque mandat, les sources non facturées de l'horizon forment des **factures prévues** :
chaque source est rangée dans la première date d'émission de cadence ≥ sa date ; l'argent arrive à
cette date + le délai du mandat. Une entrée par mandat et par date d'émission, marquée estimée.
Les échéances de recettes prises dans une facture prévue ne sont plus comptées isolément (pas de
double compte). Certitudes :

- frais payés, IK et récurrent certain : comptés dans tous les scénarios ;
- frais prévus à venir : scénarios central et ambitieux ;
- commission : selon sa certitude actuelle (certaine, probable, hypothèse).

Les factures émises et non encaissées entrent à leur date d'émission + délai, comme aujourd'hui.

## 8. Cas limites et erreurs

- Mandat sans réglages : délai général de Gestion, sinon 0 jour avec un avertissement.
- Dépense refacturable sans répartition, ou avec des pourcentages > 100 : refusée à la saisie.
- Barème IK absent : ligne signalée, hors total.
- Source déjà facturée à ce mandat : ignorée (clé unique), jamais d'erreur 500.
- Annulation d'une facture émise : hors périmètre ; une correction passe par un avoir à saisir à
  la main.

## 9. Livraisons

1. **Calcul et écran** : colonnes `refacturations` et `refacturer`, réglages de mandat, calcul des
   factures à émettre, onglet Factures en lecture seule, case « refacturer » sur les trajets,
   répartition sur les dépenses.
2. **Émission et trésorerie** : tables de factures, bouton Émettre, encaissement, intégration à la
   projection de trésorerie.

Chaque livraison suit la règle du dépôt : tests écrits avec le code, `npm run verify`, relecture
indépendante, CI verte, validation de Marc avant fusion.

## 10. Hors périmètre

Génération du document de facture (PDF), envoi par mail, avoirs, TVA collectée détaillée, cadences
autres que fin de mois, factures en devise.
