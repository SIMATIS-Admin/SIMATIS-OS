# Présentations permanentes dans Supports — conception

Validée par Marc le 15/11/2026.

## Intention

Les présentations SIMATIS, Diagnostic d'endurance commerciale et Test de VMA étaient codées en dur
dans l'app (diaporama React). Marc veut les présenter avec la visionneuse Supports (slides HTML
1920 × 1080, modifiables depuis l'OS), les garder en permanence dans Supports, et n'avoir qu'un
bouton « Supports » dans Outils et diagnostics.

## Objectifs

- Les 3 présentations deviennent des supports au format HTML de la visionneuse, contenu repris à
  l'identique (générique, sans tarif ni méthode propriétaire), charte du deck de restitution.
- Le manifest porte `"permanent": true` : pas de « Terminer et supprimer » dans le lecteur, et le
  serveur refuse leur suppression.
- La page Supports devient une liste simple sur toute la largeur, en deux groupes : « Présentations »
  (permanentes) puis « Supports de rendez-vous ». Chaque ligne : titre, sous-titre, nombre de slides,
  durée totale si connue.
- Outils et diagnostics : un bouton « Supports » remplace les boutons Test VMA, Diagnostic, SIMATIS.
- Les anciennes adresses `presentation-*` mènent à Supports ; l'ancien code est retiré.
- Le bouton « Ouvrir le module d'essai » du Test VMA est conservé : le manifest déclare
  `"action": "testeur-vma"` et le lecteur affiche le bouton dans sa barre (les slides n'exécutent
  aucun script).

## Non-objectifs

- Pas de nouveau format de slide, pas de changement de la visionneuse au-delà des deux champs.
- Les decks vivent dans le dossier des supports (hors du dépôt), comme les autres supports.

## Approches

- Retenue : decks HTML dans le dossier des supports + champ `permanent`. Modifiables avec « Modifier ».
- Écartée : garder les présentations dans le code React. Elles ne s'ouvriraient pas dans la
  visionneuse et ne seraient pas modifiables depuis l'OS.
