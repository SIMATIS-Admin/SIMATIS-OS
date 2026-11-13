# Menu « Mon espace » et Cockpit synthétique — design (chantier 1 sur 3)

Refonte de l'ergonomie, sans changer les fonctionnalités. Trois chantiers, un par PR, dans cet ordre : (1) menu et Cockpit (ce document), (2) section Détecter (Radar, Recherches, ICP, Campagnes), (3) ICP par instance.

## Intention

Marc trouve l'OS peu engageant : le Cockpit est la concaténation de l'Inbox et du Brief (l'Inbox prend toute la place même vide, le Brief oblige à défiler) et le menu est une liste plate où les favoris sortent de leur rubrique. Il veut un Cockpit clair, synthétique, graphique, et un menu rangé qui reste lisible quand les instances se multiplieront.

## Objectifs

- Menu : le Cockpit tout en haut, toujours visible ; puis « Mes favoris » ; puis « Mon espace », l'arborescence complète (Cockpit inclus), rangée par rubrique.
- Un favori est un **doublon** : il apparaît dans « Mes favoris » et reste à sa place dans « Mon espace » (étoile jaune sur la ligne d'origine).
- Arborescence de « Mon espace » (décidée par Marc) :
  - Cockpit, Agenda
  - Détecter : Radar, Recherches, ICP, Campagnes (les trois dernières existent déjà ou arrivent au chantier 2 ; ici, seul l'emplacement dans le menu est posé, vers les écrans existants : Recherches → Bases vivantes, Campagnes → Prospection, ICP → entrée marquée « Bientôt » en attendant le chantier 3, pour ne pas dupliquer l'Atelier stratégique)
  - Vendre : Pipeline, Rendez-vous, Devis, Outils et diagnostics (Relais internes y reste)
  - Ma base : Entreprises, Contacts
  - Piloter l'activité : Atelier stratégique, Tableau de bord, Second cerveau, Démarrage du mandat
  - Plus : inchangé
- Cockpit (version A choisie sur maquette) : une page de synthèse, tout visible sans défiler :
  - bandeau Inbox replié : « N à traiter » avec bouton Ouvrir ; vide → fine ligne verte « Rien à traiter ✓ » ; l'Inbox complète s'ouvre en grand pop-up ;
  - tuiles à icônes : rendez-vous du jour, tâches du jour, en retard, ont répondu (Radar) ;
  - une carte « prochain rendez-vous + priorité du jour » (la priorité du Brief actuel) ;
  - le détail du Brief (rendez-vous du jour, activité récente, panneau Prospection) passe en sections repliées sous les tuiles.

## Direction graphique (précisée par Marc après la maquette)

- Sobre, logiciel professionnel. La charte actuelle de l'OS est conservée telle quelle : mêmes couleurs, polices, panneaux et boutons (`styles.css`, `interface.css`, `cockpit.css`, jeu d'icônes de `web/src/icons.tsx`).
- **Aucun emoji.** Les « logos » sont les icônes sobres déjà utilisées dans l'OS (traits fins, une seule couleur), jamais des pictogrammes colorés.
- La maquette en emojis n'était qu'un schéma de disposition : seule la disposition (tuiles, bandeau Inbox, favoris en doublon) est retenue, pas son style.
- Peu d'effets : pas d'animation décorative, une seule couleur d'alerte (celle de la charte) pour les retards.

## Non-objectifs

- Pas de changement de fonctionnalité de l'Inbox, du Brief, du Radar.
- Pas de refonte du Radar, des Recherches, des ICP (chantiers 2 et 3), ni des Rendez-vous et Devis.
- Aucun changement d'URL des écrans existants.

## Anti-objectifs

- Un Cockpit qui reste une pile de deux écrans.
- Un favori qui disparaît de sa rubrique d'origine.

## Contraintes

- Code existant : `web/src/nav.ts` (NAV, groupes), `web/src/shell/Sidebar.tsx` (favoris, repli mémorisé en localStorage, mode réduit), `web/src/pages/Cockpit.tsx`, `Brief.tsx`, `Inbox.tsx`. Les favoris déjà enregistrés (identifiants d'écran) doivent continuer à fonctionner.
- Données fictives dans les tests. Tests avec le code, `npm run verify`, vérification dans le navigateur.
- Interface en français.

## Approches considérées

1. **Remanier le menu et recomposer le Cockpit en réutilisant Inbox et Brief** (retenue) : l'Inbox et le Brief gardent leur logique, le Cockpit les présente autrement (bandeau, pop-up, tuiles, sections repliées). Risque faible, aucune fonctionnalité réécrite.
2. Réécrire Inbox et Brief en composants neufs : rendu plus libre mais risque de régression sur 1 500 lignes de logique, hors demande.
3. Ne toucher qu'au CSS : insuffisant, la structure du Cockpit et du menu doit changer.

Marc a choisi la maquette A (tuiles + Inbox repliée) contre B (deux colonnes).

## À la charge du constructeur

- Source des compteurs de tuiles (réutiliser les données du Brief et le compteur de l'Inbox déjà calculé pour le menu).
- Détails visuels : icônes, couleurs, animation du pop-up, accessibilité (focus, Échap pour fermer).
- Dans le menu : sections de « Mon espace » repliables avec mémoire, comme aujourd'hui.
