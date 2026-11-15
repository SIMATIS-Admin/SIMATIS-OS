# Présentations permanentes dans Supports — plan

> Exécution native (Marc a délégué la manière, AGENTS.md).

**Spec :** `docs/superpowers/specs/2026-11-15-supports-presentations-design.md`

## Contraintes globales

- Interface en français ; données fictives uniquement ; rien de client dans le dépôt.
- Les decks (dossier des supports, hors git) : `presentation-simatis`, `presentation-diagnostic`,
  `presentation-vma`, format `html`, `deck.css`, images dans `img/`.

## Points de vigilance

1. Un manifest sans `permanent` reste supprimable (supports de rendez-vous inchangés).
2. Une ancienne adresse `#/slug/presentation-vma` ouvre Supports, pas « Écran inconnu ».
3. Le serveur refuse la suppression d'un deck permanent même si l'appel est fait à la main.
4. La liste vide d'un groupe ne s'affiche pas (pas d'en-tête orphelin).
5. Un manifest sans parties markdown/HTML compte 0 slide sans planter.

### Tâche 0 : les 3 decks (hors git)
Créer les dossiers, slides et images ; vérifier dans la visionneuse que chaque slide tient.

### Tâche 1 : serveur
- `listerDecks()` renvoie `{ id, titre, soustitre, permanent, slides, duree }`.
- `supprimerDeck()` lève `SupportProtege` pour un deck permanent → 409.
- Tests dans `src/cours/api.test.ts` : liste enrichie, refus 409.

### Tâche 2 : lecteur et liste
- `lireManifest` : `permanent: boolean`, `action: 'testeur-vma' | null` (+ tests parseur).
- `Cours` : pas de « Terminer et supprimer » si permanent ; bouton « Module d'essai » si action.
- `CoursListe` : deux groupes, lignes simples (+ tests).

### Tâche 3 : Outils et diagnostics, routes
- Un bouton « Supports » (`#/slug/cours`) remplace les 3 boutons.
- `ANCIENNES_VUES` : `presentation-*` → `cours` ; retrait des vues, des pages et de leurs tests.
- `npm run verify`, vérification navigateur, PR, revue, CI verte, merge, reconstruction.
