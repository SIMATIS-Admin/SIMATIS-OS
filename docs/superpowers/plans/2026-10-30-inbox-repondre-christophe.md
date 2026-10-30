# Inbox : répondre à un message de l'espace partagé — plan d'implémentation

> **Pour les agents :** sous-compétence requise : superpowers:subagent-driven-development (recommandée) ou superpowers:executing-plans. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** un bouton « Répondre » sur les entrées Inbox venant de l'espace partagé, qui dépose la réponse puis range l'entrée en « traité ».

**Architecture :** le service serveur lit l'entrée, demande à l'exécuteur du poste l'opération `message` existante (`demander`, `src/cerveau/file.ts`), puis marque l'entrée traitée. Le front réutilise le formulaire `MessagePartage`.

**Stack :** TypeScript, Fastify, Drizzle, Vitest, React.

**Spec :** `docs/superpowers/specs/2026-10-30-inbox-repondre-christophe-design.md`

## Contraintes globales

- Données fictives uniquement dans les tests (dépôt public).
- Interface et messages en français ; commentaires : le pourquoi seulement.
- `npm run verify` vert avant chaque commit ; `git add` fichier par fichier.
- Instance propre avec le module `cerveau` uniquement, jamais une démo.
- L'entrée n'est jamais supprimée : sa clé `partage:<chemin>` doit rester connue.

## Points de revue

- L'exécuteur ne répond pas (délai 15 s, `RunnerInjoignable`) : erreur 502, entrée inchangée.
- L'exécuteur refuse le dépôt (`ok: false`) : erreur 502 avec le motif, entrée inchangée.
- Double clic ou deux onglets : la seconde réponse est refusée (409), un seul message déposé.
- Corps ou sujet vide : refusé (400), rien n'est demandé à l'exécuteur.
- Le dépôt réussit mais l'entrée a été traitée entre-temps : pas d'erreur, pas de second marquage.
- La transaction base ne reste pas ouverte pendant l'attente de l'exécuteur.

---

### Tâche 1 : service et vue serveur

**Fichiers :**
- Modifier : `src/inbox/service.ts` (type `SujetVue`, fonction `vues`, nouvelle fonction)
- Tester : `src/inbox/repondre.test.ts` (nouveau, calqué sur `livre-blanc-envoi.test.ts` pour la mise en place de la base)

**Interfaces :**
- Produit : `SujetVue.partage: { chemin: string } | null` ; `export async function repondreMessagePartage(db: Executor, instance: Instance, id: string, reponse: { sujet: string; corps: string }, demanderOperation?: typeof demander): Promise<SujetVue | null>` ; `export class DepotRefuse extends Error {}` (message = motif affichable).

- [ ] **Étape 1 : tests en échec** dans `repondre.test.ts`, avec une fausse `demanderOperation` :
  - `vues` : une entrée `source: 'routine'`, `sourceId: 'partage:echanges/2026-10-29-fictif.md'` donne `partage: { chemin: 'echanges/2026-10-29-fictif.md' }` ; une entrée manuelle donne `null`.
  - succès : la fausse fonction reçoit `{ espace: 'partage', type: 'message', genre: 'reponse', sujet, corps, enReponseA: 'echanges/2026-10-29-fictif.md' }` ; l'entrée revient `statut: 'traite'`, `traitePar: 'pilote'` ; un événement « Réponse déposée à Christophe : <titre> » est journalisé.
  - `{ ok: false, erreur: 'refus' }` → `DepotRefuse('refus')`, entrée toujours `a_traiter`, aucun événement.
  - `demanderOperation` qui rejette avec `RunnerInjoignable` → `DepotRefuse` « L'exécuteur du poste ne répond pas : rien n'a été déposé. », entrée inchangée.
  - entrée déjà traitée → `SujetRefuse('Sujet déjà traité.')`, fausse fonction non appelée.
  - entrée sans `partage` → `SujetRefuse('Cette entrée ne vient pas de l'espace partagé.')`.
  - entrée inconnue → `null`.
  - traitée pendant l'attente (la fausse fonction passe l'entrée en `traite` avant de répondre `ok`) → renvoie la vue sans second événement ni erreur.
- [ ] **Étape 2 : lancer** `npx vitest run src/inbox/repondre.test.ts` — attendu : échec (fonction absente).
- [ ] **Étape 3 : implémenter** `partage` dans `vues` (dérivé de `s.source === 'routine'` et du préfixe `partage:` de `s.sourceId`) et `repondreMessagePartage` : une première `withInstance` charge et contrôle l'entrée, l'appel à `demanderOperation` se fait **hors transaction**, une seconde `withInstance` recharge l'entrée et ne marque traité (avec `logEvent`) que si elle est encore `a_traiter`. `SujetVue` gagne le champ ; corriger les fixtures de tests existants qui construisent des `SujetVue`.
- [ ] **Étape 4 : lancer** le même fichier puis `npx vitest run src/inbox` — attendu : tout passe.
- [ ] **Étape 5 : commit** `feat(inbox): répondre à un message de l'espace partagé (service)`.

