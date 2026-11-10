# Plan de développement — SIMATIS OS

> Rien de confidentiel ici : les mandats, sociétés et personnes cités sont fictifs.
>
> Ce plan ne liste que ce qui **reste à faire**. Ce qui est livré vit dans le code, dans `README.md` (démarrage, administration) et dans `docs/EXPLOITATION.md` (sauvegarde, restauration). Mis à jour le 29 octobre 2026.

## Objectif

Un OS commercial pour la direction commerciale à temps partagé : l'IA prépare, le pilote décide.
SIMATIS a son propre espace, et chaque mandat a le sien, avec ses accès aux outils du client.
N'importe quel agent IA peut interroger l'OS et proposer des actions, sous les règles de l'OS.
La maquette `maquettes/os-commercial/` sert de référence fonctionnelle.

Chaque partie avance par branche, PR, revue et merge. À la fin de chacune, l'agent explique à Marc comment tester.

## Principes (toujours valables)

### Instances

- **SIMATIS** : l'instance propre, unique, branchée sur les outils de Marc.
- **Mandat en cours = une instance**, branchée sur les outils du client (son HubSpot, son Gmail, son agenda…).
- **Mandat prospect** : une instance de démonstration aux données fictives. Quand le prospect signe, elle devient un mandat en cours : données fictives retirées, outils du client à brancher.
- Les vrais noms des mandats ne figurent jamais dans le dépôt : ils vivent dans la configuration de l'instance, hors git.

Aucune instance ne lit les données d'une autre, avec une exception : SIMATIS lit ses mandats actifs en lecture seule, pour le super-administrateur seulement.

### Données et écritures

- Les données d'un mandat vivent dans les outils du client ; l'OS en garde une copie de travail, l'outil du client fait foi.
- Un agent ne modifie rien directement : il propose, Marc valide, sauf si le niveau d'autonomie de l'action l'autorise.
- Simulation par défaut ; le mode réel exige un double verrou (variable serveur + interrupteur admin).
- Aucun repli d'un mandat vers un autre.
- Secrets : un fichier par instance, `secrets/instances/<instance>.env`, jamais commité, jamais exposé par l'API, le MCP, le journal ni les logs.

### Architecture

