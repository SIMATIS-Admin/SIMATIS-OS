# Devis, livraison B : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou subagent-driven-development) pour exécuter ce plan tâche par tâche.

**Goal :** Paramètres du devis (réglages, bibliothèque de clauses, modèles de mission, numérotation), PDF du devis, et les deux entrées rapides du Pipeline.

**Spec :** `docs/superpowers/specs/2026-11-19-devis-design.md` (livraison B). Livraison A : `docs/superpowers/plans/2026-11-19-devis-livraison-a.md`.

## Global Constraints

- Dépôt public : fixtures et tests fictifs uniquement. Les clauses, modèles et mentions réels vivent en base.
- L'OS ne propose jamais de prix : un modèle de mission n'a jamais de prix (`prixUnitaire: null`).
- Module `devis` de l'instance propre seulement (`devisActif`), 404 ailleurs.
- Un devis validé reste verrouillé. Les clauses et le texte d'un devis sont copiés dans le devis : modifier la bibliothèque ne change pas un devis existant.
- Pas de `git add -A`, pas de worktree, `npm run verify` avant chaque commit, branche `feature/devis-b` créée depuis `origin/main`.

## Rulings (décisions prises sans Marc, à relire)

- **PDF avec `pdfkit`** (JavaScript pur, sans navigateur) et une mise en page dédiée qui reprend les blocs de l'aperçu, plutôt qu'un rendu de la page par Chromium : l'image Docker Alpine n'embarque pas de navigateur et l'alourdirait beaucoup. Coût : deux mises en page à garder alignées ; un test vérifie que les mêmes blocs de contenu sont dans le PDF.
- **« Proposition »** : l'invite de création au passage d'étape se déclenche quand le libellé de l'étape de destination contient « proposition » (insensible à la casse), car les identifiants d'étape diffèrent selon le CRM.
- **Format de numérotation** : jetons `{AAAA}` (année) et `{NNN}` (compteur, autant de chiffres que de N, au moins un jeton N). Défaut `DEV-{AAAA}-{NNN}`.
- **TVA** réglable (défaut 20 %), validité (30 j) et acompte (0 %) par défaut réglables.

## Review Focus

- Format de numérotation sans jeton compteur, ou avec caractères étranges : refusé ; deux devis ne reçoivent jamais le même numéro.
- Bibliothèque vide : un nouveau devis reprend, comme en A, les clauses du dernier devis.
- Clause ou modèle supprimé de la bibliothèque : les devis existants gardent leur copie.
- PDF d'un devis incomplet (prix à fixer, titres longs, accents, apostrophes, beaucoup de lignes) : se génère sans erreur, sur plusieurs pages si besoin.
- Un autre devis (autre instance) demandé en PDF : introuvable.
- Passage en « Proposition » pour une affaire qui a déjà un devis : aucune invite.

## Tâches

### Task 1 : réglages, clauses et modèles (serveur)

**Files:** Modify `src/conversion/schema.ts`, `src/db/metier-tables.ts`, `src/conversion/devis.ts`, `src/conversion/devis-contenu.ts`, `src/api/routes.ts` ; Create `src/conversion/devis-parametres.ts`, `src/conversion/devis-parametres.test.ts`, migration.

**Interfaces (produces) :**
- Tables `devis_reglages` (une ligne par instance : `numerotation`, `mentions`, `tvaPct`, `validiteJours`, `acomptePct`), `devis_clauses` (`titre`, `texte`, `parDefaut`, `ordre`), `devis_modeles` (`nom`, `contexte`, `objectifs`, `inclus`, `exclu`, `livrables`, `duree`, `lignes` jsonb sans prix), toutes avec `instanceIsolation` et enregistrées dans `metier-tables.ts`.
- `lireParametres(db, instance)` → `{ reglages, clauses, modeles }` (réglages par défaut si absents).
- `enregistrerReglages(db, instance, r)`, `creerClause/modifierClause/supprimerClause`, `creerModele/modifierModele/supprimerModele` ; `formaterNumero(format: string, annee: number, compteur: number): string` (pure) ; `formatNumeroValide(format: string): boolean`.
- `creerDepuisAffaire(db, instance, opportuniteId, modeleId?)` : numéro via le format, clauses = clauses `parDefaut` de la bibliothèque (sinon celles du dernier devis), mission pré-remplie par le modèle, `validiteJours`/`acomptePct` par défaut des réglages.
- `lireDevis` renvoie en plus `tvaPct` et `mentions` ; `totaux` utilise `tvaPct`.
- Routes : `GET /api/i/:slug/devis/parametres`, `PUT …/parametres/reglages`, `POST/PUT/DELETE …/parametres/clauses[/:id]`, `POST/PUT/DELETE …/parametres/modeles[/:id]` ; `POST /devis` accepte `modeleId` optionnel.

