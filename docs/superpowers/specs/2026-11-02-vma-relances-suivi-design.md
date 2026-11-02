# Test de VMA : relances et suivi des invitations

Date : 2026-11-02. Statut : spec à relire par Marc.

## Objectif

Ne plus laisser sans suite une invitation au Test de VMA restée sans réponse, et voir en un coup d'œil où en est chaque envoi, dans la fenêtre Test de VMA (section Diagnostic).

Marc peut :

- relancer à la main une invitation sans réponse, d'un clic, par un mail de rappel ;
- laisser une routine relancer seule, 7 jours après l'envoi ;
- suivre chaque invitation : envoyée, relancée, mail ouvert, lien cliqué, test passé ;
- choisir le vouvoiement (par défaut) ou le tutoiement, dans l'invitation comme dans la relance.

Hors périmètre : relances multiples, modèles de relance éditables, SMS.

## Constats sur l'existant

- Le mail part de la messagerie de l'instance via `envoyerInvitation` (`src/vma/invitations.ts`), avec dry-run par défaut et double verrou d'écriture.
- Le lien du mail pointe vers le site (`/test-vma?i=<invitationId>`) : le site voit l'ouverture du lien. L'OS tire déjà les résultats du site par une relève (`src/vma/releve.ts`).
- `vma_tests` ne garde aucune date d'envoi ni de relance.
- Les essais (`type = 'essai'`) sont relancés comme les premiers tests.

## 1. Données (`vma_tests`)

Nouvelle migration, colonnes ajoutées :

| Colonne | Type | Rôle |
| --- | --- | --- |
| `tutoiement` | booléen, défaut `false` | Registre du mail ; la relance l'hérite |
| `envoyee_le` | timestamp, nul | Date du dernier envoi réel de l'invitation |
| `relances` | jsonb, défaut `[]` | Liste de `{ le, origine: 'manuelle' \| 'auto' }`, envois réels seulement |
| `mail_ouvert_le` | timestamp, nul | Première ouverture du mail (relève du site) |
| `lien_ouvert_le` | timestamp, nul | Premier clic sur le lien (relève du site) |
| `echec_envoi` | text, nul | Dernière raison d'échec d'envoi, effacée à l'envoi suivant réussi |
| `relance_auto` | booléen, défaut `true` | Faux pour les invitations d'avant la routine : Marc les relance à la main |

Les invitations existantes n'ont pas de `envoyee_le` : on prend `created_at` comme date d'envoi pour celles qui ont une adresse e-mail (l'envoi se faisait à la création).

## 2. Mails

- `mailInvitation` reçoit `tutoiement`. Même gabarit ; seule la formulation change (« Voici votre lien » / « Voici ton lien », « copiez » / « copie »).
- `mailRelance` (nouveau) : même gabarit, même bouton et même lien. Texte court de rappel, objet du type « Rappel : votre test VMA ({entreprise}) ». Variante tutoiement.
- Salutation inchangée : prénom seul (`salutation()`).
- Le texte de relance ne cite que le nom de l'entreprise et la date d'expiration.

## 3. Bouton « Relancer »

- Affiché sur une invitation `envoyee`, non expirée, avec adresse e-mail.
- Ouvre une confirmation avec une case « Tutoyer », préremplie par `tutoiement`. Un changement met aussi à jour `tutoiement` de l'invitation.
- Envoi par le chemin existant (`writeVia`, double verrou). Une simulation affiche « simulée » et n'est pas comptée comme relance ; un envoi réel ajoute `{ le, origine: 'manuelle' }` à `relances`. Un échec est consigné dans `echec_envoi` et affiché.
- Nouvelle route API dans `src/vma/routes.ts`, refus 409 si l'invitation est utilisée, révoquée, expirée ou sans adresse.

## 4. Routine de relance automatique

- Éligible : invitation `envoyee`, `relance_auto` vrai (les invitations d'avant la routine en sont exclues, la migration les met à faux), non expirée, avec adresse, `envoyee_le` il y a 7 jours ou plus, et `relances` vide (une seule relance auto ; une relance manuelle déjà faite l'empêche).
- Passage quotidien le matin (à partir de 8 h, heure de Paris), lancé par le serveur comme la relève du site. Interrupteur : variable serveur `VMA_RELANCE_AUTO` (active par défaut) ; Paramètres > Routines est réservé aux routines Claude.
- Même chemin d'envoi que le bouton : dry-run par défaut, écriture réelle seulement avec le double verrou. Origine `auto`.
- Idempotente : un second passage le même jour n'envoie rien.

## 5. Suivi dans la fenêtre Test de VMA

Sur chaque ligne d'invitation, une frise :

`Envoyé 12/10 → Relancé 19/10 (auto) → Mail ouvert → Lien cliqué → Test passé`

- Les étapes non atteintes sont grisées.
- Un filtre « Sans réponse depuis plus de 7 jours ».
- Un échec d'envoi apparaît dans la frise avec sa raison.
- « Reçu » n'est pas garanti : on montre « envoyé », et « rejeté » quand la messagerie renvoie une erreur d'adresse.
- L'ouverture du mail est indicative (Apple Mail et Gmail peuvent précharger les images) ; le clic est fiable.

## 6. Site Web SIMATIS (autre dépôt, PR séparée)

- Pixel d'ouverture à identifiant d'invitation, inclus dans le gabarit des mails.
- Enregistrement du premier clic quand `/test-vma?i=<id>` est chargé.
- Ces deux dates sont ajoutées aux données que la relève renvoie à l'OS.

Tant que le site n'est pas à jour, l'OS n'affiche que l'envoi et les relances.

## 7. Livraison

1. **Livraison 1 (OS)** : données, mails (vouvoiement/tutoiement), bouton, routine, frise d'envoi et de relance. Marc peut relancer ses invitations en attente dès ici.
2. **Livraison 2 (site + OS)** : pixel, clic, relève, ouverture et clic dans la frise.

## 8. Tests

- Mails : invitation et relance, en vouvoiement et en tutoiement.
- Bouton : refus pour utilisée, révoquée, expirée, sans adresse ; une simulation ne compte pas ; la case « Tutoyer » met à jour l'invitation.
- Routine : cas à 6 jours (non), 7 jours (oui), déjà relancée à la main (non), expirée (non), second passage (idempotent).
- Relève : ouverture et clic rattachés à la bonne invitation, jamais écrasés par une date plus tardive.
- Interface : frise, filtre, bouton et case « Tutoyer ».
- Données de test fictives uniquement.
