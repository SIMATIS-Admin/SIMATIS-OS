# Inbox : une seule entrée « rendez-vous et sa suite »

Date : 21/11/2026. Statut : à approuver.

## Intention et pourquoi

Quand Marc enregistre une visio avec l'outil d'enregistrement de l'OS, l'Inbox lui montre aujourd'hui
deux entrées pour le même rendez-vous : une note « Écrire dans le second cerveau » et une tâche
générique « Prochaine étape après le rendez-vous ». Toutes deux recopient le compte rendu brut (les `**`
du Markdown apparaissent tels quels, le texte est un bloc illisible) et ne savent rien du contexte :
le rendez-vous de l'agenda n'est pas rattaché sans un clic, l'interlocuteur n'est pas identifié (le
résumé écrit « le dirigeant… il » alors que c'est une femme connue dans le CRM), et la suite est
toujours la même tâche vide alors que Marc a déjà dit pendant la visio ce qui vient ensuite.

Cible : **une seule entrée d'Inbox par rendez-vous**, qui dit clairement ce qui est déjà fait, ce que
l'OS va faire à l'acquittement, et qui permet de corriger le texte. Marc n'a plus qu'à relire et
acquitter.

## Buts

- Une entrée unique « rendez-vous et sa suite » par visio enregistrée.
- Rattachement automatique au rendez-vous de l'agenda (créneau et invités), sans clic.
- Interlocuteur identifié depuis la fiche CRM ; son prénom, son nom et l'accord (il/elle) justes dans
  le compte rendu.
- Présentation lisible en trois zones : déjà fait / compte rendu / à l'acquittement.
- Compte rendu mis en forme (titres, listes) et modifiable simplement.
- Acquitter applique d'un coup tout ce qui est coché.
- Livraison 2 : la suite déduite du compte rendu et proposée à l'acquittement.

## Non-buts et anti-buts

- Aucune écriture externe sans l'acquittement de Marc (règle L2 « exécute après accord »). Les
  écritures vers un tiers gardent le dry-run par défaut et le double verrou.
- Pas de refonte des autres types d'entrées (mails, devis, LinkedIn…).
- Pas de nouvelle table ni de nouveau type d'entrée : on étend l'entrée « compte rendu » existante.
- Échec à éviter : une entrée qui réécrit en silence un nom ou un texte sans que Marc le voie, ou un
  rattachement faux appliqué sans pouvoir être changé.

## Contraintes

- Dépôt public : aucun nom, donnée ou contenu réel dans le code, les tests, les fixtures ou ce
  document. Tests avec des personnes et entreprises fictives.
- Aujourd'hui, l'entrée « compte rendu » porte déjà `compteRenduPrepare` (texte seul) ; une visio
  résumée dépose son résumé dans l'entrée ouverte de l'agenda (`proposerResumeAuSujet`) ou crée une
  entrée `source: 'visio'` (`poserResume`). Une réunion n'a qu'une entrée : ce principe reste.
- Enregistrer un compte rendu passe par `enregistrerCompteRendu`, qui propose aujourd'hui la note du
  second cerveau et la tâche générique. Ces deux propositions ne doivent plus naître pour une entrée
  « rendez-vous et sa suite » : leurs contenus deviennent des lignes de l'entrée.
- Le compte rendu est produit par l'exécuteur (Claude), qui ne reçoit aujourd'hui ni l'identité de
  l'interlocuteur ni le contexte du rendez-vous.
- Un diagnostic se crée avec `createProjet` (nom, activité, liens entreprise / contact / affaire) et
  n'existe que dans les espaces où le module est activé.

## Approches envisagées

- **A. Entrée structurée, tout appliqué d'un coup — retenue.** `compteRenduPrepare` devient un petit
  dossier (rendez-vous trouvé, interlocuteur, texte, lignes de suite). L'acquittement applique tout.
  Remplace les deux propositions par des lignes cochables. Plus gros changement, mais une seule
  entrée et un seul endroit de correction.
- **B. Regrouper les propositions à l'affichage.** Rapide, mais deux enregistrements restent
  derrière une présentation : la correction des noms et l'édition restent bancales. Écartée.
- **C. Nouveau type d'entrée dans sa propre table.** Duplique l'entrée « compte rendu » existante
  et crée deux chemins pour le même cas. Écartée.

Marc a choisi A, livrée en deux temps.

## Conception (A)

### Livraison 1 : une entrée lisible, rattachée, corrigeable

**Préparation (exécuteur).** Pour une visio résumée, l'OS calcule d'abord, sans IA :
- le rendez-vous de l'agenda correspondant : candidat unique sur le créneau de l'enregistrement
  (réutiliser `rdvProbable` et `plusProche`), sinon le seul qui partage un invité ; en cas
  d'ambiguïté, aucun rattachement automatique, l'entrée demande le choix ;
- l'interlocuteur : contact de la fiche CRM lié au rendez-vous ou dont l'e-mail correspond à un
  invité ; son prénom, son nom, son entreprise.
Ces éléments sont donnés à l'exécuteur avec la transcription : le compte rendu est rédigé avec le
bon prénom et le bon accord, et chaque intervenant anonyme du texte est remplacé par ce nom.

**Données.** `compteRenduPrepare` garde `texte` et `prepareeLe` (rétrocompatible) et reçoit des
champs optionnels : le rendez-vous proposé (identifiant d'événement, titre, début, niveau de
certitude), l'interlocuteur (contact, nom, genre déduit du prénom si connu), et l'indication que
la suite est vide en livraison 1. Une entrée ancienne, sans ces champs, s'affiche comme avant.

**Écran.** Une entrée « compte rendu » avec dossier s'affiche en trois zones :
1. *Déjà fait* : lignes ✔ (rendez-vous rattaché, interlocuteur reconnu), avec « changer » pour
   corriger le rattachement ou l'interlocuteur.
2. *Compte rendu* : texte rendu en titres et listes (le Markdown n'apparaît plus brut), bouton
   « Modifier » qui ouvre l'édition du texte brut ; Marc voit et corrige lui-même le prénom, le nom
   ou le « il/elle ».
3. *À l'acquittement, l'OS va…* : lignes cochables (enregistrer le compte rendu sur le rendez-vous et
   dans les fiches liées, écrire dans le second cerveau), toutes cochées par défaut.
Un seul bouton « Acquitter ».

**Acquittement.** Une opération unique : rattache le rendez-vous (le crée dans l'OS s'il n'existe
pas, comme aujourd'hui), lie contact et entreprise, enregistre le compte rendu avec
`proposerTache: false`, écrit la note du second cerveau pour la ligne cochée (l'acquittement vaut
l'accord explicite L2), puis marque l'entrée traitée. Refaire l'opération met à jour le même
rendez-vous, sans doublon.

**Fin du doublon.** Une visio dont l'entrée a un dossier ne dépose plus ni la note du second
cerveau ni la tâche « Prochaine étape » : ces contenus sont les lignes de l'entrée.

### Livraison 2 : la suite déduite

L'exécuteur lit la transcription et propose des lignes de suite, chacune modifiable et décochable :
- **Rendez-vous déjà prévu** : si le prochain rendez-vous dit dans la visio (ex. un diagnostic)
  existe déjà dans l'agenda, une ligne ✔ « déjà dans l'agenda » dans *Déjà fait* : rien à créer.
  Sinon, une ligne cochable « créer le rendez-vous » à l'acquittement.
- **Créer le diagnostic** : ligne cochable qui, à l'acquittement, crée le projet dans « Outils et
  diagnostics » (`createProjet`), rattaché à l'entreprise, au contact et à l'affaire de la fiche.
  Proposée seulement si le module est activé et que le compte rendu annonce un diagnostic ; pas de
  doublon si un diagnostic existe déjà pour cette entreprise.
- **Tâche de relance** : ligne cochable avec échéance, seulement si le compte rendu demande de
  relancer à terme.
Rien d'autre n'est proposé par défaut ; plus de tâche « Prochaine étape » générique.

## Règles précisées (calls de l'auteur, à relire)

- **Rattachement certain ou non.** Certain = un seul rendez-vous candidat (règles de `rdvProbable` et
  `plusProche`, fenêtre déjà en vigueur). Incertain ou ambigu = rien n'est pré-sélectionné, la
  ligne *Déjà fait* devient « Rendez-vous à choisir » avec la liste des candidats.
- **Élément non résolu à l'acquittement.** L'acquittement n'est jamais bloqué : sans rendez-vous
  choisi, il en crée un dans l'OS (comportement actuel) ; sans interlocuteur, aucun contact n'est
  lié et le texte garde ses formulations neutres. Rien n'est rattaché par supposition.
- **Plusieurs invités.** L'interlocuteur principal est le contact CRM lié au rendez-vous (sinon le
  premier invité reconnu) ; les autres invités reconnus sont nommés dans le texte et liés au
  rendez-vous. Genre inconnu = formulation neutre.
- **Écritures et atomicité.** L'acquittement vaut l'accord explicite L2. Les écritures en base
  (rendez-vous, liens, compte rendu, entrée traitée) forment une seule transaction. La note du
  second cerveau reste une proposition appliquée par le mécanisme existant, donc soumise au
  dry-run et au double verrou ; si elle échoue, elle reste visible comme proposition en échec et
  ne défait pas le reste. Refaire l'acquittement ne duplique rien.
- **Texte corrigé par Marc.** Un nouveau résumé arrivant dans une entrée dont le texte a été modifié
  ou déjà proposé ne l'écrase pas (règle actuelle de `proposerResumeAuSujet`). Le dossier est
  calculé une fois, à la préparation.
- **Entrées déjà ouvertes.** Aucune migration ni nettoyage : les deux entrées existantes
  continuent à s'afficher et à se traiter comme avant.
- **Livraison 2, incertitude.** Une ligne de suite dont l'exécuteur n'est pas sûr est proposée
  décochée ; seules les lignes explicitement annoncées dans la visio sont cochées par défaut.

## Reste au choix du constructeur

Format exact du dossier JSON, nom des champs, composants d'écran, rendu du Markdown (réutiliser ce
que le dépôt utilise déjà pour afficher du texte formaté), découpage des tests, détection du genre à
partir du prénom (simple et corrigeable à la main), migration éventuelle de la base.
