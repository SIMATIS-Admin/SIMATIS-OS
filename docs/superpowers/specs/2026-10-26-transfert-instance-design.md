# Transfert d'objets entre instances — spec

## But

Depuis l'instance SIMATIS (instance « propre »), Marc choisit pour chaque objet l'instance à laquelle il appartient. Dans une instance de mandat, l'objet est retrouvé mais son appartenance est en lecture seule : seule l'instance SIMATIS peut la modifier.

Exemples : une entrée Inbox, une tâche, une affaire, un contact.

## Règles décidées

1. **Objet natif** (`source = 'natif'`, créé dans l'OS) : il est **déplacé**, avec ses objets liés.
2. **Objet miroir d'un outil tiers** (`source` ≠ `natif`, ex. HubSpot, Google) : il est **copié**. L'original reste dans son instance et continue d'être synchronisé. La copie est **détachée** de l'outil (`source = 'natif'`, `source_id` vide) : c'est un objet propre de l'OS.
3. **Les objets liés suivent** (déplacés ou copiés selon la règle 1 ou 2 pour chacun), après un **aperçu** que Marc valide.
4. **Historique de la copie** : chaque objet copié reçoit une activité « Créé depuis l'instance *X* » (nom de l'instance d'origine, type et titre de l'objet d'origine). Chaque objet déplacé reçoit « Déplacé depuis l'instance *X* ».
5. **Droits** : seul un appel fait depuis l'instance de type `propre` peut transférer. L'instance d'origine ou la cible peut être un mandat ; la cible ne peut pas être archivée.

## Périmètre de la première version

Objets : entrée Inbox (`sujets`), tâche, affaire (`opportunites`), contact, entreprise, rendez-vous (`rendez_vous`), activité.

Hors périmètre : connexions, routines, propositions, autonomie (réglages d'instance) ; devis (brique propre à SIMATIS) ; base vivante (module à part) ; conversations d'ajout (`echanges_ajout`, éphémères).

## Sous-graphe qui suit

Le sous-graphe est calculé à partir de l'objet choisi ; un lien ne peut jamais pointer vers l'autre instance, donc tout le sous-graphe change d'instance ensemble.

| Objet choisi | Suivent obligatoirement | Proposés (décochables) |
| --- | --- | --- |
| Affaire | tâches, activités, rendez-vous liés, entrées Inbox liées, liens vers ses contacts et entreprises | contacts et entreprises liés |
| Contact | tâches, activités, rendez-vous liés, entrées Inbox liées | son entreprise |
| Entreprise | tâches, activités, entrées Inbox liées | ses contacts et affaires |
| Tâche | ses activités | affaire, contact, entreprise visés |
| Entrée Inbox | — | contact, entreprise, tâche visés |
| Rendez-vous | liens vers contacts, entreprises, affaires | ces contacts, entreprises, affaires |
| Activité | — | l'objet auquel elle est rattachée |

Si Marc décoche un objet « proposé » qui est référencé par un objet qui bouge, le lien est **retiré** sur l'objet transféré (colonne mise à `null`, ligne de liaison non reprise). Il n'y a jamais de lien entre instances.

Les tables de liaison (`affaire_contacts`, `affaire_entreprises`, `contact_entreprises`, `rdv_*`) sont recréées dans la cible entre objets présents ; les liens principaux (`assurerLiensPrincipaux`) sont recalculés.

## Conception technique

### Moteur : `src/transfert/`

- `plan.ts` : `planifierTransfert(db, source, ref, cible, exclusions)` calcule le sous-graphe et renvoie un **aperçu** (liste d'éléments par type, chacun marqué `deplace` ou `copie`, plus les liens qui seraient retirés). Ne modifie rien.
- `executer.ts` : `executerTransfert(db, source, ref, cible, exclusions)` rejoue le calcul puis applique, **dans une seule transaction**, avec un verrou consultatif (`pg_advisory_xact_lock`) sur la racine pour éviter deux transferts simultanés du même objet.
- Un **registre** par type d'objet décrit : table, colonnes de lien vers d'autres types, tables de liaison, et colonnes à reprendre. Ajouter un type, c'est ajouter une entrée ; le moteur ne change pas.
- Déplacer = `UPDATE … SET instance_id = cible` sur le sous-graphe (identifiants conservés, donc liens intacts). Copier = nouvelles lignes avec de nouveaux identifiants, liens réécrits via une table de correspondance ancien → nouvel identifiant.
- Le moteur utilise la connexion propriétaire (la Row-Level Security l'empêche de lire ou écrire deux instances à la fois) ; chaque requête filtre explicitement l'instance, comme le fait déjà `creerMandatDepuisAffaire`. Les politiques de sécurité des tables ne changent pas.

### Cas limites

- **Rendez-vous** : `event_id` est unique par instance. Une copie reçoit `copie:<nouvel id>` ; le lien avec l'événement Google d'origine est donc coupé (règle 2). Un rendez-vous natif sans conflit est déplacé tel quel.
- **Entrée Inbox** : `source_id` est la clé stable donnée par la routine, unique par instance. Si la clé d'une entrée déplacée existe déjà dans la cible, le transfert est **refusé** avec un message clair (pas de renommage silencieux).
- **Collision d'unicité** sur `(instance, source, source_id)` dans la cible : refus avec message, rien n'est écrit (transaction annulée).
- **Doublon de copie** : copier deux fois le même miroir crée deux copies ; l'aperçu l'indique si une copie issue du même objet existe déjà (retrouvée par l'activité d'origine).
- **Sujet lié à une proposition** (`proposition_id`) : le lien est retiré (les propositions restent dans leur instance).

### Journal

Une ligne dans le journal de **chaque** instance concernée (origine et cible) : acteur, action `transfert.deplace` ou `transfert.copie`, compteurs par type, identifiant de la racine. Le journal reste en ajout seul.

### API

- `POST /api/transfert/apercu` : `{ type, id, instanceCible, exclusions }` → aperçu.
- `POST /api/transfert` : mêmes paramètres → exécute et renvoie le résumé.
- Les deux répondent **403** si l'instance courante n'est pas de type `propre`, **404** si l'objet n'existe pas dans l'instance courante, **409** sur collision.

Outils MCP : hors première version (le transfert reste une action de Marc dans l'interface).

### Interface

- Sur chaque fiche (affaire, contact, entreprise, tâche, entrée Inbox, rendez-vous) : un champ **Instance**.
  - Dans SIMATIS : modifiable ; la liste propose les instances actives (mandats et SIMATIS elle-même). Choisir une autre instance ouvre la fenêtre d'aperçu : texte « 1 affaire, 2 contacts… seront déplacés », « 1 contact sera copié (détaché de HubSpot) », liens retirés, cases à cocher pour les objets proposés, bouton **Confirmer**.
  - Dans un mandat : lecture seule, avec le nom de l'instance.
- Après confirmation : message de résultat avec le lien vers l'objet dans l'instance cible.
- Les fiches existent déjà (`web/src/pages/Fiche.tsx` et pages d'entrée Inbox, tâche, rendez-vous) ; le champ est un composant partagé.

## Tests

- **Isolation** : après un déplacement, l'ancienne instance ne voit plus l'objet ni ses liés, la cible les voit ; aucune ligne ne référence l'autre instance (parcours de toutes les clés étrangères).
- **Copie** : l'original reste intact et synchronisable ; la copie a `source = 'natif'`, `source_id` vide, une activité d'origine ; les liens de la copie pointent vers des copies, pas vers l'original.
- **Mélange natif et miroir** dans un même sous-graphe.
- **Exclusions** : un objet décoché n'est pas transféré et le lien est retiré.
- **Droits** : refus (403) depuis un mandat et depuis une instance de démonstration ; refus si la cible est archivée ou identique à l'origine.
- **Collisions** et **atomicité** : un échec en cours de route ne laisse rien d'écrit.
- **Journal** des deux côtés ; concurrence (deux transferts simultanés de la même racine).
- **Interface** : champ modifiable dans SIMATIS, en lecture seule dans un mandat ; fenêtre d'aperçu ; vérification dans le navigateur.
- Données de test **uniquement fictives**.

## Confidentialité

Les copies d'un mandat vers un autre transportent des données réelles d'un client dans l'instance d'un autre : c'est voulu par Marc, et c'est tracé dans le journal des deux instances et dans l'historique de la copie. Aucun nom réel n'apparaît dans le dépôt ni dans les tests.
