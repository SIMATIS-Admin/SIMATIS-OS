# Prospection, maquette : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'écran Prospection de la maquette interactive par le parcours de campagne du spec (relances de tâches et prospection à froid), avec statistiques partagées avec le Brief du jour et une gestion des signatures.

**Architecture:** La maquette `maquettes/os-commercial/` est une application JS sans build (scripts chargés par `index.html`, vues dans `VIEWS`, actions dans `ACTIONS`, état `S` persisté en localStorage). Un nouveau fichier `js/v-prospection.js` porte tout le parcours et les statistiques ; l'ancienne vue est retirée de `js/v-demande.js`. Les données fictives vivent dans `js/data.js`.

**Tech Stack:** HTML/CSS/JS sans dépendance, comme le reste de `maquettes/` (ignoré par prettier et eslint). Pas de test automatisé possible : chaque tâche se vérifie dans le navigateur (voir « Vérification »).

**Spec:** `docs/superpowers/specs/2026-10-30-prospection-design.md`

## Global Constraints

- Données **fictives uniquement** (dépôt public) : jamais de nom de client, contact, partenaire ni coordonnée réelle ; les images de signature de Marc ne sont **pas** dans le dépôt, la maquette utilise des signatures fictives (texte et pastille).
- Interface en français ; salutation « Bonjour Prénom, » ; vouvoiement ; fin « Bien à vous, » puis signature choisie.
- 4 touches maximum par défaut, réglable par campagne ; « épuisé » seulement sur confirmation (au cas par cas ou en lot).
- Créneaux : 3, entre 1 et 2 semaines après l'envoi, jamais un mercredi (jours non travaillés de l'instance fictive) ; liste à puces.
- Suivi : 2 à 3 semaines par défaut (14 à 28 jours), ou 1 à 2 mois (30 à 60 jours), ou date précise ; échéances étalées sur les jours travaillés ; canal d'origine conservé ; refus : aucun suivi ; tâche MAIL en retard sans mail : +7 jours.
- Relances : tâche de suivi HubSpot (instance avec CRM) ; froid : tâche dans l'OS.
- « Valider et envoyer » grisé tant que les deux verrous (variable serveur, interrupteur admin) ne sont pas tous deux ouverts ; « Mettre en brouillons Gmail » toujours disponible.
- Compteur du jour, objectif réglable (30 par défaut) ; mêmes chiffres dans le Brief du jour.
- Changer le schéma des données fictives impose de bumper `STORE_KEY` (`js/core.js:3`, aujourd'hui `simatis-os-maquette-v6`) pour ne pas relire un ancien état.
- Branche `feature/prospection-maquette`, commits explicites (jamais `git add -A`), relire `git diff --staged` avant chaque commit.

## Review Focus

- Échantillon froid vide (tout exclu) : message clair, bouton de rédaction désactivé.
- Tâche de relance sans fil Gmail retrouvé : le mail est marqué « À vérifier » et n'est pas envoyé tant que Marc ne l'a pas ouvert.
- Contact « épuisé » : ne réapparaît jamais dans un échantillon ; sa confirmation ne se fait jamais automatiquement.
- Signature supprimée ou par défaut supprimée : les campagnes retombent sur « Aucune », sans erreur.
- Verrous : un seul ouvert sur deux ne suffit pas à activer l'envoi direct.
- Objectif du jour à 0 ou dépassé : la jauge ne dépasse pas 100 % et ne divise pas par zéro.
- Mail clos (refus) : aucune tâche de suivi créée.

## Vérification (valable pour toutes les tâches)

Servir `maquettes/os-commercial/` en tâche de fond suivie (par exemple `npx http-server maquettes/os-commercial -p 4173`, jamais avec `&`), ouvrir `http://localhost:4173/` dans le navigateur de l'app, cliquer « Tout réinitialiser » (bas du menu) après chaque changement de données, puis contrôler la console (aucune erreur) et l'écran. Arrêter le serveur en fin de travail.

## File Structure

- Create `maquettes/os-commercial/js/v-prospection.js` : statistiques, signatures, parcours de campagne, relecture, envoi, épuisés, panneau du Brief. Chargé après `v-demande.js`.
- Modify `maquettes/os-commercial/js/v-demande.js` : retirer la vue et les actions de l'ancienne prospection (lignes ~273 à 357 : `REGLES`, `CIBLE_DEFAUT`, `FICTIFS`, `VIEWS.prospection`, actions `camp-*`), en gardant `contact-new` / `contact-new-ok` si une autre vue les utilise (vérifier par recherche).
- Modify `maquettes/os-commercial/js/data.js` : données fictives de prospection par instance.
- Modify `maquettes/os-commercial/js/core.js` : `STORE_KEY`, état `S.camp`.
- Modify `maquettes/os-commercial/js/v-pilotage.js` : panneau « Prospection du jour » dans `VIEWS.brief`.
- Modify `maquettes/os-commercial/js/v-plateforme.js` : onglets Signatures et Verrous d'envoi dans `VIEWS.parametres`.
- Modify `maquettes/os-commercial/index.html` (balise script), `css/app.css` (styles du compteur et de la relecture), `LISEZ-MOI.md`, `docs/plan.md` (ligne Prospection).

---

### Task 1: Données fictives, statistiques et fichier de vue

**Files:**
- Create: `maquettes/os-commercial/js/v-prospection.js`
- Modify: `maquettes/os-commercial/js/data.js`, `js/core.js:3`, `index.html`

**Interfaces:**
- Produces, dans `data.js` (clé `prospection` de chaque instance qui a le module `prospection`) :
  `{ objectifJour: number, themes: string[], signatures: Signature[], verrous: { serveur: boolean, admin: boolean }, occurrences: Occurrence[], froid: ContactFroid[] }` avec
  `Signature = { id: string, nom: string, defaut: boolean }`,
  `Occurrence = { id: string, date: string /* AAAA-MM-JJ */, contact: string, soc: string, theme: string, touche: number, etat: 'envoye' | 'reponse' | 'rdv', campagne: string }`,
  `ContactFroid = { id: string, nom: string, soc: string, fonction: string, touches: number, statut: 'jamais' | 'contacte' | 'repondu' | 'epuise', derniere: string | null }`.
  Les tâches de relance sélectionnables sont les entrées de `D().taches` portant `relance: { touche: number, fil: string }` (fil = intitulé fictif du fil Gmail).
- Produces, dans `v-prospection.js` : `prospStats(): { jour: number, objectif: number, semaine: number, reponses: number, rdv: number, parTheme: Record<string, number>, parTouche: Record<number, number>, aConfirmer: number }`.

- [ ] **Step 1:** Dans `data.js`, ajouter la clé `prospection` à l'instance SIMATIS (au moins 14 occurrences datées d'aujourd'hui, une soixantaine sur la semaine, trois thèmes, 2 signatures fictives « Simatis » et « Simatis et Kairos », 25 contacts froids dont 18 `contacte` avec `touches >= 4` pour `aConfirmer`, 6 tâches de relance dans `taches` avec `relance`), et une version réduite pour les mandats ; bumper `STORE_KEY` en `v7`.
- [ ] **Step 2:** Implémenter `prospStats()` dans `v-prospection.js` (jour = occurrences datées `dp(0)`, semaine = 7 derniers jours, `aConfirmer` = contacts `contacte` avec `touches >= 4`) ; ajouter `<script src="js/v-prospection.js">` après `v-demande.js` dans `index.html`.
- [ ] **Step 3:** Vérifier : après « Tout réinitialiser », `prospStats()` dans la console renvoie `jour: 14`, `objectif: 30`, `aConfirmer: 18`, sans erreur de chargement.
- [ ] **Step 4:** Commit `feat(maquette): données fictives et statistiques de prospection`.

### Task 2: Signatures (Paramètres)

**Files:**
- Modify: `maquettes/os-commercial/js/v-plateforme.js` (`VIEWS.parametres`), `js/v-prospection.js`

**Interfaces:**
- Consumes: `D().prospection.signatures`.
- Produces: `signatures(): Signature[]` et `signatureParDefaut(): string /* id ou 'aucune' */`, actions `sig-add`, `sig-rename`, `sig-replace`, `sig-delete`, `sig-default`.

- [ ] **Step 1:** Ajouter un onglet « Signatures » dans Paramètres (même mécanique que `S.paramTab`) : liste des signatures avec pastille d'aperçu, boutons Renommer, Remplacer l'image (simulation : toast), Supprimer, case « par défaut » ; bouton « Ajouter une signature » (modale nom + image simulée).
- [ ] **Step 2:** Supprimer la signature par défaut ou une signature utilisée par `S.camp` doit retomber sur `'aucune'` sans erreur.
- [ ] **Step 3:** Vérifier dans le navigateur : ajouter, renommer, supprimer, changer le défaut ; aucune erreur console.
- [ ] **Step 4:** Commit `feat(maquette): gestion des signatures`.

### Task 3: Accueil de la section Prospection

**Files:**
- Modify: `maquettes/os-commercial/js/v-demande.js` (retrait de l'ancienne vue), `js/v-prospection.js`, `css/app.css`

**Interfaces:**
- Consumes: `prospStats()`.
- Produces: `VIEWS.prospection` (remplace l'ancienne), états `S.camp = { mode: 'relance' | 'froid' | null, step: 'accueil' | 'choix' | 'reglage' | 'relecture' | 'fait', ... }`, action `camp-start` (`data-mode`).

- [ ] **Step 1:** Retirer de `v-demande.js` l'ancienne prospection et ses actions `camp-*` (garder `contact-new*` seulement si utilisé ailleurs, vérifié par recherche) ; vérifier que `bases` fonctionne toujours.
- [ ] **Step 2:** Implémenter l'accueil : compteur du jour en grand avec jauge plafonnée à 100 % (objectif 0 : jauge masquée), carte semaine (envoyés, réponses, rendez-vous), carte par thème, deux cartes d'entrée (« Relancer des tâches » avec nombre de tâches en retard et dues ; « Prospecter à froid » avec contacts disponibles et à relancer), ligne « Campagnes récentes » (lot, mails, réponses) et lien « Contacts épuisés à confirmer (n) ».
- [ ] **Step 3:** Vérifier : les chiffres égalent ceux de `prospStats()` ; les deux cartes passent à `step: 'choix'` avec le bon `mode`.
- [ ] **Step 4:** Commit `feat(maquette): accueil de la prospection`.

### Task 4: Choisir les contacts

**Files:**
- Modify: `maquettes/os-commercial/js/v-prospection.js`

**Interfaces:**
- Produces: `S.camp.sel: string[]` (ids de tâches pour `relance`, ids de contacts pour `froid`), `echantillonFroid(n: number, filtre: string): ContactFroid[]` (exclut `epuise`, `repondu`, et les contacts touchés depuis moins de 14 jours), actions `camp-toggle`, `camp-all`, `camp-sample`.

- [ ] **Step 1:** Mode relance : tableau des tâches avec case à cocher, tout sélectionner, contact, société, échéance, numéro de touche, fil Gmail retrouvé ; bouton « Continuer avec n tâches ». Une tâche sans fil est marquée « À vérifier ».
- [ ] **Step 2:** Mode froid : champ nombre (30 par défaut), filtre société ou secteur, règles d'exclusion affichées (déjà contactés récemment, invalides, clients, historique, épuisés) avec leurs effectifs fictifs, liste de l'échantillon, bouton « Tirer un autre échantillon ». Échantillon vide : message et bouton de continuation désactivé.
- [ ] **Step 3:** Vérifier : un contact `epuise` n'apparaît dans aucun échantillon (essayer 10 tirages) ; zéro sélection désactive « Continuer ».
- [ ] **Step 4:** Commit `feat(maquette): choix des contacts d'une campagne`.

### Task 5: Régler la campagne

**Files:**
- Modify: `maquettes/os-commercial/js/v-prospection.js`

**Interfaces:**
- Produces: `S.camp.reglage = { offre: 'diagnostic' | 'vma' | 'les-deux' | 'kairos', creneaux: boolean, signature: string, suivi: { type: 'courte' | 'longue' | 'date', date?: string }, touchesMax: number }` ; `echeancesSuivi(n: number, plage: [number, number], depuis: string): string[]` (n dates ISO étalées sur la plage, jamais un mercredi ni un week-end) ; actions `camp-set`, `camp-draft`.

- [ ] **Step 1:** Panneau unique : offre (4 choix, `vma` par défaut en relance), style (texte informatif « ton du fil »), créneaux (case cochée), signature (menu des signatures + « Aucune », défaut Task 2), prochain suivi (courte = 14 à 28 j par défaut, longue = 30 à 60 j, date précise), touches max (4, champ réglable, visible en froid seulement).
- [ ] **Step 2:** Implémenter `echeancesSuivi` ; vérifier dans la console que 6 échéances sur `[14, 28]` sont toutes des jours ouvrés hors mercredi et réparties sur au moins 4 dates distinctes.
- [ ] **Step 3:** Vérifier dans le navigateur que chaque réglage se conserve en revenant en arrière ; commit `feat(maquette): réglage de campagne`.

### Task 6: Rédaction et relecture en lot

**Files:**
- Modify: `maquettes/os-commercial/js/v-prospection.js`, `css/app.css`

**Interfaces:**
- Consumes: `S.camp.sel`, `S.camp.reglage`, `signatures()`, `echeancesSuivi`.
- Produces: `redigerBrouillon(contact: { nom: string, soc: string, touche: number }, reglage): { objet: string, corps: string[], creneaux: string[], suivi: { type: 'delai' | 'date' | 'clos', date?: string } }` ; `creneauxFictifs(depuis: string): string[]` (3 créneaux entre J+7 et J+14, jamais un mercredi) ; `S.camp.brouillons: Brouillon[]` ; actions `br-open`, `br-edit`, `br-skip`, `br-regen`, `br-suivi`.

- [ ] **Step 1:** `redigerBrouillon` produit un texte fictif court selon l'offre et la touche (angle différent à chaque touche), salutation par le prénom seul via `prenomDe`-équivalent local, créneaux en puces, « Bien à vous, » puis la signature choisie.
- [ ] **Step 2:** Écran de relecture : liste à gauche (état : prêt, à vérifier, écarté), brouillon éditable à droite, actions Modifier, Écarter, Régénérer, et bloc « Suivi » par mail : relancer dans N jours (valeur issue du réglage), date citée par le contact, dossier clos.
- [ ] **Step 3:** Vérifier : choisir « dossier clos » retire le suivi affiché ; écarter un mail le sort du total des boutons ; un mail « À vérifier » non ouvert bloque l'envoi avec un message.
- [ ] **Step 4:** Commit `feat(maquette): relecture en lot des brouillons`.

### Task 7: Envoi, occurrences et suivi

**Files:**
- Modify: `maquettes/os-commercial/js/v-prospection.js`, `js/v-plateforme.js` (onglet Verrous d'envoi)

**Interfaces:**
- Consumes: `S.camp.brouillons`, `D().prospection.verrous`.
- Produces: `envoyerLot(mode: 'brouillons' | 'envoi'): { mails: number, suivis: number, clos: number, reportes: number }` ; `envoiPossible(): boolean` (vrai seulement si `serveur && admin`) ; écran `step: 'fait'` avec résumé.

- [ ] **Step 1:** Onglet Paramètres « Verrous d'envoi » : deux interrupteurs (variable serveur, interrupteur admin) avec l'explication en une phrase de chacun.
- [ ] **Step 2:** Boutons de relecture : « Mettre en brouillons Gmail (n) » toujours actif ; « Valider et envoyer (n) » actif seulement si `envoiPossible()`, sinon grisé avec la mention « verrous fermés » et un lien vers Paramètres.
- [ ] **Step 3:** `envoyerLot` : crée une `Occurrence` par mail non écarté (`etat: 'envoye'` si mode envoi, sinon brouillon non compté dans le jour), une tâche de suivi par mail sauf `clos` (relance : tâche `canal` d'origine avec mention du CRM ; froid : tâche de l'OS), incrémente `touches` du contact froid, reporte de 7 jours les tâches MAIL en retard sans mail ; journalise via `logAction`. Écran de fin : n mails, n suivis créés, n dossiers clos, n tâches reportées, compteur du jour mis à jour.
- [ ] **Step 4:** Vérifier : après un lot de 6 relances avec 1 dossier clos, le résumé affiche 6 mails, 5 suivis, 1 clos ; le compteur de l'accueil augmente de 6 en mode envoi et de 0 en mode brouillons ; un seul verrou ouvert laisse « Valider et envoyer » grisé.
- [ ] **Step 5:** Commit `feat(maquette): envoi, occurrences et tâches de suivi`.

### Task 8: Contacts épuisés à confirmer

**Files:**
- Modify: `maquettes/os-commercial/js/v-prospection.js`

**Interfaces:**
- Produces: `S.camp.step = 'epuises'`, actions `epuise-ok` (un contact), `epuise-lot`, `epuise-garder`.

- [ ] **Step 1:** Écran listant les contacts `contacte` ayant atteint `touchesMax` sans réponse, avec nombre de touches et dernière date ; actions par ligne (« Marquer épuisé », « Garder ») et en lot (cases + « Marquer épuisés (n) »). Aucun passage automatique à `epuise`.
- [ ] **Step 2:** Vérifier : après confirmation, le contact disparaît de la liste, `aConfirmer` baisse, et il n'apparaît plus dans un échantillon ; « Garder » le retire de la liste sans le marquer.
- [ ] **Step 3:** Commit `feat(maquette): confirmation des contacts épuisés`.

### Task 9: Panneau dans le Brief du jour

**Files:**
- Modify: `maquettes/os-commercial/js/v-pilotage.js` (`VIEWS.brief`)

**Interfaces:**
- Consumes: `prospStats()`.

- [ ] **Step 1:** Ajouter dans le Brief un panneau « Prospection du jour » : mails envoyés sur objectif avec la même jauge, relances faites et restantes (tâches de relance du jour), réponses de la semaine, lien « Ouvrir la prospection ». Absent pour les instances sans module `prospection`.
- [ ] **Step 2:** Vérifier : les chiffres sont identiques à ceux de l'accueil Prospection, avant et après l'envoi d'un lot.
- [ ] **Step 3:** Commit `feat(maquette): prospection du jour dans le brief`.

### Task 10: Documentation, vérification finale et livraison

**Files:**
- Modify: `maquettes/os-commercial/LISEZ-MOI.md`, `docs/plan.md` (ligne Prospection de M4 et tableau de statut)

- [ ] **Step 1:** Mettre à jour la ligne « Prospection » du tableau de `LISEZ-MOI.md` et la ligne M4 de `docs/plan.md` (maquette prête ; construction réelle à planifier : table d'occurrences, génération par Claude, Gmail et HubSpot réels, import des signatures).
- [ ] **Step 2:** Parcours complet dans le navigateur, pour chaque point de Review Focus ; console sans erreur ; captures d'écran de l'accueil, du réglage et de la relecture pour Marc.
- [ ] **Step 3:** Arrêter le serveur de la vérification ; `npm run verify` (doit rester vert) ; relire `git diff` pour toute donnée réelle.
- [ ] **Step 4:** Ouvrir la PR, faire la revue de code, attendre la CI verte, merger (règles de `AGENTS.md`) ; mettre à jour dans le second cerveau `brain/outils/simatis-os-structure.md` et `brain/outils/simatis-os-feuille-de-route.md` et noter dans `log.md` ; expliquer à Marc, pas à pas, comment tester.
