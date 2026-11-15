# « Mon espace » repliable d'un geste — design court

## Intention

Marc veut pouvoir replier d'un seul clic toutes les rubriques du menu (Ma journée, Détecter, Vendre,
Ma base, Piloter l'activité, Plus) dans un bloc « Mon espace », symbolisé par une icône de 4 carrés
(l'ensemble des fonctions de l'OS). Le menu s'allège : le Cockpit et les raccourcis restent sous la main.

## Objectifs, non-objectifs

- Le titre « Mon espace » devient un bouton avec l'icône 4 carrés et un chevron.
- Un clic replie ou déplie toutes les rubriques d'un coup ; le choix est mémorisé sur ce poste.
- Ouvert par défaut (le menu du 13 novembre montre l'arborescence complète).
- Restent toujours visibles : le Cockpit épinglé, « Mes raccourcis », Gestion et Feuille de route en bas.
- Chaque rubrique garde son propre repli ; rouvrir « Mon espace » retrouve l'état de chacune.
- Non-objectif : regrouper les 6 rubriques en 4 tuiles (écarté par Marc, il a choisi l'icône simple).

## Approches

1. **Bouton sur le titre existant** (retenue) : on transforme `.nav-espace-titre` en bouton, un état
   mémorisé en localStorage comme le repli des rubriques. Petit changement dans `Sidebar.tsx`.
2. 4 tuiles cliquables menant à de grands ensembles : écartée par Marc.
3. Rétablir l'ancien bouton « Mes espaces » (replié par défaut, retiré le 12/11) : écartée, l'arborescence
   doit rester visible par défaut.

## Laissé au constructeur

- En menu réduit (icônes seules), le bouton n'affiche que l'icône 4 carrés, avec une infobulle.