Tests : `formaterNumero('DEV-{AAAA}-{NNN}', 2026, 7)` = `DEV-2026-007`, `formaterNumero('{AAAA}/{NNNN}', 2027, 12)` = `2027/0012` ; format sans `{N…}` invalide ; création avec modèle reprend contexte/inclus et lignes sans prix ; avec clauses `parDefaut` en bibliothèque, le devis les reçoit ; sans bibliothèque, reprend celles du dernier devis ; supprimer une clause laisse les devis intacts ; tvaPct 10 change `totaux.ttc` ; 404 sur autre instance.

### Task 2 : écran Paramètres du devis et usage dans l'éditeur

**Files:** Create `web/src/pages/parametres/DevisParametres.tsx` (+ test) ; Modify `web/src/pages/Parametres.tsx` (onglet « Devis », visible si le module est actif), `web/src/api.ts`, `web/src/devis.ts` (`calculer(c, tvaPct)`), `web/src/pages/DevisAffaire.tsx` (choix du modèle), `web/src/pages/DevisEditeur.tsx` (insérer une clause de la bibliothèque), `web/src/pages/DevisApercu.tsx` (mentions, TVA).

Tests : l'onglet liste et crée une clause et un modèle ; le format de numérotation invalide affiche l'erreur ; le choix d'un modèle dans le sélecteur est envoyé à la création ; « Insérer une clause » ajoute une clause copiée ; l'aperçu montre les mentions et la TVA réglée.

### Task 3 : PDF

**Files:** Create `src/conversion/devis-pdf.ts`, `src/conversion/devis-pdf.test.ts` ; Modify `package.json` (dépendance `pdfkit` + `@types/pdfkit`), `src/api/routes.ts`, `web/src/pages/DevisEditeur.tsx` (bouton).

**Interfaces :** `genererPdfDevis(d: DevisLu): Promise<Buffer>` ; `GET /api/i/:slug/devis/:id/pdf` → `application/pdf`, nom `devis-<numero>.pdf`. Bouton « Télécharger le PDF » (lien) dans l'étape Envoi.

Tests : le buffer commence par `%PDF` ; texte relu avec `pdfjs-dist` : numéro, client, intitulé, chaque ligne, « Total TTC » et son montant, mentions, titre d'une clause active et absence d'une clause inactive ; 60 lignes → plusieurs pages ; texte accentué et apostrophes ; devis d'une autre instance → 400.

### Task 4 : entrées du Pipeline

**Files:** Modify `web/src/pages/Pipeline.tsx` (+ `Pipeline.test.tsx`), `web/src/App.tsx` (prop `devisAutorise`).

- Sur chaque carte d'une affaire ouverte du Pipeline : bouton « Devis » (lien `#/<slug>/devis/affaire/<id>`) quand `devisAutorise`.
- Après un déplacement vers une étape dont le libellé contient « proposition » : bandeau « <entreprise> passe en Proposition. Préparer le devis maintenant ? » avec « Préparer le devis » et « Plus tard ». Pas de bandeau si le module est inactif ou si l'affaire a déjà un devis (`fetchDevis`).

### Task 5 : vérification et livraison

`npm run verify`, doc `docs/plan.md`, revue, PR, CI verte, merge, rebuild (`docker compose up -d --build app` depuis `origin/main`), vérification en base et API, second cerveau (structure, feuille de route, log).
