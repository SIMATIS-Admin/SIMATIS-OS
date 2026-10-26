# Recherche dans les mandats — spec (livraison 2a)

Suite de `2026-10-26-transfert-instance-design.md`. La livraison 2 « vue transversale » est découpée en deux : **2a** la recherche dans les mandats (ce document), **2b** un filtre « Tous les mandats » dans les listes (Contacts, Entreprises, Pipeline, Tâches, RDV), qui aura sa propre spec.

## But

Depuis l'instance SIMATIS, Marc retrouve un contact, une entreprise ou une affaire d'un mandat, en lecture seule, et peut le copier ou le déplacer vers une autre instance avec la pastille d'instance existante. Cas d'usage : réutiliser le contact d'un mandat dans un autre.

## Règles

1. **Qui** : le super-administrateur, dans l'instance SIMATIS (`peutTransferer(UTILISATEUR_PILOTE, instance)`, déjà en place). Sinon 403 côté serveur et rien d'affiché côté interface.
2. **Quoi** : affaires, personnes et organisations, comme la recherche de la barre du haut. Pas de tâches ni de rendez-vous dans cette livraison.
3. **Où** : les mandats actifs (en cours et en closing). Les démonstrations et les instances archivées sont exclues.
4. **Lecture seule** : rien ne s'écrit par la recherche. Ouvrir un résultat mène à la fiche dans le mandat, où il n'y a pas de pastille.
5. **Par défaut, rien ne change** : la recherche porte sur l'instance courante ; les mandats ne sont interrogés que si Marc coche « Inclure les mandats ».

## Conception

### Serveur

- `GET /api/i/:slug/recherche?q=…&portee=mandats` (la route existante, un paramètre de plus).
  - `portee=mandats` sans le droit → **403** `Recherche dans les mandats réservée à l'instance SIMATIS.` Valeur inconnue de `portee` → 400.
  - Réponse : `{ mandats: [{ instance: { slug, nom, couleur }, affaires, personnes, organisations }], echecs: string[] }`. Seuls les mandats ayant au moins un résultat figurent dans la liste ; 5 résultats au plus par type et par mandat, comme la recherche de l'instance courante. Même seuil de 2 caractères.
  - Les mandats sont lus **un par un** (une lecture ouvre trois transactions : tous à la fois épuiseraient le pool de connexions). Un mandat qui échoue est omis, journalisé côté serveur, et son nom est renvoyé dans `echecs`.
  - Chaque mandat est lu **dans sa propre transaction isolée** (`withInstance`, rôle restreint de l'application), comme l'Inbox agrégée (`perimetre`). Aucune connexion propriétaire, aucune Row-Level Security contournée.
- La recherche d'une instance (`rechercherOpportunites`, `searchContacts`, `searchEntreprises`) est extraite de la route dans une fonction `rechercherDans(db, instance, q)` (`src/crm/recherche.ts`) utilisée par les deux modes : la route existante garde le même résultat.

### Interface (barre du haut, `web/src/shell/Barre.tsx`)

- Dans SIMATIS avec le droit : une case « Inclure les mandats » dans la liste de résultats, décochée à chaque nouvelle session.
- Cochée : les résultats des mandats s'ajoutent sous ceux de SIMATIS, groupés par mandat (titre = nom du mandat) ; chaque ligne porte la pastille de l'instance, **cliquable** pour copier ou déplacer (flux existant : choix de l'instance cible, aperçu, confirmation, avec `instanceOrigine` = le mandat).
- Cliquer le nom d'un résultat ouvre `#/<slug du mandat>/fiche/<type>/<id>`.
- La liste de résultats reste ouverte pendant la fenêtre de transfert ; après un transfert réussi, la recherche est relancée (l'objet apparaît ou disparaît des résultats).
- Un mandat qui n'a pas pu être lu est signalé par son nom (« Mandats non lus : … »), jamais par son message d'erreur ; la recherche de SIMATIS qui échoue laisse la liste et la case ouvertes.
- Les pastilles reçoivent le droit de la barre et n'envoient aucune requête chacune.

### Documentation

`docs/plan.md` (« Aucune ne lit les données d'une autre, SIMATIS compris ») est mis à jour : exception pour la lecture seule de SIMATIS vers ses mandats actifs, pour le super-administrateur (l'Inbox agrégée en est déjà une).

## Tests

- **Isolation** : un mandat sans résultat n'apparaît pas ; une démo et un mandat archivé ne sont jamais interrogés ; un mandat ne voit jamais les données d'un autre ; la lecture passe par le rôle restreint.
- **Droit** : 403 depuis un mandat et depuis une démonstration ; la recherche ordinaire (sans `portee`) est inchangée.
- **Contenu** : résultats groupés par mandat avec nom et couleur ; limites de 5 ; seuil de 2 caractères.
- **Interface** : case absente sans le droit ; cochée, les résultats des mandats s'affichent avec leur pastille ; un clic mène à la fiche du mandat ; la pastille ouvre le flux de transfert avec le bon `instanceOrigine` ; la liste ne se ferme pas pendant la fenêtre.
- Données de test uniquement fictives.

## Hors périmètre

Filtre « Tous les mandats » dans les listes (2b) ; tâches et rendez-vous dans la recherche ; recherche dans les démonstrations ; tout accès en écriture.