Postgres ← cœur SimatisOS (services métier, règles, journal d'audit) ├─ API HTTP → interface web └─ serveur MCP → agents IA.
Le MCP passe par le cœur, jamais directement par la base. Cloisonnement imposé par le cœur et par Postgres (Row-Level Security). Une seule base partagée.

---

## Socle technique : à reprendre

Les sept briques du socle sont livrées (conteneurs, sauvegarde chiffrée avec test de restauration, instances et cloisonnement, propositions et autonomie, serveur MCP, cadre des connexions, interface web). Il reste deux décisions de Marc, qui ne bloquent rien :

- **Stockage des sauvegardes** : le dépôt restic est encore local au poste (donc sans protection contre une panne ou un vol). Choisir un fournisseur S3 en UE ou en Suisse (Infomaniak Swiss Backup, Scaleway, Backblaze EU…), avec un compte au nom de SIMATIS, puis renseigner `RESTIC_REPOSITORY` dans `.env`.
- **Mot de passe des sauvegardes** : `RESTIC_PASSWORD` à ranger dans un gestionnaire de mots de passe. Sans lui, les sauvegardes sont illisibles.

Limite connue : une donnée purgée en fin de mandat reste dans les sauvegardes jusqu'à expiration de la rétention, douze mois au plus.

## Parties métier : ce qui reste

### M1 — Objets commerciaux

Livré : entreprises, contacts, affaires, activités, tâches, rendez-vous, miroir HubSpot.

Reste :

- Refonte des fiches : carte « Participants » avec création d'un contact depuis un invité inconnu ; onglets Rendez-vous et Email dans la zone de saisie ; suppression de la table `rdv_liens`, qui n'est plus lue.
- Bases vivantes et routines : prendre en compte les emails multiples d'un contact (elles ne lisent encore que `contacts.email`).

### M2 — Pilotage

Livré : Brief du jour, Inbox, Tableau de bord, Paramètres, favoris.

Reste : rien d'identifié. À rouvrir seulement sur demande de Marc.

### M3 — Stratégie

Livré : Diagnostic d'endurance commerciale (cinq étapes), Tests de VMA, Atelier stratégique (bêta).

Reste :

- **Démarrage du mandat** : écran non construit (trame en sept blocs, trois situations de départ, profil d'entreprise sur trois dimensions). À repenser avec Marc au regard de l'Atelier stratégique, qui couvre déjà une partie du lancement.
- **Plan d'action** : à redéfinir comme une liste d'actions élémentaires à court, moyen et long terme.
- Diagnostic : le module réel est à finir de spécifier avec Marc. Décisions déjà prises : tout se fait dans l'OS, grille partagée dans le second cerveau, questions N/A exclues.

### M4 — Générer la demande

Livré : Bases vivantes, Site web (Analytics).

Reste :

- **Prospection** : livrée en cinq livraisons (socle et chiffres, relance de tâches, rattachement des tâches sans contact, prospection à froid, envoi direct derrière le double verrou, réponses depuis l'Inbox). Restent : régénérer un brouillon et changer l'intention d'une réponse depuis l'écran, import des vraies signatures par Marc, ouverture des écritures réelles. Spec : `docs/superpowers/specs/2026-10-30-prospection-design.md`.
- **Détection** : reportée, à repenser (d'où vient la donnée, ce qu'un clic doit produire).
- Bases vivantes : branchement sur la base de données commune en conception avec le partenaire.

### M5 — Convertir

Livré : Pipeline (miroir HubSpot, conversions, Gagnées/Perdues), Entreprises, Contacts, Agenda, Rendez-vous, Devis (instance SIMATIS seulement).

Reste :

- **Relais internes** (points mensuels avec les experts du mandat) : écran non construit.
- **Transfert entre instances, livraison 2b** : filtre « Tous les mandats » dans les listes (Contacts, Entreprises, Pipeline, Tâches, Rendez-vous), sans mélanger statistiques et montants entre mandats. Demande sa propre spécification.
- **Rôle de base dédié** (BYPASSRLS, droits limités) à la place de la connexion propriétaire du transfert, avant tout accès multi-utilisateurs.

### M6 — Instruments de bord

Livré : Routines Claude, Second cerveau (carte, édition, espace partagé), Journal d'audit.

Reste :

- **Écran Autonomie** (réglage des niveaux L0 à L3) : non construit ; le moteur existe.
- Niveaux d'autonomie par défaut d'un nouveau mandat : à trancher.
- Synchro vers le second cerveau : emplacement, rythme et contenu à finir de cadrer (fiches de synthèse, comptes rendus, décisions ; jamais de contacts ni de pipeline).

### M7 — L'IA au quotidien

Livré : outils MCP de base, de routines, d'Inbox, de bases vivantes, de diagnostic et du second cerveau.

Reste : les outils MCP « généralistes » prévus ne sont pas là (`brief_du_jour`, `pipeline`, `fiche_entreprise`, `fiche_contact`, `activites_recentes`, `rechercher`) ; `requete_lecture` en tient lieu pour l'instant. À trancher avec Marc : quelles IA il utilise, les dix questions qu'il veut poser à l'OS, les actions à déléguer.

### M8 — Connexions

Livré : HubSpot, Gmail, Agenda et Drive Google, boîte Infomaniak.

Reste : qui crée les accès chez les clients à l'ouverture d'un mandat, et la procédure de fin de mandat côté connexions.

### M9 — Présentations dans l'OS

Objectif : faire de l'OS le support des présentations devant un client (démonstration de l'outil que Marc utilise lui-même). Section « Outils et diagnostics ». Maquette validée par Marc le 09/11/2026.

Décisions :

- Les boutons deviennent « Test VMA », « Diagnostic d'endurance commerciale » et « SIMATIS ». Le module d'essai du Test VMA passe en bas de sa présentation.
- Trois présentations génériques en diaporama (une idée par slide, petits ronds de progression, flèches du clavier) : SIMATIS (contenu repris du site public et du second cerveau), Test VMA, Diagnostic. Textes génériques, jamais de nom de client, de tarif ni de méthode propriétaire (formule de la VMA, gains maximaux, potentiel brut).
- Mode présentation commun : masque la barre du haut et la console, garde la barre latérale. Touche P pour entrer, Échap pour sortir.
- Logo du Test VMA : le logo du diagnostic avec une pastille « VMA » au centre de la piste, sans slogan. Nouveau fichier SVG, l'original reste intact.
- Diaporama d'OS d'un diagnostic (introduction et restitution) : les artefacts restent la référence et l'archive (export PDF). L'OS garde déjà le texte des slides (support d'ouverture finalisé, restitution exportée) : le diaporama les présente en lecture seule, sans nouvelle table. Un nouvel export le met à jour. Mise en page de l'OS (titre et puces), pas la copie du visuel de l'artefact ; des slides structurées (cartes, étapes) restent une évolution possible.
- Exemples de démonstration : entreprise fictive, chiffres modifiés, préconisations génériques.

Livraisons, chacune dans sa branche, avec ses tests :

1. **Livrée.** Boutons, mode présentation, page Test VMA, logo VMA, présentation du Diagnostic en slides. Test : le mode présentation masque barre du haut et console, Échap le quitte, la navigation entre slides.
2. **Livrée.** Page SIMATIS en 10 slides (photo, logos SIMATIS et KAIROS repris du site), bouton « SIMATIS ».
3. **Livrée.** Diaporama d'OS des diagnostics : bouton « Présenter dans l'OS » (support et restitution), route de lecture des diapositives exportées, notes d'orateur masquées en mode présentation. Aucune migration.

Qualité visuelle : vitrine de l'offre. Passe de design dédiée avant chaque page, vérification dans le navigateur à la taille d'un écran de projection et d'un portable, capture montrée à Marc avant fusion.

## Plus tard

- Brief et routines rédigés par IA côté serveur (demande une clé d'API et un budget).
- Envoi direct d'emails, sous double verrou.
- Hébergement sur serveur, avec accès à distance pour les agents.
- Démo isolée partageable avec un prospect : demande l'hébergement sur serveur.