### Tâche 2 : route serveur

**Fichiers :**
- Modifier : `src/api/routes.ts` (près de `/api/i/:slug/sujets/:id/livre-blanc`, ~ligne 1251)
- Tester : `src/inbox/api.test.ts` (ajouter, en suivant les cas déjà présents)

**Interfaces :**
- Consomme : `repondreMessagePartage`, `DepotRefuse`, `SujetRefuse` (tâche 1) ; `surSujet` (routes.ts).
- Produit : `POST /api/i/:slug/sujets/:id/repondre`, corps `{ sujet: string (1–200), corps: string (1–100000) }` ; renvoie la `SujetVue` traitée.

- [ ] **Étape 1 : tests en échec** : corps vide ou sujet vide → 400 sans appel à l'exécuteur ; instance démo ou sans module `cerveau` → 403 ; entrée inconnue → 404 ; entrée déjà traitée ou sans `partage` → 409 ; `DepotRefuse` → 502 avec `{ error: <motif> }` ; succès → 200 et vue `traite`. L'exécuteur est simulé par `prendre()` / `repondre()` de `src/cerveau/file.ts`, comme dans les tests de `src/cerveau`.
- [ ] **Étape 2 : lancer** `npx vitest run src/inbox/api.test.ts` — attendu : échec (404 de route).
- [ ] **Étape 3 : implémenter** la route avec `surSujet`, un schéma Zod aux bornes ci-dessus, la même condition d'accès que `acces` dans `src/cerveau/routes.ts` (instance `propre` avec le module `cerveau`), et `DepotRefuse` → 502 (le gestionnaire de `surSujet` ne connaît que `SujetRefuse` et `ZodError` : gérer `DepotRefuse` dans l'action).
- [ ] **Étape 4 : lancer** `npx vitest run src/inbox src/api` — attendu : tout passe.
- [ ] **Étape 5 : commit** `feat(inbox): route pour répondre à un message de l'espace partagé`.

### Tâche 3 : interface

**Fichiers :**
- Modifier : `web/src/api.ts` (type `SujetVue` côté front, fonction d'appel), `web/src/pages/NoteCerveau.tsx` (`MessagePartage`), `web/src/pages/Inbox.tsx` (zone `decision`, ~ligne 505)
- Tester : `web/src/pages/Inbox.test.tsx`

**Interfaces :**
- Consomme : la route de la tâche 2.
- Produit : `repondreSujet(slug: string, id: string, r: { sujet: string; corps: string }): Promise<SujetVue>` dans `web/src/api.ts` ; `MessagePartage` gagne `sujetInitial?: string` et `deposer?: (r: { genre; sujet; corps; enReponseA }) => Promise<{ chemin?: string }>` (par défaut, l'appel actuel à `operationCerveau`, donc la page Second cerveau ne change pas).

- [ ] **Étape 1 : tests en échec** : le bouton « Répondre » n'apparaît que sur une entrée `a_traiter` avec `partage` ; au clic le formulaire s'ouvre avec le sujet « Re : <titre sans préfixe> » ; après confirmation, `repondreSujet` est appelé avec sujet et corps saisis et l'entrée disparaît de la liste ; sur erreur, le message s'affiche et l'entrée reste ; « Annuler » ferme le formulaire sans appel. Les tests existants de `NoteCerveau`/`Cerveau` restent verts.
- [ ] **Étape 2 : lancer** `npx vitest run --root web src/pages/Inbox.test.tsx` (ou la commande utilisée par `npm test` pour le web) — attendu : échec.
- [ ] **Étape 3 : implémenter** : `sujetInitial` et `deposer` dans `MessagePartage` ; dans `Inbox.tsx`, bouton « Répondre » dans `decision` (état local « formulaire ouvert » par entrée), succès → mise à jour de la liste comme pour `onTraite`.
- [ ] **Étape 4 : lancer** `npm run verify` — attendu : format, lint, types, tests, build verts.
- [ ] **Étape 5 : vérifier dans le navigateur** avec des données fictives (entrée de clé `partage:…`, exécuteur simulé) : bouton, formulaire prérempli, dépôt, disparition de l'entrée, erreur si exécuteur arrêté. Noter ce qui a été vu.
- [ ] **Étape 6 : commit** `feat(inbox): bouton Répondre sur les messages de l'espace partagé`.

### Tâche 4 : mise en production et second cerveau

- [ ] Ouvrir la PR, relire le diff (revue de code soi-même), attendre la CI verte, merger.
- [ ] Reconstruire l'image depuis `origin/main`, relancer le conteneur, vérifier `curl localhost:4300/health` ; relancer l'exécuteur du poste si besoin (un seul exécuteur doit tourner).
- [ ] Mettre à jour `brain/outils/simatis-os-structure.md` et `brain/outils/simatis-os-feuille-de-route.md` dans le Drive, noter dans `log.md`.
- [ ] Expliquer à Marc, pas à pas, comment tester.
