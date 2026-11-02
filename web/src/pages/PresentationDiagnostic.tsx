import enduranceLogo from '../assets/diagnostic-endurance.svg';
import './endurance.css';

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
      <header className="pd-hero">
        <div className="pd-hero-texte">
          <span className="pd-eyebrow">SIMATIS · DIAGNOSTIC D’ENDURANCE COMMERCIALE</span>
          <h2>
            Une organisation commerciale
            <br />
            qui tient la distance.
          </h2>
          <p>
            Au-delà du résultat du mois, comprendre ce qui permet à votre entreprise de vendre
            régulièrement, de résister aux à-coups et de progresser dans la durée.
          </p>
          <div className="pd-promesses">
            <span>Un profil collectif</span>
            <span>Des priorités concrètes</span>
            <span>Une restitution accompagnée</span>
          </div>
        </div>
        <div className="pd-identite">
          <img
            src={enduranceLogo}
            alt="Logo du diagnostic d’endurance commerciale : piste de course et flèche de progression"
          />
          <strong>
            ENDURANCE
            <br />
            <span>COMMERCIALE</span>
          </strong>
          <small>Le cap. Le rythme. La durée.</small>
        </div>
      </header>

      <section className="pd-ouverture" aria-labelledby="pd-enjeu">
        <div>
          <span className="pd-eyebrow">01 · LE POINT DE DÉPART</span>
          <h2 id="pd-enjeu">Une bonne année ne suffit pas à faire un système solide.</h2>
        </div>
        <div>
          <p>
            Une équipe peut obtenir de beaux résultats tout en restant dépendante de quelques
            personnes, de quelques clients ou d’efforts difficiles à répéter. Le diagnostic aide à
            prendre du recul sur ce fonctionnement.
          </p>
          <p>
            L’objectif : identifier ce qui soutient déjà l’activité, ce qui la fragilise et les
            prochaines étapes pour installer une dynamique commerciale plus durable.
          </p>
        </div>
      </section>

      <section aria-labelledby="pd-dimensions" className="pd-section">
        <span className="pd-eyebrow">02 · LES DIMENSIONS</span>
        <h2 id="pd-dimensions">Trois dimensions pour comprendre l’ensemble.</h2>
        <div className="pd-dimensions">
          <article>
            <span className="pd-indice">A</span>
            <h3>Outils &amp; méthode</h3>
            <p>
              Comment l’activité est organisée, suivie et rendue reproductible. Les moyens du
              quotidien pour avancer avec un cadre partagé.
            </p>
          </article>
          <article>
            <span className="pd-indice">B</span>
            <h3>Stratégie &amp; régularité</h3>
            <p>
              La clarté du cap et la capacité à maintenir l’effort commercial dans le temps, y
              compris lorsque l’activité devient plus exigeante.
            </p>
          </article>
          <article>
            <span className="pd-indice">C</span>
            <h3>Polyvalence</h3>
            <p>
              La capacité à adapter son approche et à transposer sa méthode sur un terrain
              différent, sans repartir de zéro.
            </p>
          </article>
        </div>
      </section>

      <section className="pd-section" aria-labelledby="pd-principes">
        <span className="pd-eyebrow">03 · LE CADRE</span>
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

      <section className="pd-section" aria-labelledby="pd-profils">
        <span className="pd-eyebrow">04 · VOTRE PROFIL</span>
        <h2 id="pd-profils">Quatre profils, comme en course à pied</h2>
        <ol className="pd-profils">
          {PROFILS.map(([nom, texte], i) => (
            <li className="panel panel-b" key={nom}>
              <span className="pd-profil-num">0{i + 1}</span>
              <h3>{nom}</h3>
              <p className="muted">{texte}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="pd-section" aria-labelledby="pd-etapes">
        <span className="pd-eyebrow">05 · LE PARCOURS</span>
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

      <section className="pd-section" aria-labelledby="pd-livrables">
        <span className="pd-eyebrow">06 · POUR PASSER À L’ACTION</span>
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
      <section className="pd-questions" aria-labelledby="pd-questions">
        <h2 id="pd-questions">Avant de prendre le départ.</h2>
        <details>
          <summary>À qui s’adresse ce diagnostic ?</summary>
          <p>
            Aux dirigeants qui souhaitent comprendre la solidité du fonctionnement commercial de
            leur entreprise et dégager des priorités d’amélioration avec un consultant.
          </p>
        </details>
        <details>
          <summary>Quelle différence avec le test VMA ?</summary>
          <p>
            Le test VMA donne une lecture du rythme commercial à partir des informations
            renseignées. Le diagnostic d’endurance approfondit le fonctionnement collectif, à
            travers un entretien, un profil et des préconisations relues par le consultant.
          </p>
        </details>
        <details>
          <summary>Est-ce une évaluation des commerciaux ?</summary>
          <p>
            Non : le diagnostic porte sur le dispositif collectif de l’entreprise. Le profil sert de
            point de départ à une discussion et à un plan d’action.
          </p>
        </details>
      </section>
      <footer className="pd-conclusion">
        <img src={enduranceLogo} alt="" />
        <div>
          <h2>Le bon rythme, sur la bonne distance.</h2>
          <p>
            Comprendre le fonctionnement actuel, choisir les priorités, puis avancer avec méthode.
          </p>
        </div>
      </footer>
    </div>
  );
}
