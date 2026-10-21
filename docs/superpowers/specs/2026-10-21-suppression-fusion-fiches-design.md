# Suppression et fusion de fiches (contacts, organisations, affaires)

## Besoin

Pouvoir supprimer et fusionner des contacts, des organisations et des affaires, une par une
ou en masse depuis les listes, avec répercussion dans HubSpot. Cas déclencheur : un doublon
d'organisation à nettoyer.

## Décisions

- Fusion **simple** : l'utilisateur désigne la fiche à garder. Pas de comparaison champ par champ.
- Fusion possible uniquement entre fiches **du même type**.
- Même règle que les autres écritures : **en simulation, rien n'est modifié en local** (message
  « Simulation ») ; en mode réel, écriture HubSpot puis écriture locale. Double verrou inchangé
  (variable serveur + interrupteur admin).
- Suppression HubSpot = **archivage** (récupérable côté HubSpot). Fusion HubSpot = définitive,
  la confirmation le dit.

## Suppression

- Depuis une fiche : bouton « Supprimer » avec confirmation.
- Depuis une liste : cases à cocher, « Supprimer la sélection », confirmation avec le nombre.
- Mode réel, fiche issue de HubSpot : archivage HubSpot, puis suppression locale avec ses liens
  (tables de liaison) ; tâches, activités et autres objets liés sont détachés, pas supprimés ;
  une affaire avec devis ne se supprime pas.
- Fiche locale uniquement (sans équivalent HubSpot) : suppression locale seule.
- Traitement en masse fiche par fiche ; une erreur n'annule pas les autres ; récapitulatif
  (réussies, échouées, raison). Trace au journal.

## Fusion

- Liste : cocher 2 fiches, « Fusionner », choisir la fiche à garder, aperçu de ce qui est déplacé.
- Local : liens (principal conservé côté gardée), tâches, activités, rendez-vous de la fiche
  absorbée passent sur la gardée ; liens en double dédoublonnés ; champs de l'absorbée
  n'écrasent jamais, ils ne remplissent que les vides ; l'absorbée est supprimée.
- HubSpot : fonction de fusion native (`/crm/v3/objects/{type}/merge`) quand les deux fiches
  existent dans HubSpot. Garder une fiche locale en absorbant une fiche HubSpot est refusé (elle reviendrait à la
  synchronisation). Si aucune n'est dans HubSpot, fusion locale seule.
- Les doublons purement HubSpot-side sont résolus par la synchronisation suivante.

## Architecture

- `src/crm/suppression.ts` : suppression d'une fiche (service, une transaction).
- `src/crm/fusion.ts` : fusion de deux fiches du même type.
- `src/connecteurs/hubspot/write.ts` : nouvelles opérations `record.archive` et `record.merge`.
- `src/api/routes.ts` : `DELETE` sur les fiches, `POST` pour la suppression en masse et la fusion.
- Web : sélection en liste (Contacts, Entreprises, et une vue liste des affaires à créer dans le pipeline), boîtes de confirmation,
  boutons sur la fiche.

## Tests

Service (suppression, fusion, transfert des liens, simulation, fiche locale), routes, interface
(sélection, confirmation, récapitulatif). Aucun test n'écrit dans le vrai HubSpot.
