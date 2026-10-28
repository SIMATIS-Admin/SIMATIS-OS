// Page de démonstration du Diagnostic d'Endurance Commerciale : principes, étapes, livrables.
// Contenu volontairement général (dépôt public) : ni grille de scoring, ni questionnaire, ni cas réel.
const PRINCIPES = [
  [
    'Un profil d’entreprise, pas de personne',
    'Le diagnostic mesure la capacité commerciale collective de l’entreprise. Il reste valable quels que soient les individus qui composent l’équipe.',
  ],
  [
    'L’endurance plutôt que la performance d’un jour',
    'Tenir dans la durée : cycles de vente longs, marchés en dents de scie, coups durs. Une belle année ne dit rien de la solidité du dispositif.',
  ],
  [
    'Trois dimensions lues ensemble',
    'Outils et méthode, stratégie et régularité, polyvalence. Chacune a un seuil ; le profil est le dernier seuil franchi.',
  ],
  [
    'Un échange avec le dirigeant, des préconisations validées',
    'Chaque recommandation est relue et validée avant d’être livrée : rien ne part sans le regard du consultant.',
  ],
] as const;

const PROFILS = [
  ['Joggeur', 'Il avance sans outils ni méthode : il réussit tant que l’offre se démarque seule.'],
  [
    'Sprinteur',
    'Il a les outils et la méthode, mais alterne les efforts intenses et les relâchements.',
  ],
  ['Marathonien', 'Il tient la distance avec une stratégie, mais reste spécialisé sur son marché.'],
  ['Ultra-endurant', 'Il cumule tout cela et sait transposer sa méthode sur un nouveau terrain.'],
] as const;

const ETAPES = [
  ['Préparer la présentation', 'Un court support introduit le modèle au dirigeant.'],
  [
    'Entretien et résultat de l’outil',
    'Un entretien structuré alimente l’outil, qui calcule le profil.',
  ],
  ['Revue des préconisations', 'Le consultant relit, ajuste et valide chaque préconisation.'],
  ['Rapport', 'Le rapport remis au dirigeant détaille le profil et le plan d’action commercial.'],
  [
    'Restitution et capitalisation',
    'Le résultat est présenté au dirigeant ; les préconisations validées enrichissent la bibliothèque.',
  ],
] as const;

const LIVRABLES = [
  ['Support d’introduction', 'Présenté en ouverture de l’entretien, il explique le modèle.'],
  ['Rapport du diagnostic', 'Le document de référence remis au dirigeant, avec le plan d’action.'],
  [
    'Support de restitution',
    'Le diaporama de la restitution, qui s’achève sur une proposition d’accompagnement.',
  ],
  [
    'Bibliothèque de préconisations',
    'Les préconisations validées sont réutilisées pour les diagnostics suivants.',
  ],
] as const;

export function PresentationDiagnostic() {
  return (
    <div className="presentation-diag">
      <section className="panel">
        <div className="panel-b">
          <p className="muted">Présentation pour le réseau KAIROS</p>
          <h2>Le Diagnostic d’Endurance Commerciale</h2>
          <p>
            Un diagnostic qui dit à un dirigeant si son dispositif commercial tient dans la durée,
            et ce qu’il faut lui donner pour progresser.
          </p>
        </div>
      </section>

      <section aria-labelledby="pd-principes">
        <h2 id="pd-principes">Les grands principes</h2>
        <div className="grid g2">
          {PRINCIPES.map(([titre, texte]) => (
            <div className="panel panel-b" key={titre}>
              <b>{titre}</b>
              <p className="muted">{texte}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="pd-profils">
        <h2 id="pd-profils">Quatre profils, comme en course à pied</h2>
        <ol className="pd-profils">
          {PROFILS.map(([nom, texte]) => (
            <li className="panel panel-b" key={nom}>
              <b>{nom}</b>
              <p className="muted">{texte}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="pd-etapes">
        <h2 id="pd-etapes">Les cinq étapes</h2>
        <ol className="pd-etapes">
          {ETAPES.map(([titre, texte], i) => (
            <li key={titre}>
              <span className="diag-num">{i + 1}</span>
              <div>
                <b>{titre}</b>
                <p className="muted">{texte}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="pd-livrables">
        <h2 id="pd-livrables">Les livrables</h2>
        <div className="grid g2">
          {LIVRABLES.map(([titre, texte]) => (
            <div className="panel panel-b" key={titre}>
              <b>{titre}</b>
              <p className="muted">{texte}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
