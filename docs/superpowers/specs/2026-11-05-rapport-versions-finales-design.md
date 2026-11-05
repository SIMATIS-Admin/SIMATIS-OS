# Diagnostic : versions finales et règles de rédaction continues (analyse, rapport, restitution, diagnostic complet)

Date : 2026-11-05. Statut : conception validée dans la conversation, spec à relire.

Ce document ne décrit que la partie **publique et générique**. Le contenu des rapports, les règles de
rédaction et les trames vivent dans le second cerveau et la skill privée
`diagnostic-endurance-commerciale-rapport`, hors dépôt. Les exemples ci-dessous sont fictifs.

## Problème

Le pilote retravaille les rapports hors de l'OS, puis importe sa version (un Word, envoyé sur Drive
en Google Doc). Ces versions retravaillées valent mieux que les brouillons de Claude, mais rien
n'en est retenu : le rapport suivant repart de zéro, avec les mêmes écarts à corriger. Résultat :
cinq ou six versions pour arriver au rapport voulu, et des reprises dans un chat hors de l'OS.

Exemple de règle perdue (fictif, à titre d'illustration) : « le rapport ne contient aucune
proposition d'accompagnement ; il se limite au diagnostic, aux préconisations et au plan d'action ».

## Objectif et critères de réussite

Quand un rapport est finalisé, la manière de rédiger les suivants s'enrichit de ce qui a été fait.

- Le pilote désigne la version finale d'un projet en un clic.
- Une production de rapport relit les deux dernières versions finales et les règles de rédaction.
- Une règle vue dans deux rapports finaux devient ferme et s'applique sans rappel.
- Chaque changement de règle est visible dans l'OS et annulable.
- Aucun contenu de rapport, nom de client ou règle propriétaire dans le dépôt.

Le même mécanisme vaut pour l'**analyse des résultats** (revue de l'étape 3), la **restitution** (deck
de l'étape 5) et le **diagnostic complet** une fois terminé (voir « Extension »).

Hors périmètre : préparation du deck d'ouverture (étape 1), calcul du score, restitution, capitalisation des préconisations
(livraison existante), modification du texte du rapport depuis l'OS.

## Décisions prises

| Question | Décision |
| --- | --- |
| Désigner la version finale | Case « Version finale » cochée par le pilote sur une version qui a un Google Doc. L'import seul ne suffit pas : des versions intermédiaires peuvent être importées. |
| Nombre de finales par projet | Une. En cocher une autre remplace la précédente (les autres versions restent conservées). |
| Où vivent les règles | Dans le second cerveau (fiche dédiée), pas dans le dépôt ni en base. La skill y renvoie. |
| Qui met à jour les règles | Claude, sans validation préalable, avec un journal visible et une annulation possible. |
| Seuil d'une règle ferme | Constatée sur au moins 2 rapports finaux. Avant : « observation ». |
| Lecture des finaux | Par le runner, depuis le compte Google de l'OS (export existant `exporterRapportDrive`). C'est un **mode de démarrage** : une fois les règles assez mûres, le pilote le désactive et les règles seules guident la rédaction. |

## Livraison 1 : désigner la version finale

**Données** (`src/diagnostic/schema.ts`, migration Drizzle) : l'entrée de `rapportLiens`
(`{ lien, le, version? }`) reçoit un champ optionnel `finale: boolean`. Un seul élément est `finale`
par projet : l'écriture retire le drapeau des autres dans la même transaction. Pas de nouvelle colonne.

**Service** (`src/diagnostic/rapport.ts`) : `marquerVersionFinale(db, instance, id, lien)`.
Refus (`ChatIndisponible`) si le lien n'appartient pas au projet, s'il n'est pas un Google Doc
(`estGoogleDoc` : un lien artifact ne peut pas être final), ou si une production est en cours.
Décocher est possible.

**API** : `POST` sur le projet pour cocher ou décocher, via les routes du module diagnostic.

**Interface** (`web/src/pages/Diagnostic.tsx`, composant `Rapport`) : dans la liste des versions,
une case « Version finale » par version ayant un Google Doc, avec la version finale en évidence.

**Doublons** : deux entrées de même numéro de version (double envoi) restent visibles ; le pilote
coche celle qu'il veut. Aucune suppression automatique.

**Reprise de l'existant** : une fois la livraison déployée, le pilote coche les versions finales de
ses projets déjà terminés. L'OS ne les devine pas.

## Livraison 2 : rédiger à partir des finaux et des règles

**Lecture des finaux** : au lancement d'une production, le runner reçoit pour les deux derniers projets
(par date de version finale), hors projet courant, le texte du Google Doc final, exporté en Word par
l'OS puis converti en texte. Le texte est tronqué à une taille bornée, comme les autres contenus du
prompt (`slice`).

**Prompt de production** (`src/runner/runner.ts`, fonction du rapport) : ajoute deux blocs :
- les règles de rédaction fermes, lues dans la fiche du second cerveau, présentées comme impératives ;
- les deux rapports finaux, présentés comme modèle de structure, de vocabulaire et de longueur,
  tant que le réglage « Relire les finaux » est actif.

**Réglage « Relire les finaux »** : actif par défaut. Il vaut pour l'instance, dans les réglages du
module Diagnostic. Le pilote le désactive quand les règles suffisent : le bloc des finaux disparaît
du prompt, les règles restent. La capitalisation (livraison 3) continue de comparer chaque nouvelle
finale aux précédentes, que le réglage soit actif ou non. Le réglage est réversible.

La skill privée précise que ces deux blocs priment sur les habitudes de rédaction en cas de conflit,
y compris sur la trame en sept blocs si une règle ferme la modifie.

**Second cerveau** : la fiche des règles est lue et écrite par le runner dans le dossier du second
cerveau, avec les droits que le runner accorde déjà pour les demandes qui l'utilisent. Sans accès au
second cerveau sur le poste, la production se fait sans règles et le dit dans le chat.

**Amorçage** : à la première utilisation, une demande unique compare les deux premiers rapports
finaux entre eux et crée la fiche : les points communs deviennent règles fermes, les différences des
observations. La production du rapport en attente est ensuite lancée.

**Garde-fous** : si moins de deux finaux existent, la production utilise ceux qui existent et le
signale. Si l'export d'un Doc échoue, la production continue sans lui et le signale.

## Livraison 3 : capitalisation automatique et journal

**Déclencheur** : cocher une version finale lance une demande de capitalisation au runner (type
`capitalisation_rapport`), sauf pour l'amorçage.

**Traitement** : Claude compare la nouvelle version finale à (a) la dernière version rédigée par
Claude pour ce projet, si elle existe (`rapportVersions`), et (b) aux finaux précédents. Il met à jour
la fiche des règles : une observation constatée une seconde fois devient ferme, une nouvelle
différence devient observation, une règle contredite par la nouvelle finale est signalée dans le
journal plutôt que supprimée en silence.

**Journal** : table `rapport_regles_journal` (instance, projet, date, action `ajoutée` | `durcie` |
`modifiée` | `annulée`, libellé court de la règle, source). Le libellé est une consigne de style
générique (« pas de proposition d'accompagnement dans le rapport »), jamais un extrait de rapport.
Écran dans la page Diagnostic : liste datée avec un bouton « Annuler » par entrée, qui renvoie la
règle à son état antérieur dans la fiche.

**Outil MCP** (réservé au jeton de la demande) : `enregistrer_regles_rapport`, qui reçoit les
changements et écrit le journal. Le runner fait l'écriture dans la fiche du second cerveau.

## Extension : restitution et diagnostic complet

Le mécanisme (version finale cochée, fiche de règles dans le second cerveau, règles fermes à 2
constats, mode de démarrage « relire les finaux », journal annulable) est écrit une fois, pour un
**type de livrable**, et réutilisé :

| Type | Version finale | Fiche de règles | Quand la capitalisation part |
| --- | --- | --- | --- |
| `analyse` | revue de l'étape 3 validée par le pilote (commentaires, préconisations, plan d'action) | règles d'analyse : formulation des constats, niveau de détail des préconisations, construction du plan d'action | à la validation de la revue |
| `rapport` | Google Doc coché (livraisons 1 à 3) | règles de rédaction du rapport | à la case cochée |
| `restitution` | version du deck de l'étape 5 cochée (liste `restitutionLiens`) | règles de construction du deck de restitution (plan, durée, ton, place des options) | à la case cochée |
| `diagnostic` | le projet entier, une fois terminé | règles de conduite du diagnostic de bout en bout (enchaînement des étapes, ce qui a été corrigé entre le brouillon de Claude et le livrable remis, délais) | quand le pilote clôt le diagnostic (étape 5 terminée) |

**Livraison 4, analyse des résultats** : à l'étape 3, Claude prépare la revue d'un nouveau projet à
partir des deux dernières analyses finalisées (revues validées) : il propose commentaires,
préconisations et plan d'action dans le style et le niveau de détail déjà validés, au lieu de partir
de zéro. Le pilote corrige, puis valide la revue (action « Valider la revue », qui pose la version
finale de l'analyse). Les préconisations retenues alimentent aussi la bibliothèque générique par la
skill de capitalisation existante : cette livraison s'y ajoute sans la remplacer. Les propositions de
Claude sont toujours des suggestions modifiables : rien n'est inventé hors des données du projet.

**Livraison 5, restitution** : la case « Version finale » et la relecture des deux derniers decks
finaux s'ajoutent à l'étape 5, sur le même modèle que le rapport. Le texte du deck final est lu
par Claude comme aujourd'hui (le texte du deck n'est lu qu'à la demande), puis résumé en règles. Le
réglage « Relire les finaux » est propre à chaque type.

**Livraison 6, diagnostic complet** : à la clôture, une demande de capitalisation globale relit le
projet (revue, rapport final, deck final, compte rendu de la restitution déjà capitalisé) et met à
jour la fiche de règles du diagnostic. Elle complète la capitalisation de la restitution existante
(`capitalisation.ts`), qui continue d'alimenter le second cerveau avec ce que dit le client : la
nouvelle capitalisation porte, elle, sur la manière de conduire et de rédiger.

Le journal et l'annulation sont communs, avec une colonne « type de livrable ».

## Erreurs

- Cocher un lien non Google Doc ou étranger au projet : refus avec message, rien n'est modifié.
- Capitalisation en échec : la version reste finale, le journal note l'échec, le pilote peut relancer.
- Export Drive indisponible : production et capitalisation se font sans le texte du Doc, avec message.
- Annulation d'une règle déjà remplacée par une autre : refus avec message.

## Tests

- Service : une seule finale par projet ; refus d'un lien artifact, d'un lien étranger, pendant une
  production ; décocher.
- Interface : case visible seulement pour un Google Doc ; la finale ressort ; remplacement de la finale.
- Prompt : les règles fermes et les deux finaux figurent dans le prompt ; réglage désactivé : seuls
  les règles y figurent ; absents proprement s'il n'y
  en a pas ; troncature appliquée.
- Capitalisation : observation devenue ferme au second constat ; contradiction signalée ; annulation.
- Journal : une entrée par changement ; annulation refusée si la règle a changé depuis.
- Fixtures **fictives** uniquement. `npm run verify` avant chaque commit.

## Ordre de livraison

1. Version finale (données, service, API, interface).
2. Production à partir des finaux et des règles, avec amorçage.
3. Capitalisation automatique et journal.
4. Analyse des résultats (étape 3) : réutilisation des analyses finalisées.
5. La même chose pour la restitution (deck de l'étape 5).
6. Capitalisation du diagnostic complet à la clôture.

La livraison 2 apporte déjà le gain principal : un rapport en cours se refait avec les règles et les
modèles. La 3 évite d'avoir à tenir les règles à la main.

## Points à vérifier dans le code à l'implémentation

- Conversion du Word exporté en texte : réutiliser `lecture-pdf.ts` ou l'import existant si possible.
- Droits d'écriture du runner sur le dossier du second cerveau pour une demande de type rapport.
- Analyse : la revue porte aujourd'hui un champ `revue.statut` (« brouillon » par défaut) et l'action
  « Valider la revue » n'existe pas encore dans le code ; confirmer la forme exacte de la revue avec
  le pilote, et le recouvrement avec la bibliothèque générique tenue par la skill de capitalisation.
- Restitution : le deck est un artifact claude.ai ; confirmer avec le pilote comment il en fixe la
  version finale (artifact retouché ou fichier PowerPoint exporté), et comment l'OS en lit le texte.
- Clôture du diagnostic : repérer l'événement qui marque « diagnostic terminé » (étape 5 validée).
- Emplacement exact de la fiche des règles dans le second cerveau, à fixer avec le pilote.
