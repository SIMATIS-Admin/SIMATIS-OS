# Inbox : répondre à un message de l'espace partagé

## Besoin

La routine Inbox dépose une entrée pour chaque message de Christophe lu dans l'espace partagé
(clé `partage:<chemin du message>`). Marc veut y répondre sans quitter l'Inbox, en plus de
« Transformer en tâche » et « Marquer comme traité ». Une fois la réponse déposée, l'entrée
quitte la liste « À traiter ».

Hors périmètre : répondre à un mail (Gmail) ; modifier la routine ; envoyer autre chose qu'un
message de l'espace partagé.

## Comportement

- Une entrée à traiter dont la clé commence par `partage:` affiche un bouton **Répondre**.
- Le bouton ouvre, dans l'entrée, le formulaire `MessagePartage` déjà utilisé dans la page Second
  cerveau : genre « réponse », en réponse au chemin du message, sujet prérempli « Re : <objet> »,
  corps libre, confirmation avant dépôt (le message est lu par Christophe et ne se modifie plus).
- Au succès, l'entrée passe en « traité » (traité par le pilote) et sort de « À traiter ». Elle
  reste en base et dans « Traités » (avec « Remettre à traiter ») : sa clé doit rester connue, sinon
  la routine la redéposerait.
- À l'échec (exécuteur injoignable, refus de l'espace partagé), rien n'est déposé, l'entrée reste à
  traiter et l'erreur s'affiche dans le formulaire.
- Pas de mode simulation : le dépôt est un acte explicite et confirmé, comme dans la page Second
  cerveau.

## Conception

- **Vue** : `SujetVue` gagne `partage: { chemin: string } | null`, rempli quand `source` est
  `routine` et `sourceId` commence par `partage:`. Le front n'a pas besoin de la clé brute.
- **Service** `repondreMessagePartage(db, instance, id, { sujet, corps })` dans
  `src/inbox/service.ts` : charge l'entrée, refuse si elle n'est pas à traiter ou n'a pas de
  `partage`, demande l'opération `message` (genre `reponse`, `enReponseA` = chemin) à l'exécuteur
  via `demander` (`src/cerveau/file.ts`), puis, si le dépôt a réussi, marque traité et journalise
  (« Réponse déposée à Christophe : <titre> ») dans la même transaction que l'écriture du statut.
- **Route** `POST /api/i/:slug/sujets/:id/repondre`, corps `{ sujet, corps }` validé (mêmes bornes
  que la route des opérations du cerveau). Mêmes garde-fous d'accès que le second cerveau :
  instance propre avec le module `cerveau`, jamais une démo. Erreurs : 404 entrée inconnue, 409
  entrée déjà traitée ou sans message source, 502 exécuteur injoignable ou refus.
- **Front** (`web/src/pages/Inbox.tsx`) : bouton, ouverture du formulaire, rechargement de la
  liste au succès. `MessagePartage` reçoit un sujet initial facultatif et une action de dépôt
  injectable ; son comportement dans la page Second cerveau ne change pas.

## Tests

- Service : succès (message demandé avec le bon chemin, entrée traitée, journal écrit) ; échec du
  dépôt (entrée inchangée) ; entrée déjà traitée ; entrée sans clé `partage:`.
- Route : validation du corps, accès refusé pour une démo, codes d'erreur.
- Interface : le bouton n'apparaît que sur une entrée de l'espace partagé ; le formulaire est
  prérempli ; l'entrée disparaît de la liste après dépôt ; l'erreur s'affiche et l'entrée reste.
- Vérification dans le navigateur avec des données fictives (exécuteur simulé).
