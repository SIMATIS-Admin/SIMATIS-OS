# Base vivante

## Contexte
Marc veut une base de prospection enrichie, reliée au CRM et à l'historique, pour
ne jamais recontacter quelqu'un sans le savoir. Ses sources sont **très
hétérogènes** : tout format, toute taille, colonnes nommées et ordonnées
n'importe comment, informations incomplètes. Le cœur du chantier est donc
l'**homogénéisation** : transformer n'importe quel fichier en fiches propres,
dédoublonnées et prêtes pour la prospection. Volet « Bases vivantes » du M4 de
`docs/plan.md`.

## Règle fondatrice : rien n'entre dans la base sans être homogénéisé
- Toute donnée entrante passe d'abord par un **sas** (tables `base_imports` +
  `base_lignes_brutes`), séparé de la base vivante.
- Le sas lit, met en correspondance, nettoie, complète et rapproche (étapes
  1 à 6 ci-dessous). La base vivante ne reçoit que des fiches au **format
  homogène**, après validation de Marc.
- Un **seul point d'entrée** en code vers `base_vivante` (fonction
  d'intégration). Aucune autre route (API, MCP, routine Claude, saisie) ne peut y
  écrire directement. Claude corrige dans le sas, jamais dans la base.
- Des tests garantissent la règle : une fiche incomplète ou non normalisée ne
  peut pas être intégrée.

## Seuils et zones de la base (décidé le 12/10/2026)
- **Minimum pour sortir du sas** : entreprise + nom (homogénéisés).
- La base vivante a deux zones :
  - **À enrichir** : entreprise + nom, sans email ni téléphone exploitable ;
  - **Prospectable** : au moins un email valide ou un téléphone.
  Une fiche passe d'« À enrichir » à « Prospectable » dès qu'un moyen de contact
  valide est ajouté (enrichissement), sans repasser par l'import.
