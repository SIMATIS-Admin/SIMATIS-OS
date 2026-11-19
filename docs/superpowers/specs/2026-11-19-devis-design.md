# Section Devis : conception

Maquette de référence : `maquettes/devis.html` (données fictives).

## Intention

Marc veut produire, depuis l'OS, des devis au bon format : périmètre de mission, prix, conditions de vente. Un devis est toujours rattaché à une affaire du pipeline ; la création doit donc être la plus courte possible depuis cette affaire. Le prix reste fixé par Marc : l'OS prépare, ne chiffre jamais.

## Objectifs

- Créer un devis en moins d'une minute depuis une affaire (client, interlocuteur, intitulé, montant et facturation déjà repris de l'affaire).
- Un document PDF propre : en-tête SIMATIS, contexte, périmètre (inclus / exclu), livrables, calendrier, prix, conditions de vente, bloc de signature.
- Un suivi du devis qui fait avancer le pipeline (envoyé, accepté, refusé).

## Hors périmètre

- Signature électronique en ligne, facturation, génération Word, plusieurs taux de TVA, devis hors pipeline.

## Anti-objectifs

- L'OS ne propose jamais de prix ni de remise.
- Aucun envoi sans validation de Marc (brouillon Gmail, jamais d'envoi automatique).
- Aucune clause, aucun tarif ni modèle réel dans le dépôt public : tout cela vit en base, dans les Paramètres du devis.

## Contraintes

- Dépôt public : fixtures et tests uniquement fictifs.
- Module `devis` propre à l'instance « Mon activité » (comportement actuel conservé).
- Un devis validé est verrouillé ; toute modification passe par une nouvelle version.
- Existant à réutiliser : table `devis` (numéro, statut, lignes, validité), propositions de transmission avec validation, `opportunites` (montant, mode de facturation spot ou récurrent, durée d'engagement).

## Approches étudiées (production du document)

1. Word seul : réutilise l'existant, éditable, mais rendu moins propre pour un document signé.
2. **PDF généré depuis la page d'aperçu (retenu par Marc)** : une seule mise en page, rendu identique à l'écran, document figé. Coût : ajouter un moteur de PDF au conteneur.
3. Word et PDF : le plus complet, le plus long.

## Création : le point d'attention de Marc

Quatre entrées, toutes aboutissant à la même ouverture d'éditeur, déjà pré-rempli :

1. **Depuis la fiche de l'affaire** : bouton « Préparer un devis » (entrée principale).
2. **Depuis la carte de l'affaire dans le pipeline** : action rapide sur la carte.
3. **Au passage en étape « Proposition »** : l'OS propose « Préparer le devis maintenant ? » (un clic pour accepter, ignorable).
4. **Depuis la liste des devis** : « + Nouveau devis » demande d'abord de choisir l'affaire (recherche, affaires ouvertes en tête). Pas de devis sans affaire.

Pré-remplissage : entreprise et interlocuteur de l'affaire ; intitulé = titre de l'affaire ; modèle de mission suggéré d'après l'affaire (modifiable) ; lignes de prix : montant de l'affaire repris comme **proposition à confirmer** (jamais figé), en mensuel × durée pour une affaire récurrente. Une affaire qui a déjà un devis propose « Ouvrir le devis » ou « Nouvelle version ».

## Modèle

- Devis (existant, étendu) : affaire, numéro, version, statut (brouillon, validé, envoyé, accepté, refusé), contexte, objectifs, inclus, exclu, livrables, début, durée, lignes (libellé, unité, quantité, prix), remise, acompte, frais, validité, clauses retenues (texte figé à la validation), date d'envoi.
- Paramètres du devis : modèles de mission, clauses de conditions de vente, format de numérotation, mentions légales de l'émetteur.

## Livraisons

- **A** : modèle de données, éditeur en 4 étapes avec aperçu, création depuis l'affaire (entrées 1 et 4), verrouillage et versions. Sans PDF : l'aperçu seul.
- **B** : Paramètres du devis (modèles, clauses, numérotation, mentions) et PDF. Entrées 2 et 3.
- **C** : brouillon Gmail avec PDF joint, relance à J+10, passage accepté ou refusé qui met à jour l'affaire (gagnée ou perdue).

## À la charge du constructeur

Technologie de PDF (compatible avec l'image Docker actuelle), détails d'écran, nommage des champs, migration des devis existants (lignes seules) vers le nouveau modèle.

## Décisions prises par l'agent (à relire)

- Numérotation par défaut `DEV-AAAA-NNN`, format réglable dans les Paramètres.
- Remise en pourcentage unique, TVA unique à 20 % réglable.
- Validité par défaut 30 jours, acompte par défaut 0 %.
- Les devis existants sont convertis en brouillons ou validés selon leur statut actuel, sans perte.
