# Ajouter un CRM

Pour qui veut brancher un nouveau CRM (Odoo, Pipedrive, Salesforce…) sur une instance de SIMATIS OS.
HubSpot est le seul CRM branché aujourd'hui : il sert d'exemple tout du long.

## Le principe

**Le modèle de SIMATIS OS fait foi.** Un CRM tiers ne remplace pas les tables du CRM de l'OS : il
les alimente, et l'OS écrit chez lui quand la connexion le permet. Tout le reste en dépend sans
rien savoir du CRM : le pipeline, les fiches, l'Inbox, les routines, et la synchronisation avec les
OS partenaires par le relais d'agents (profil `crm/1` du kit `os-agents-relay`).

Exemple concret : chez un client sous HubSpot, Marc change l'étape d'une affaire dans l'OS. L'OS
l'écrit dans HubSpot, met sa copie à jour, et la synchro envoie l'étape à Alpes OS. Si Christophe
la change à son tour dans Alpes OS, elle revient par le même chemin, jusque dans HubSpot. Un
connecteur qui respecte les règles ci-dessous fait marcher tout cela sans autre changement.

## Les règles

1. **Implémenter l'interface `Connector`** (`src/connexions/types.ts`) : `sync` (copier le CRM
   dans l'OS), `write` (écrire une modification dans le CRM), `verify` (tester les accès avant de
   les enregistrer). L'enregistrer avec `registerConnector`, comme `src/connecteurs/hubspot/index.ts`.
2. **Copier sans jamais effacer.** `sync` écrit dans les tables du CRM de l'OS (`entreprises`,
   `contacts`, `opportunites`, `taches`, `activites` et leurs tables de liens) avec
   `source = '<fournisseur>'` et l'identifiant du CRM dans `source_id`. Une fiche se retrouve par
   ce couple (index unique) : elle est mise à jour, pas dupliquée. Une fiche disparue du CRM n'est
   pas effacée.
3. **N'écrire que ce que le CRM a répondu.** Un champ absent de la réponse ne change rien à la
   copie (voir `present()` dans `src/connecteurs/hubspot/mapping.ts`). Un champ vide dans le CRM
   vide le champ de l'OS.
4. **Ne toucher qu'à ses propres fiches.** Les fiches créées dans l'OS (`source = 'natif'`) ou
   reçues d'un partenaire (`source = 'partenaire:<connexion>'`) ne sont jamais écrasées par une
   synchro. Les liens faits dans l'OS restent (voir `remplacerLiensHubspot`).
5. **Déclarer ses étapes** dans les réglages de la connexion, sous la même forme que HubSpot
   (`src/connecteurs/hubspot/reglages.ts`, type `Etape`) : `id`, `label`, `ordre`, `clos`,
   `gagne`, `probabilite`. Le pipeline, la fiche affaire et la synchro avec les partenaires les
   lisent par `pipelineSource` (`src/crm/pipeline.ts`), qui ne connaît que HubSpot aujourd'hui :
   ajouter le nouveau fournisseur à cet endroit.
6. **Respecter les champs exclus** des réglages : un champ exclu n'est ni lu (retiré de la requête)
   ni écrit.
7. **Lecture seule par défaut** (`sens: 'lecture'`). L'écriture (`sens: 'deux_sens'`) ne s'ouvre
   qu'après une première synchro vérifiée par le pilote.
8. **Écrire sous le double verrou.** `write` reçoit `ctx.reel` : faux tant que `REAL_WRITES` n'est
   pas `on` sur le serveur **et** que l'interrupteur de l'instance est fermé. Dans ce cas, ne rien
   envoyer au CRM et répondre `{ simulation: true }`.
9. **Comprendre les opérations de l'OS.** `write` reçoit `{ op, data }` avec les identifiants
   **locaux** de l'OS ; le connecteur retrouve l'identifiant du CRM par `source_id`. Opérations
   utilisées aujourd'hui : `company.create`, `company.update`, `contact.create`, `contact.update`,
   `deal.create`, `deal.update`, `deal.stage`, `deal.associer`, `task.create`, `task.update`,
   `task.complete`, `note.create`, `association.add`, `association.remove`, `record.archive`,
   `record.merge`. Une modification reçue d'un partenaire passe par `deal.stage`, `deal.update`,
   `contact.update` et `company.update`. Une opération inconnue lève une erreur lisible.

Rien à faire pour la synchro avec les partenaires : un déclencheur Postgres fait bouger
`updated_at` à chaque modification des tables du CRM et de leurs liens, quel que soit le chemin.
La synchro repère ainsi ce que le connecteur a changé et l'envoie aux partenaires qui le voient.

## Exemple : la correspondance HubSpot

Les noms du profil `crm/1` sont ceux des colonnes de l'OS (en `snake_case`).

**Entreprise** (`companies`)

| Profil `crm/1` | HubSpot |
| --- | --- |
| `nom` | `name` |
| `secteur` | `industry` |
| `ville` | `city` |
| `taille` | `numberofemployees` |
| `domaine` | `domain` |

**Contact** (`contacts`)

| Profil `crm/1` | HubSpot |
| --- | --- |
| `nom` | `firstname` + `lastname` |
| `fonction` | `jobtitle` |
| `email` | `email` |
| `telephone` | `phone` |
| lien `entreprises` | `associatedcompanyid` et associations |
| `emails`, `role` | dans l'OS seulement |

**Affaire** (`deals`)

| Profil `crm/1` | HubSpot |
| --- | --- |
| `titre` | `dealname` |
| `etape` | `dealstage` (étapes lues dans les pipelines) |
| `montant` | `amount` (arrondi à l'euro) |
| `echeance` | `closedate` (date seule) |
| `clos` | étape de clôture gagnée ou perdue |
| `motif` | `closed_lost_reason` |
| `proprietaire` | `hubspot_owner_id` |
| `derniere_activite` | `notes_last_updated` |
| `etapes_dates` | `hs_v2_date_entered_<étape>` |
| liens `contacts`, `entreprises` | associations |
| `mode_facturation`, `duree_engagement_mois`, `tacite_reconduction`, `probabilite_manuelle`, `origine`, `prochaine_etape`, `qualification`, `potentiel`, `faisabilite` | dans l'OS seulement |

**Tâche** (`tasks`)

| Profil `crm/1` | HubSpot |
| --- | --- |
| `titre` | `hs_task_subject` |
| `notes` | `hs_task_body` |
| `type` | `hs_task_type` (`CALL`, `EMAIL`, `TODO`) |
| `echeance` | `hs_timestamp` |
| `fait_at` | `hs_task_completion_date` (tâche `COMPLETED`) |

**Activité** : une note (`notes`), un appel (`calls`), un email (`emails`, l'objet seulement) ou
une réunion (`meetings`) de HubSpot devient une activité de type `note`, `appel`, `email` ou
`reunion`, avec son titre, son résumé et sa date.

**Rendez-vous** : ils viennent de l'agenda Google, pas du CRM.

## Ce qui ne voyage jamais vers un partenaire

Les identifiants du CRM (`source`, `source_id`), l'`instance_id`, l'`event_id` Google d'un
rendez-vous et la liste brute de ses invités. Le profil `crm/1` ne les connaît pas : le kit refuse
un changement qui les porterait.
