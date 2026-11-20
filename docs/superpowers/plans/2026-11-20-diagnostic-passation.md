# Diagnostic : passation sur le site, relève par l'OS — plan

> Exécution : en natif, tâche par tâche (superpowers:executing-plans). Cases à cocher pour le suivi.

**Goal :** passer l'entretien du Diagnostic d'Endurance Commerciale dans une page du site et laisser l'OS relever les réponses pour calculer les scores.

**Architecture :** fonctions Pages du site + KV `VMA` (préfixe `diag:`), page calquée sur le Test de VMA ; côté OS, une route de préparation, une relève dans la boucle existante, une colonne `passation`.

**Spec :** `docs/superpowers/specs/2026-11-20-diagnostic-passation-design.md`

## Global Constraints

- Questionnaire, grille et données d'entreprise : jamais dans ce dépôt (config du site hors git ; tests avec données fictives).
- Aucun nouveau secret : `VMA_OS_TOKEN` (OS vers site), `OS_PULL_TOKEN` / `SITE_CONTACT_TOKEN` (relève).
- Clé de question : `section#numero` (identique à `cleQuestion` de `src/diagnostic/grille.ts`). « E » devient `N/A` côté OS.
- Site : se déploie avec `npx wrangler@4 pages deploy public --project-name simatis-site --branch main`.
- Interface en français, style du Test de VMA, bandeau sobre « Diagnostic d'Endurance Commerciale ».

## Review Focus

- Onglet fermé en pleine passation : tout est repris (réponses, commentaires, position, temps).
- Envoi avec une question sans réponse : refusé, la question est indiquée.
- Projet inconnu de l'OS à la relève : le diagnostic reste sur le site (non acquitté), rien n'est perdu ni écrasé.
- Relève répétée du même document : aucun doublon, aucune réécriture.
- Réponse hors grille : gardée dans `passation`, absente de `reponsesEntretien` (sinon le calcul refuse).

### Task 1 : questionnaire et API du site

**Files (dossier « Site Web SIMATIS », hors git) :** créer `config/diagnostic-endurance.json`, `outils/construire-diagnostic.py`, `functions/_diag-lib.js`, `functions/api/diagnostic/{preparer,liste,document,essai,envoyer,en-attente,acquitter}.js`, `outils/test-api-diagnostic.mjs`.

**Interfaces — produit :**
- Doc KV `diag:<id>` : `{ id, essai, entreprise, interlocuteur, activite, taille, rdv, contexte, statut: 'prepare'|'en_cours'|'termine'|'releve', reponses: Record<cle, 'A'..'E'>, commentaires: Record<cle,string>, position: number, tempsMs: number, creeLe, majLe, termineLe?, profil? }`.
- `POST /api/diagnostic/preparer` (VMA_OS_TOKEN) `{ projetId?, entreprise, interlocuteur, activite, taille, rdv, contexte }` → `{ lien, expireLe }` (session `dsess:` 12 h).
- `GET /api/diagnostic/liste?t` → résumés ; `GET|PUT /api/diagnostic/document?t&d` ; `POST /api/diagnostic/essai?t` ; `POST /api/diagnostic/envoyer?t&d`.
- `GET /api/diagnostic/en-attente` (OS_PULL_TOKEN) → `{ diagnostics: Doc[] }` (statut `termine`, hors essai) ; `POST /api/diagnostic/acquitter` `{ items: [{ id, profil? }] }`.

- [ ] Script de construction du JSON depuis le CSV (rubriques, `section` courte de la grille, `titre`, questions, options sans les notes entre parenthèses, listes d'activités et de tailles).
- [ ] Test d'abord (`test-api-diagnostic.mjs`, questionnaire fictif, KV simulé) : préparer crée doc + session ; reprise après sauvegarde ; envoi refusé avec une question sans réponse (nomme la question) ; envoi accepté ; `en-attente` ne renvoie pas les essais ; `acquitter` supprime réponses et garde le résumé ; jeton faux refusé ; session expirée refusée.
- [ ] Implémenter jusqu'au vert.

### Task 2 : page du site

**Files :** `functions/diagnostic-endurance.js` (page), `public/assets/diagnostic.css`, `public/assets/diagnostic.js`.

- [ ] Console (en cours, à faire, terminés, essai), fiche préparée (lecture seule), passation (jauge, cadran 1 h 30 avec pause, choix A à E au clavier, commentaire, enregistrement à chaque réponse, précédente/suivante/passer), vue d'ensemble, fin et envoi. Ouverture directe sur la fiche quand `d` est présent.
- [ ] Contrôle : `node outils/controle-diagnostic.mjs` (page servie, assets présents, JSON valide) puis vérification dans le navigateur (mode essai).

### Task 3 : OS

**Files :** `src/diagnostic/passation.ts` (préparer, relever, correspondance), `src/diagnostic/passation.test.ts`, `src/diagnostic/schema.ts` + migration (`passation` jsonb), `src/diagnostic/routes` (route de préparation), `src/server.ts` (relève dans la boucle), `web/src/pages/Diagnostic.tsx` (bouton et affichage).

**Interfaces :**
- `preparerPassation(deps: InvitationDeps, projet): Promise<{ lien: string; expireLe: string }>` (`POST /api/i/:slug/diagnostic/projets/:id/passation`).
- `releverPassations(db, deps: ReleveVmaDeps): Promise<{ recus; enregistres; inconnus }>`.
- `versReponsesEntretien(reponses: Record<string,string>, grille): ReponseQuestion[]` : garde les clés de la grille, `E` → `N/A`.

- [ ] Tests d'abord (grille fictive) : correspondance, réponse hors grille gardée dans `passation`, relève qui calcule les dimensions, projet inconnu laissé sur le site, grille absente = rien acquitté, relève répétée sans doublon, acquittement avec profil, route de préparation (503 sans configuration).
- [ ] Migration, implémentation, bouton « Lancer le diagnostic » (étapes 1 et 2), affichage durée et commentaires à l'étape 2, test d'interface.
- [ ] `npm run verify`.

### Task 4 : livraison

- [ ] PR, revue, CI verte, merge, rebuild du conteneur depuis `origin/main`, déploiement du site, essai réel en mode essai, mise à jour du second cerveau (structure + feuille de route).
