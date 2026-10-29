# Idées en vrac et feuille de route de l'OS — conception

Date : 2026-10-29. Statut : à relire par Marc avant le plan d'implémentation.

## But

1. Une catégorie « Idées en vrac » dans le second cerveau, où Marc dépose ses idées sans les trier. L'Inbox les repère ensuite pour en faire quelque chose de concret.
2. Une section « Feuille de route de l'OS », réservée à l'instance « Mon activité », qui résume la structure de l'OS et ses prochaines étapes de développement.
3. Un second cerveau qui connaît l'OS : sa structure détaillée et sa feuille de route y sont écrites, tenues à jour, et retrouvables par Claude.

## État actuel (relevé du 29/10)

- Le second cerveau n'a qu'une fiche `brain/outils/simatis-os-etat.md`, arrêtée à la PR 97 (le dépôt en est à la PR 176), et deux documents de projet rangés dans `brain/inbox/`. Il ne connaît ni les modules, ni les écrans, ni les connecteurs, ni les routines, ni les prochaines étapes.
- L'ajout d'une idée depuis l'OS (`ajouterIdee`, [fichiers.ts](../../../src/cerveau/fichiers.ts)) écrit dans `brain/inbox/` en brouillon, avec index et journal.
- La carte déduit la catégorie du dossier `brain/<domaine>/` ([carte.ts](../../../src/cerveau/carte.ts)) ; libellé et couleur viennent de `CATEGORIES` ([cerveau.ts](../../../web/src/cerveau.ts)).
- L'OS lit et écrit le Drive par l'exécuteur du poste (opérations `lire`, `ecrire` avec empreinte, `ajouter`). Le Drive est la référence (décision du 29/10).

## Contraintes

- Dépôt public : rien de réel dans le code, les tests ni le spec. Les notes de structure et de feuille de route vivent dans le Drive (privé) mais ne citent quand même aucun client réel.
- Le Drive reste la seule source : aucune copie de la feuille de route dans la base ni dans le dépôt.
- Écritures dans le Drive uniquement par les opérations existantes (détection de conflit, journal `log.md`).

## Conception

### 1. Catégorie « Idées en vrac »

- Dossier `brain/idees-en-vrac/` avec son `index.md`. La carte le reconnaît seule ; ajout de l'entrée `idees-en-vrac` dans `CATEGORIES` (libellé « Idées en vrac », couleur distincte).
- `ajouterIdee` écrit désormais dans ce dossier (nom `AAAA-MM-JJ_titre.md`, en-tête `date`, `source`, `statut: draft`, index et journal comme aujourd'hui). Le dossier et son index sont créés au premier ajout s'ils n'existent pas.
- Le formulaire d'ajout reçoit une case « Concerne le développement de l'OS ». Cochée, l'en-tête porte `concerne: os`. Le paramètre `concerne` est optionnel dans l'opération `ajouter` (valeurs : `os`, absent).
- Les idées déjà présentes dans `brain/inbox/` ne bougent pas : pas de migration automatique.
- **Repérage par l'Inbox** : le skill `alimenter-inbox` (dossier `skills/` du Drive, hors dépôt) est complété pour lister les idées `draft` de `brain/idees-en-vrac/` comme sujets à transformer en action. Modification faite avec l'accord de Marc, consignée dans `log.md`.

### 2. Section « Feuille de route de l'OS »

- Entrée de navigation spéciale, hors des groupes du menu : un bouton fixe tout en bas de la barre latérale ([Sidebar.tsx](../../../web/src/shell/Sidebar.tsx)), visible seulement si l'instance courante est de type `propre`. Identifiant d'écran `feuille-de-route-os` (`feuille-de-route` est pris par l'Atelier).
- **Garde côté serveur** : la page passe par les opérations existantes du second cerveau (`cerveau/operations`). Toute opération `lire` ou `ecrire` visant `simatis-os-structure.md` ou `simatis-os-feuille-de-route.md` répond 403 hors de l'instance `propre`, pas seulement l'interface qui masque le bouton.
- La page lit deux notes du Drive par l'opération `lire` :
  - `brain/outils/simatis-os-structure.md` : modules, écrans, connecteurs, routines, ce qui est livré, par grands blocs ;
  - `brain/outils/simatis-os-feuille-de-route.md` : étapes à venir, chacune avec un statut (`à faire`, `en cours`, `fait`) et, si elle vient d'une idée, le lien vers celle-ci.
- Modification dans l'OS par l'opération `ecrire` (empreinte, refus en cas de conflit), comme l'édition de notes existante ([NoteCerveau.tsx](../../../web/src/pages/NoteCerveau.tsx)).
- Sous la feuille de route : la liste des idées `concerne: os` en brouillon. Le bouton « Promouvoir en étape » ajoute une ligne à la feuille de route (statut `à faire`, lien vers l'idée) et passe l'idée à `statut: promue`, via deux `ecrire`. Si le second échoue, l'étape existe sans l'idée marquée : on le signale à l'écran, sans rien annuler.
- Si l'exécuteur du poste n'est pas joignable, la page affiche le même message d'erreur que la page Second cerveau.

### 3. Un second cerveau qui connaît l'OS

- Rédaction initiale des deux notes depuis le dépôt (`docs/`, `src/`, `web/src/pages`, PR mergées), statut `draft` jusqu'à validation de Marc. Mise à jour de `simatis-os-etat.md` (date, PR 176) et renvoi vers les deux nouvelles notes ; liens ajoutés dans `brain/outils/index.md` et le journal.
- Contenu de la structure : pour chaque bloc, son rôle, son module d'activation, où il vit dans le dépôt, et ce qui le relie aux autres. Les prochaines étapes de départ viennent de `docs/plan.md`, des « restes à faire » connus et des idées `concerne: os` existantes.
- Maintenance : une ligne ajoutée à la section « Gestion de git » de `AGENTS.md` : à chaque fin de feature, mettre à jour la structure et la feuille de route du second cerveau.

## Hors périmètre

- Déplacement des documents de projet hors de `brain/inbox/` (signalé seulement).
- Génération automatique de la structure depuis le code.
- Toute écriture autre que celles listées ci-dessus.

## Tests

- Carte : `idees-en-vrac` devient une catégorie propre ([carte.test.ts](../../../src/cerveau/carte.test.ts)) ; libellé et couleur définis.
- `ajouterIdee` : chemin `brain/idees-en-vrac/`, création du dossier et de l'index, `concerne: os` présent ou absent, nom en cas de doublon, journal.
- Opération `ajouter` : le schéma accepte `concerne` et refuse toute autre valeur.
- Garde : `lire` et `ecrire` sur les deux notes répondent 403 pour une instance `mandat` ou `prospect`.
- Barre latérale : bouton présent pour `propre`, absent pour les autres ([Sidebar.test.tsx](../../../web/src/shell/Sidebar.test.tsx)).
- Page : lecture des deux notes, édition, conflit d'empreinte, liste des idées `concerne: os`, promotion (deux écritures, cas d'échec de la seconde).
- Données fictives uniquement.
