# Radar : ajout manuel d'une entrée (conception courte)

## Intention
Pouvoir ajouter à la main une personne au Radar, la suivre et la faire vivre, sans attendre qu'un
import ou une lecture automatique (messagerie, LinkedIn) la fasse apparaître. Cas d'usage : des
contacts approchés hors de l'OS, dont il n'existe aucune fiche.

## Objectifs
- Un bouton « Ajouter au Radar » sur la page Radar, qui ouvre un formulaire.
- Champs : prénom, nom, entreprise (facultative), adresse mail et/ou lien LinkedIn, fonction,
  origine commerciale, canal, étape de départ, note libre.
- Un geste crée le contact, l'entreprise si besoin et l'affaire ; l'entrée apparaît aussitôt dans le
  Radar, à l'étape choisie.
- Si l'adresse mail ou le nom correspond à un contact déjà connu, l'OS le propose et ne crée que
  l'affaire (pas de doublon).
- Une fois l'adresse mail saisie, la lecture de la messagerie de l'instance retrouve les mails
  échangés : le classement automatique du Radar s'applique comme pour toute affaire.

## Hors périmètre
- Lecture de LinkedIn (déjà traitée par ailleurs) et rattachement automatique d'une réponse LinkedIn.
- Import en masse (la base vivante le fait déjà).
- Toute écriture vers HubSpot hors du double verrou existant.

## À ne pas faire (échec même si ça marche)
- Créer des doublons de contacts ou d'entreprises.
- Inventer une étape ou un canal hors de ceux du Radar.
- Écrire des données réelles dans le dépôt, les tests ou les exemples : données fictives seulement.

## Contraintes
- Le Radar affiche les affaires des deux premières étapes du pipeline, placées sur quatre étapes
  (0 à contacter, 1 approchée, 2 à relancer, 3 a répondu) ; étape et canal manuels existent déjà
  (`radarEtapeManuelle`, `radarCanalManuel`).
- Briques existantes : `createContact`, `createEntreprise` (`src/crm/service.ts`),
  `createOpportunite` (`src/crm/pipeline.ts`), route `POST /api/i/:slug/opportunites`.
- Écritures vers un tiers : dry-run par défaut, double verrou pour le réel.
- Interface en français ; nouvelle fonctionnalité livrée avec ses tests.

## Approches
- **A. Formulaire unique « Ajouter au Radar »** (retenue) : un geste, briques existantes.
- B. Recherche d'une fiche existante d'abord : évite les doublons mais alourdit le cas simple.
  Sa recherche est intégrée à A sous forme de suggestions pendant la saisie.
- C. Bouton « + » créant une affaire vide : trop léger, ne fixe ni étape ni canal.
Choix de Marc : A.

## Décisions
- Étape de départ « À contacter » par défaut, modifiable (0 à 3). Pour une étape au-delà de 0,
  l'étape manuelle est enregistrée.
- Canal choisi, LinkedIn présélectionné.
- Origine commerciale : champ libre avec suggestions des origines déjà utilisées. (Ma décision.)
- Note libre rangée sur la fiche. (Ma décision.)
- Une seule route serveur crée l'ensemble (entreprise, contact, affaire, étape, canal, note), dans
  cet ordre. Les briques existantes ouvrent chacune leur transaction (et peuvent écrire dans le
  CRM) : une erreur en cours de route peut laisser l'entreprise ou le contact créés. La relance du
  même formulaire les réutilise (même adresse mail ou même entreprise), sans doublon. (Ma décision,
  corrigée à la rédaction du plan : une transaction unique n'était pas possible.)
- Le lien LinkedIn n'a pas de champ propre sur la fiche : il est écrit en première ligne de la note
  de l'entrée. (Ma décision.)

## Laissé au réalisateur
- Nom exact de la route, disposition du formulaire, règles précises de dédoublonnage (adresse mail
  d'abord, puis nom et entreprise), emplacement de la note sur la fiche.
