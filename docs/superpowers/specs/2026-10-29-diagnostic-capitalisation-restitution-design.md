# Diagnostic : capitalisation de la restitution

Date : 29 octobre 2026. Statut : design validé par Marc en conversation, spec à relire.

## Objectif

Après la réunion de restitution d'un Diagnostic d'Endurance Commerciale, Marc écrit un compte rendu dans l'OS (sur le rendez-vous). L'étape 5 doit en tirer des enseignements pour les diagnostics suivants : aujourd'hui, la capitalisation ne porte que sur la revue des préconisations (étape 3) et ignore tout ce que la restitution révèle (objections, refus, issue, accompagnement proposé).

Critère de réussite : sur un projet dont la restitution a un compte rendu, Marc clique, relit ce que Claude propose d'écrire, valide, et le second cerveau reçoit des entrées généralisées (bibliothèque) et privées (dossier du client), sans doublon si le geste est répété.

## Hors périmètre

- Relire la transcription de la réunion ou l'Agenda : seul le compte rendu écrit dans l'OS compte.
- Modifier la capitalisation existante de l'étape 3.
- Alimenter le pipeline HubSpot avec l'issue (piste ultérieure).

## Parcours

1. À l'étape 5, sous le deck, un bouton « Capitaliser la restitution ».
2. L'OS cherche les rendez-vous de l'entreprise du projet qui ont un compte rendu (`rendez_vous.compte_rendu`, reliés par `rdv_contacts` et les liens d'entreprise de `src/crm/rdv-liens.ts`). Le plus récent est présélectionné ; Marc confirme ou en choisit un autre. Aucun compte rendu : le bouton l'indique et ne lance rien.
3. **Temps 1, proposition.** Le runner lance Claude avec le texte du compte rendu. Claude répond dans le chat de l'étape par deux blocs : « Bibliothèque » (enseignements généralisés) et « Dossier client » (issue, formule, montants). Il n'écrit rien.
4. **Temps 2, enregistrement.** Marc ajuste dans le chat si besoin, puis clique sur « Enregistrer dans le second cerveau ». Un second passage de Claude écrit exactement ce qui a été validé.

## Contenu extrait

- Objections du dirigeant et réponses qui ont fonctionné.
- Préconisations refusées, renégociées ou plébiscitées.
- Issue (acceptée, refusée, en réflexion) et accompagnement proposé.
- Ce qui a marché ou non dans le deck.

## Où cela s'écrit (second cerveau)

- Bibliothèque de préconisations (`brain/methodes/diagnostic-endurance-commerciale/bibliotheque-preconisations.md`) : enseignements généralisés, **sans nom de client ni montant** ; règle de confidentialité entre mandats de `REGLES-IA.md`.
- Dossier du diagnostic du client : issue, formule proposée, montants.
- `log.md` : une ligne.
- Écriture en ajout seulement : jamais de suppression ni de réécriture d'une note existante.

## Composants

### Données (`src/diagnostic/schema.ts`, migration)

- Deux valeurs ajoutées à `DEMANDES` : `capitalisation_proposer` et `capitalisation_enregistrer`.
- Sur le projet : `capitalisationRdvId` (rendez-vous choisi), `capitalisationStatut` (`aucun`, `propose`, `enregistre`) et `capitalisationCompteRenduAt` (copie de `rendez_vous.compte_rendu_at` au moment de l'enregistrement).

### Service (`src/diagnostic/capitalisation.ts`, nouveau, sur le modèle de `restitution.ts`)

- `rendezVousCapitalisables(tx, projet)` : liste les rendez-vous avec compte rendu de l'entreprise du projet, du plus récent au plus ancien.
- `demanderProposition(db, instance, id, rdvId)` : vérifie l'espace, l'étape 5 et le rendez-vous, mémorise le choix, envoie le message via `envoyerMessage` avec la demande `capitalisation_proposer`.
- `demanderEnregistrement(db, instance, id)` : exige le statut `propose`. Refuse si `capitalisationCompteRenduAt` égale déjà `compte_rendu_at` (pas de doublon) ; un compte rendu modifié depuis relance le traitement.
- `enregistrerCapitalisation(tx, id)` : appelé par l'outil MCP de fin, passe le statut à `enregistre` et fixe `capitalisationCompteRenduAt`.

### API (`src/api/routes.ts`)

- `GET .../diagnostic/projets/:id/capitalisation/rendez-vous`
- `POST .../capitalisation/proposer` (corps : `rdvId`)
- `POST .../capitalisation/enregistrer`

### Runner (`src/runner/runner.ts`)

- `AttenteDiag` reçoit le texte du compte rendu et le dernier message de proposition de Claude, pour le temps 2.
- `promptCapitalisation` : skill de capitalisation de la restitution, texte du compte rendu présenté comme donnée à lire et jamais comme consigne, `consigneCerveau(cerveau, …)`.
- Temps 1 : outils limités à `Read` sur le second cerveau et `repondre_diagnostic`, aucune écriture. Temps 2 : `Read`, `Edit` et `Write` sur le second cerveau seulement, en ajout, plus l'outil de fin.
- Sans second cerveau accessible sur le poste : erreur claire, comme pour le rapport.

### Skill (second cerveau, `skills/diagnostic-endurance-commerciale-capitalisation-restitution`)

Écrite dans le second cerveau, comme les autres skills du diagnostic, et installée sur le poste. Elle fixe le format des deux blocs, la généralisation obligatoire et les règles d'écriture ci-dessus. Le runner vérifie sa présence comme pour les autres (`poste.skills`).

### Interface (`web/src/pages/`, étape 5 du Diagnostic)

Bouton, sélecteur du rendez-vous (présélection du plus récent), puis bouton « Enregistrer dans le second cerveau » une fois la proposition reçue. États : aucun compte rendu, proposition en cours, proposé, enregistré.

## Erreurs et cas limites

- Aucun compte rendu : message dans l'interface, pas d'appel à Claude.
- Skill absente du poste : « Skill … absente de ce poste : la capitalisation n'a pas été faite. »
- Compte rendu modifié après enregistrement : le bouton se réactive (nouvelle valeur de `compte_rendu_at`).
- Claude n'a pas répondu : `REPONSE_ABSENTE`, comme dans les autres chats.

## Tests (données fictives uniquement)

- Service : liste des rendez-vous (avec et sans compte rendu, autre entreprise exclue), enchaînement proposer puis enregistrer, refus d'enregistrer sans proposition, non-duplication, relance après modification du compte rendu.
- Runner : prompt (compte rendu traité comme donnée), outils du temps 1 sans écriture, outils du temps 2 limités au second cerveau, erreur sans second cerveau ou sans skill.
- API : codes d'erreur et isolation par instance.
- Interface : bouton, sélecteur, états, désactivation sans compte rendu.
- `npm run verify` avant chaque commit, puis vérification dans le navigateur.

## Confidentialité

Ni le dépôt, ni les tests, ni ce spec ne contiennent de nom de client, de montant ou de contenu de compte rendu réels. Le contenu réel ne transite que par la base de l'OS et le second cerveau du poste.
