# Section Diagnostics : fusion du Diagnostic et des Tests VMA

Date : 2026-10-21. Statut : maquette validée dans la conversation (prototype `maquettes/diagnostics-fusion.html`).
Spec à relire avant tout code. Les données de la maquette sont fictives.

## Objectif

Remplacer les deux entrées « Diagnostic » et « Tests VMA » du menu « Stratégie » par une seule
section « Diagnostics ». Elle liste les entreprises, et pour chacune montre le diagnostic
d'endurance commerciale et les tests VMA, au même niveau.

Critères de réussite :

- une seule entrée de menu « Diagnostics » ; les deux anciens écrans ne sont plus accessibles depuis le menu ;
- une ligne par entreprise, 5 entreprises par page, pagination et recherche sur toutes les entreprises ;
- la vue principale montre seulement l'essentiel (état du diagnostic, bilan des VMA) ;
- la vue étendue montre le détail de chaque bloc, l'aperçu du résultat VMA et les outils ;
- une entreprise peut avoir un test VMA avant son diagnostic ;
- aucune donnée réelle dans le dépôt (noms, résultats, liens d'invitation).

## Décisions prises (validées dans la maquette)

| Question | Décision |
| --- | --- |
| Structure | Une entreprise = une carte. Le diagnostic et les tests VMA sont deux blocs de même poids. Pas d'imbrication. |
| Ordre | Un test VMA peut précéder le diagnostic. Le bloc diagnostic affiche « À lancer » tant qu'il n'est pas démarré. |
| Vue principale | Trois colonnes : nom, état du diagnostic (étape x sur 5 ou « Pas encore lancé »), bilan VMA (nombre et nombre reçu). |
| Vue étendue | Ouverte par « Détail ▾ » ; refermée par « Réduire ▴ ». Toutes les lignes sont fermées au départ. |
| Pagination | 5 entreprises par page, navigation Précédent / numéros / Suivant, compte « Entreprises 1 à 5 sur 6 ». |
| Recherche | Filtre sur le nom, sur toutes les entreprises ; revient à la page 1 à chaque frappe. |
| Création | Bouton « + Nouveau » : « Nouveau diagnostic » ou « Nouveau test VMA ». Chaque bloc a aussi son propre bouton. |
| Aperçu VMA | Dernier résultat reçu (voir ci-dessous) et, si au moins deux premiers tests, graphique d'évolution. |
| Résultat complet | Bouton désactivé « bientôt » : la page complète par mandat est une livraison ultérieure. |

## Structure de l'écran

Liste paginée d'entreprises. Chaque ligne, fermée, contient :

- nom et secteur ;
- **Diagnostic** : « Étape x sur 5 », « Pas encore lancé » ;
- **Tests VMA** : « n tests », avec le nombre reçu s'il y en a ;
- le bouton « Détail ▾ ».

Ouverte, la ligne affiche deux blocs côte à côte (empilés sur téléphone) :

**Bloc Diagnostic** : titre, année, barre des 5 étapes avec l'étape en cours, diagnostics passés
(année et date de restitution), outils (continuer l'étape, support d'ouverture, résultat de l'outil
externe, rapport). Si aucun diagnostic : « À lancer » et le bouton « Lancer le diagnostic ».

**Bloc Tests VMA** : aperçu du dernier résultat (voir ci-dessous), puis la liste des tests avec
leur type (premier test ou essai), leur statut et leur échéance. Actions selon le statut :
envoyé → copier le lien, révoquer ; utilisé → brouillon du résultat ; révoqué → aucune.
Bouton « + Nouveau test VMA ».

## Aperçu du résultat VMA

Montré seulement si au moins un test a un résultat reçu. Il reprend les champs que le code
enregistre déjà pour un résultat (`src/vma/releve.ts`, `web/src/pages/TestsVma.tsx`) :

- VMA : CA commandé par mois, et son équivalent annuel (si mesurable) ;
- socle récurrent (si > 0) et allure actuelle ;
- ambition : niveau, objectif mensuel, échéance ;
- les 3 freins principaux, tels que vus par le dirigeant.

**Évolution** : graphique à barres de la VMA des **premiers tests** uniquement, avec l'écart depuis
le premier (euros et pourcentage). Affichée à partir de deux premiers tests. Les **essais** n'entrent
ni dans l'historique ni dans l'évolution (cahier des charges §5.1) ; un essai s'affiche comme
« Essai (hors historique) ».

Ce qui n'est **pas** dans l'aperçu (réservé à la page par mandat, plus tard) : le potentiel brut,
la part à convertir, le détail des freins avec leur note et leurs gains, et le contenu du brouillon.

## Données existantes et liaison entreprise

Les données actuelles sont reprises : la fusion change l'écran, pas les tables. Projets de
diagnostic (`diagnostic_projets`) et tests VMA (`vma_tests`) restent en place.

Constat vérifié dans le code :

- **Diagnostic** : un projet n'a pas d'identifiant d'entreprise. Il porte un nom et une activité en
  texte libre (`src/diagnostic/schema.ts`). Le regroupement par entreprise n'est donc pas possible
  en l'état.
- **Test VMA** : `vma_tests.entreprise_id` existe mais est facultatif, et le nom de l'entreprise
  est gardé en texte (`src/vma/schema.ts`).

Mise en place prévue :

1. Migration : ajout d'une colonne `entreprise_id` facultative à `diagnostic_projets`. Aucune donnée supprimée.
2. Rattachement des projets existants par rapprochement de nom avec l'annuaire des entreprises.
   Le rapprochement n'est pas appliqué automatiquement : une liste de correspondances est présentée
   pour validation, et les cas sans correspondance se rattachent à la main.
3. Les nouveaux diagnostics sont rattachés à une entreprise dès leur création (pas de projet orphelin).

Règle : une entreprise a au plus un diagnostic en cours (voir la question ouverte).

## Question ouverte

**Nouveau diagnostic sur une entreprise qui en a déjà un** : la maquette grise l'entreprise.
Deux options :
1. masquer l'option « Nouveau diagnostic » pour cette entreprise (une seule étude en cours) ;
2. proposer une nouvelle année : l'ancien reste dans l'historique, le nouveau devient le diagnostic en cours.

Recommandation : option 2, puisque la maquette affiche déjà les diagnostics passés par année.

## Hors périmètre

- La page complète de résultat VMA par mandat.
- Le contenu des outils du diagnostic (support, rapport, entretien) : ils gardent leurs écrans actuels.
- Toute modification du calcul ou de la règle du semestre.

## Vérification prévue

- Tests unitaires : regroupement des tests par entreprise, règle « essai hors évolution », pagination et recherche.
- Tests d'interface : une seule entrée « Diagnostics » dans le menu, création depuis les deux boutons, aperçu VMA.
- `npm run verify` avant chaque commit ; vérification dans le navigateur sur l'instance de démonstration.
