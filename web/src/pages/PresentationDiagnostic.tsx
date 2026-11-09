import enduranceLogo from '../assets/diagnostic-endurance.svg';
import { Diaporama, type Slide } from '../shell/Diaporama.js';

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

export function PresentationDiagnostic({ slug }: { slug: string }) {
  const slides: Slide[] = [
    {
      cle: 'titre',
      classe: 'titre',
      contenu: (
        <>
          <div>
            <span className="dia-sur">SIMATIS · Diagnostic d’endurance commerciale</span>
            <h2>Une organisation commerciale qui tient la distance.</h2>
            <p>
              Au-delà du résultat du mois, comprendre ce qui permet à votre entreprise de vendre
              régulièrement, de résister aux à-coups et de progresser dans la durée.
            </p>
            <div className="dia-puces">
              <span>Un profil collectif</span>
              <span>Des priorités concrètes</span>
              <span>Une restitution accompagnée</span>
            </div>
          </div>
          <div className="dia-identite">
            <div className="dia-plaque">
              <img
                src={enduranceLogo}
                alt="Logo du diagnostic d’endurance commerciale : piste de course et flèche de progression"
              />
            </div>
            <strong>
              ENDURANCE
              <br />
              <span>COMMERCIALE</span>
            </strong>
            <small>Le cap. Le rythme. La durée.</small>
          </div>
        </>
      ),
    },
    {
      cle: 'depart',
      contenu: (
        <>
          <span className="dia-sur">Le point de départ</span>
          <h2>Une bonne année ne suffit pas à faire un système solide.</h2>
          <p>
            Une équipe peut obtenir de beaux résultats tout en restant dépendante de quelques
            personnes, de quelques clients ou d’efforts difficiles à répéter. Le diagnostic aide à
            prendre du recul sur ce fonctionnement.
          </p>
          <p style={{ marginTop: '1em' }}>
            L’objectif : identifier ce qui soutient déjà l’activité, ce qui la fragilise et les
            prochaines étapes pour installer une dynamique commerciale plus durable.
          </p>
        </>
      ),
    },
    {
      cle: 'dimensions',
      contenu: (
        <>
          <span className="dia-sur">Les dimensions</span>
          <h2>Trois dimensions pour comprendre l’ensemble.</h2>
          <div className="dia-grille g3">
            <div className="dia-carte">
              <span className="dia-pastille">A</span>
              <h3>Outils &amp; méthode</h3>
              <p>
                Comment l’activité est organisée, suivie et rendue reproductible. Les moyens du
                quotidien pour avancer avec un cadre partagé.
              </p>
            </div>
            <div className="dia-carte">
              <span className="dia-pastille">B</span>
              <h3>Stratégie &amp; régularité</h3>
              <p>
                La clarté du cap et la capacité à maintenir l’effort commercial dans le temps, y
                compris lorsque l’activité devient plus exigeante.
              </p>
            </div>
            <div className="dia-carte">
              <span className="dia-pastille">C</span>
              <h3>Polyvalence</h3>
              <p>
                La capacité à adapter son approche et à transposer sa méthode sur un terrain
                différent, sans repartir de zéro.
              </p>
            </div>
          </div>
        </>
      ),
    },
    {
      cle: 'principes',
      contenu: (
        <>
          <span className="dia-sur">Le cadre</span>
          <h2>Les grands principes</h2>
          <div className="dia-grille g2">
            {PRINCIPES.map(([titre, texte]) => (
              <div className="dia-carte" key={titre}>
                <h3>{titre}</h3>
                <p>{texte}</p>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      cle: 'profils',
      contenu: (
        <>
          <span className="dia-sur">Votre profil</span>
          <h2>Quatre profils, comme en course à pied</h2>
          <ol className="dia-grille g4" style={{ listStyle: 'none', padding: 0 }}>
            {PROFILS.map(([nom, texte], i) => (
              <li className={`dia-carte ${i === 3 ? 'fort' : ''}`} key={nom}>
                <span className="dia-sur">0{i + 1}</span>
                <h3>{nom}</h3>
                <p>{texte}</p>
              </li>
            ))}
          </ol>
        </>
      ),
    },
    {
      cle: 'etapes',
      contenu: (
        <>
          <span className="dia-sur">Le parcours</span>
          <h2>Les cinq étapes</h2>
          <ol className="dia-etapes" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
            {ETAPES.map(([titre, texte]) => (
              <li key={titre}>
                <h3>{titre}</h3>
                <p>{texte}</p>
              </li>
            ))}
          </ol>
        </>
      ),
    },
    {
      cle: 'livrables',
      contenu: (
        <>
          <span className="dia-sur">Pour passer à l’action</span>
          <h2>Les livrables</h2>
          <div className="dia-grille g2">
            {LIVRABLES.map(([titre, texte]) => (
              <div className="dia-carte" key={titre}>
                <h3>{titre}</h3>
                <p>{texte}</p>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      cle: 'questions',
      contenu: (
        <>
          <span className="dia-sur">Avant de prendre le départ</span>
          <h2>Trois questions fréquentes.</h2>
          <div className="dia-grille g3">
            <div className="dia-carte">
              <h3>À qui s’adresse ce diagnostic ?</h3>
              <p>
                Aux dirigeants qui souhaitent comprendre la solidité du fonctionnement commercial de
                leur entreprise et dégager des priorités d’amélioration avec un consultant.
              </p>
            </div>
            <div className="dia-carte">
              <h3>Quelle différence avec le test VMA ?</h3>
              <p>
                Le test VMA donne une lecture du rythme commercial à partir des informations
                renseignées. Le diagnostic d’endurance approfondit le fonctionnement collectif, à
                travers un entretien, un profil et des préconisations relues par le consultant.
              </p>
            </div>
            <div className="dia-carte">
              <h3>Est-ce une évaluation des commerciaux ?</h3>
              <p>
                Non : le diagnostic porte sur le dispositif collectif de l’entreprise. Le profil
                sert de point de départ à une discussion et à un plan d’action.
              </p>
            </div>
          </div>
          <p style={{ marginTop: '1.4em' }}>
            Le bon rythme, sur la bonne distance : comprendre le fonctionnement actuel, choisir les
            priorités, puis avancer avec méthode.
          </p>
        </>
      ),
    },
  ];

  return (
    <Diaporama
      nom="Présentation du Diagnostic d’endurance commerciale"
      slides={slides}
      actions={
        <a className="btn sm" href={`#/${slug}/diagnostics`}>
          ← Outils et diagnostics
        </a>
      }
    />
  );
}
