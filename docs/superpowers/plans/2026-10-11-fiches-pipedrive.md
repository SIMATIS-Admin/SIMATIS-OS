# Fiches détaillées à la Pipedrive — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Page détail commune (affaire, contact, entreprise) avec champs modifiables, notes, historique et barre d'étapes, synchronisée avec HubSpot.

**Architecture:** Historique dans `activites` (étendue) alimentée par la copie HubSpot des notes, appels, emails et réunions ; service `src/crm/fiches.ts` (lecture, modification, notes) ; écran `web/src/pages/Fiche.tsx` routé en `#/<slug>/fiche/<kind>/<id>`.

**Tech Stack:** TypeScript, Fastify, Drizzle, Zod, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-fiches-pipedrive-design.md`

## Global Constraints

- Ne jamais modifier les migrations existantes (0015 est appliquée sur la base réelle) : nouvelle migration `0016`.
- Données de test fictives ; double verrou des écritures inchangé ; champs exclus jamais envoyés.
- Une seule PR pour le chantier ; `npm run verify` vert avant chaque commit ; vérifier la branche avant chaque commit.

## Review Focus

- Note HubSpot dont le contact a été écarté (domaine exclu) : copiée sans lien, pas d'erreur.
- Affaire native sans `etapes_dates` : barre d'étapes sans durée, pas de « NaN j ».
- Modification d'un champ exclu (par exemple `amount`) : refusée côté HubSpot, enregistrée localement ? → non : message clair, rien ne change.
- Fiche d'une autre instance : 404.
- Corps de note HubSpot en HTML avec balises et entités : texte lisible.

---

### Task 1: Données (migration 0016, probabilité des étapes)

- Files: `src/crm/schema.ts`, `src/connecteurs/hubspot/reglages.ts` (`Etape.probabilite`), `src/connecteurs/hubspot/mapping.ts` (`mapStages`), `drizzle/0016_fiches.sql`, tests `hubspot.test.ts`.
- Steps: test `mapStages` → `probabilite` (0.2 → 20, absent → null) ; colonnes `activites.opportunite_id`, `activites.entreprise_id`, `activites.titre`, `opportunites.etapes_dates` ; verify ; commit.

### Task 2: Copie HubSpot de l'historique et des dates d'étape

- Files: `src/connecteurs/hubspot/{client,mapping,sync}.ts`, `test/hubspot-portal.ts` (objets `notes`, `calls`, `emails`, `meetings` + associations), `hubspot.test.ts`.
- Interfaces: `mapEngagement(type, h): { type, titre, resume, at }` ; `texteBrut(html: string, max = 2000): string`.
- Steps: tests (note copiée avec ses liens, corps sans HTML et tronqué, appel/email/réunion, `etapes_dates` depuis `hs_date_entered_<id>`) → échec → implémentation (lecture incrémentale comme les autres objets ; objets lus seulement si l'objet « contacts » est synchronisé) → succès → commit.

### Task 3: Écritures HubSpot

- Files: `src/connecteurs/hubspot/write.ts`, `hubspot.test.ts`.
- Steps: tests exacts des requêtes `deal.update`, `deal.associer` (PUT `/crm/v4/objects/deals/:id/associations/default/contacts/:cid`), `company.update`, `contact.update` (nom, entreprise), `note.create` (types d'association 202, 190, 214) et simulation → implémentation → commit.

### Task 4: Service et API des fiches

- Files: `src/crm/fiches.ts`, `src/crm/fiches.test.ts`, `src/api/routes.ts`, `src/crm/pipeline.ts` (`etapes_dates` mis à jour au changement d'étape).
- Interfaces: `getFiche(db, instance, kind, id, deps)`, `updateFiche(db, instance, kind, id, patch, deps)`, `ajouterNote(db, instance, kind, id, { corps, hubspot }, deps)`.
- Steps: tests (affaire : à venir, historique trié avec activités faites et changements d'étape, jours par étape ; contact/entreprise : liens ; modification locale et HubSpot, simulation ; note OS / HubSpot ; validation et 404 inter-instances) → implémentation → commit.

### Task 5: Écran Fiche et points d'entrée

- Files: `web/src/pages/Fiche.tsx`, `web/src/pages/fiche/*.tsx`, `web/src/App.tsx` (route), `web/src/api.ts`, `web/src/pages/{Pipeline,Entreprises,Contacts,Taches}.tsx` (liens), suppression de `Fiches.tsx` une fois remplacé, tests `web/src/pages/Fiche.test.tsx`.
- Steps: tests (champ modifié au crayon → PATCH ; note → POST ; barre d'étapes cliquable → PATCH étape ; Perdue demande le motif ; historique filtré ; ouverture depuis une carte du pipeline) → implémentation → verify → navigateur → PR, CI verte, merge.