- **Une fiche « À enrichir » ne peut jamais entrer dans le CRM** (tables
  `contacts`/`entreprises` d'une instance, et donc HubSpot par la synchro).
  Garde-fou dans le code du passage base → CRM + test dédié.
- **Lignes sous le minimum** (sans entreprise ou sans nom) : restent dans le
  sas, avec la raison, complétables plus tard puis intégrables.
- **Entrée dans le CRM au premier contact** : une fiche « Prospectable » reste
  dans la base vivante tant qu'elle n'a pas été contactée ; le premier mail ou
  appel pour un mandat la crée dans le CRM de ce mandat (lien conservé entre la
  fiche et le contact CRM, pour l'historique et les doublons).

## Rapprochement avec une boîte mail (demandé le 12/10/2026)
Cas d’usage : un fichier de plusieurs milliers de lignes déjà en partie exploité depuis la boîte
d'un mandat. À l'import, et à la demande ensuite, l'OS parcourt la boîte
Gmail du mandat sur une période choisie et met à jour chaque fiche.
- Faisable avec l'existant : connecteur Gmail par instance en lecture seule
  (`gmail.readonly` dans `src/connecteurs/google/oauth.ts`, client
  `googleApi`/`historique` dans `src/connecteurs/google/google.ts`).
- Méthode : une seule passe sur les messages de la période (en-têtes seulement,
  par paquets), puis rapprochement par email normalisé avec le fichier — pas une
  recherche par contact (des milliers de requêtes).
  - **Envoyés** à l'adresse → contacté (date, mandat, canal mail).
  - **Reçus** de l'adresse → a répondu.
  - **Retours en erreur** (mailer-daemon/postmaster, `X-Failed-Recipients`,
    corps du rapport lu seulement pour ces messages) → email invalide.
  - **Réponses automatiques** (absence, départ de l'entreprise) → signalées.
- Résultat sur la fiche : dernier contact AAAA/MM, résultat, email invalide ;
  rapport « X contactés, Y réponses, Z bounces, reste N jamais contactés ».
- Le rapprochement se fait dans le sas (avant intégration) et peut être relancé
  sur la base existante.
- **Période : depuis le début du mandat.** L'instance n'a pas cette date
  (`src/instances/schema.ts` n'a que `createdAt`) → ajouter un champ « date de
  début du mandat », réglable dans les paramètres de l'instance.
- **Réponses classées par Claude** (routine, avec outils MCP de lecture du sas) :
  intéressé / pas intéressé / « ne plus me contacter » (→ opposition, prioritaire
  sur tout) / mauvais interlocuteur / réponse automatique. Marc vérifie dans
  l'aperçu avant intégration.
- **Ceux qui ont répondu entrent dans le CRM du mandat** (contact + activité
  « email » datée), via le point d'entrée base → CRM. Pour un mandat sous
  HubSpot, l'écriture suit le double verrou existant (dry-run par défaut,
  `src/connecteurs/hubspot/write.ts`). Les contactés sans réponse restent dans la
  base vivante avec leur dernier contact.
- Lecture seule : aucune écriture dans la boîte. Contenu des mails jamais
  stocké en dehors de la base locale, jamais dans le dépôt.

## Décisions (12/10/2026)
- Doublons : tous mandats confondus, **alerte sans blocage**.
- Historique : **CRM de l'OS** (contacts + activites de toutes les instances)
  **+ boîte Gmail du mandat** (voir rapprochement ci-dessus).
- Recontact : alerte pendant **6 mois** après le dernier contact.
- Provenance scindée : **source** (Sharp, LinkedIn…) et **mandat**.
- Tous les groupes de champs complémentaires retenus.
- Homogénéisation **code + Claude** : le code traite le régulier, une routine
  Claude traite les cas difficiles, Marc valide un aperçu avant import.
- Volume très variable → traitement par lots en tâche de fond, Claude ne voit
  jamais le fichier entier (en-têtes, échantillon, lignes signalées).
- Tout format accepté (CSV, Excel, copier-coller, PDF et autres via Claude).
- Civilité manquante : **déduite du prénom et marquée « déduite »**.

## Fiche homogène (sortie)
- Identité : entreprise, civilité (+ indicateur « déduite »), prénom, NOM, email,
  ligne directe.
- Provenance : source, mandat, lot d'import, date de collecte.
- Historique : dernier contact AAAA/MM ou NA (calculé), canal, résultat, nombre,
  mandat qui a contacté, statut de prospection.
- Anti-doublon : email normalisé, URL LinkedIn, SIREN, domaine.
- Ciblage : fonction, niveau de décision, secteur (NAF), effectif, région.
- Conformité : opposition, email invalide, exclusion (client, partenaire,
  concurrent).
- Automatisation : niveau de complétude, score de priorité, signal, campagne.

## Chaîne d'homogénéisation
1. **Lecture** : CSV (séparateur et encodage détectés), Excel multi-onglets,
   texte collé ; ligne d'en-tête retrouvée même sous des lignes de titre.
2. **Correspondance des colonnes** : dictionnaire de synonymes (« Mail »,
   « E-mail pro », « Raison sociale », « Tél. direct »…) ; colonnes inconnues
   envoyées à Claude ; correspondance **mémorisée par source** (un format déjà vu
   passe sans question).
3. **Nettoyage par ligne** : découpage « Prénom NOM » et casse, civilité
   normalisée ou déduite (liste publique de prénoms, ex. fichier INSEE), email et
   téléphone normalisés (E.164), domaine/entreprise déduits de l'email.
4. **Cas difficiles → Claude** : cellules qui mélangent nom, poste et société,
   formats non tabulaires (PDF, listes), colonnes ambiguës.
5. **Complétude** : *prospectable mail*, *prospectable téléphone*, *à enrichir* ;
   lignes rejetées conservées avec leur raison.
6. **Rapprochement** : clé email > LinkedIn > prénom + NOM + domaine/SIREN, contre
   la base vivante et `contacts` de toutes les instances ; fusion des doublons
   internes au fichier.
7. **Aperçu → validation par Marc → import**, avec rapport (créées, fusionnées,
   alertes, rejetées).

## Point d'architecture
- Tables CRM isolées par instance (RLS : `instanceIsolation`/`metierColumns` de
  `src/db/columns.ts`). Nouvelles tables `base_vivante`, `base_imports`,
  `base_correspondances` (mémoire par source) dans l'instance SIMATIS, même
  pattern que `src/crm/schema.ts`.
- Contrôle tous mandats : service en lecture seule hors RLS qui ne renvoie que la
  correspondance (instance, date, canal, résultat). Voir si l'outil MCP
  `historique_contact` (`src/routines/outils-mcp.ts`) se réutilise.
- Partie Claude : nouvelle routine (clé ajoutée à `CleRoutine` dans
  `src/routines/schema.ts`) + skill, lancée par le runner existant
  (`src/runner/runner.ts`), avec des outils MCP dédiés : lire l'échantillon d'un
  import, proposer une correspondance, corriger des lignes signalées.
- Lecture Excel : ajout d'une dépendance (à choisir, maintenue et sans
  vulnérabilité connue).
- Fichiers et données réelles jamais dans le dépôt ; tests sur fichiers fictifs.

## Découpage en livraisons
- **L0 — chaîne déterministe** : tables, lecture CSV/Excel/collé, dictionnaire +
  mémoire par source, nettoyage, complétude, aperçu, import par lots, écran
  « Bases vivantes » minimal.
- **L1 — doublons et historique** : rapprochement tous mandats, dernier contact,
  alertes (6 mois, opposition, exclusion), filtres, export CSV.
- **L2 — rapprochement boîte mail** : date de début du mandat, passe Gmail
  (envoyés, réponses, bounces, réponses automatiques), mise à jour des fiches,
  rapport ; premier cas réel : un fichier de mandat déjà en partie exploité.
- **L3 — routine Claude** : classement des réponses, colonnes inconnues,
  cellules mélangées, PDF et autres formats ; entrée dans le CRM des contacts
  ayant répondu.
- **Plus tard** : enrichissement (SIREN, NAF, effectif), score, branchement sur la
  Prospection (lots de brouillons), base commune partenaire.

## Vérification
- `npm run verify` vert à chaque livraison ; tests sur fichiers fictifs
  volontairement « sales » (séparateurs, en-têtes décalés, noms collés, civilités
  variées, doublons internes, 20 000 lignes).
- Navigateur : importer ces fichiers, vérifier l'aperçu, la correspondance
  mémorisée au second import, les alertes de doublons, l'export.
- Une branche par livraison depuis `origin/main`, PR, CI verte, merge.
