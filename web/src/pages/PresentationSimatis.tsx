import kairosLogo from '../assets/kairos-logo.png';
import marc from '../assets/marc-tabouret.jpg';
import simatisLogo from '../assets/simatis-logo.png';
import logoDiagnostic from '../assets/diagnostic-endurance.svg';
import logoVma from '../assets/test-vma.svg';
import { Diaporama, type Slide } from '../shell/Diaporama.js';

// Présentation de SIMATIS, montrée à n'importe quel client. Contenu repris du site public et de la fiche
// « offre » du second cerveau : rien de propre à un client, aucun tarif.
export function PresentationSimatis({ slug }: { slug: string }) {
  const slides: Slide[] = [
    {
      cle: 'titre',
      classe: 'titre',
      contenu: (
        <>
          <div>
            <span className="dia-sur">SIMATIS · Directeur commercial en mode partagé</span>
            <h2>Votre fonction commerciale tient-elle la distance ?</h2>
            <p>
              Je prends la fonction de directeur commercial de votre entreprise : un abonnement, pas
              un TJM. Je reste concentré sur l’objectif, jusqu’à ce que votre équipe tourne sans
              moi.
            </p>
          </div>
          <div className="dia-identite">
            <div className="dia-plaque large">
              <img src={simatisLogo} alt="SIMATIS, Conseil et Formation" />
            </div>
            <span className="dia-reseau">Membre du réseau</span>
            <div className="dia-plaque ronde">
              <img src={kairosLogo} alt="KAIROS, levier de croissance" />
            </div>
          </div>
        </>
      ),
    },
    {
      cle: 'constat',
      contenu: (
        <>
          <span className="dia-sur">Le constat</span>
          <h2>Le dirigeant est le premier commercial de l’entreprise. Et souvent le seul.</h2>
          <ul className="dia-puce-liste">
            <li>Les ventes avancent par à-coups, au rythme de son agenda.</li>
            <li>Les opportunités viennent du réseau historique : peu de nouveaux comptes.</li>
            <li>Les devis partent tard et personne ne les relance vraiment.</li>
            <li>Le CRM existe, mais personne ne s’en sert pour piloter.</li>
          </ul>
        </>
      ),
    },
    {
      cle: 'mode-partage',
      contenu: (
        <>
          <span className="dia-sur">Le mode partagé</span>
          <h2>Un abonnement, pas un TJM.</h2>
          <div className="dia-grille g3">
            <div className="dia-carte">
              <h3>Recruter</h3>
              <p>Un salaire chargé, un CDI, un recrutement long et risqué.</p>
            </div>
            <div className="dia-carte">
              <h3>Un consultant</h3>
              <p>Des journées facturées. Il recommande, vous appliquez.</p>
            </div>
            <div className="dia-carte fort">
              <h3>Le mode partagé</h3>
              <p>
                Un abonnement mensuel fixe. Je prends la fonction, la pilote avec vous et transmets
                à votre équipe.
              </p>
            </div>
          </div>
        </>
      ),
    },
    {
      cle: 'benefices',
      contenu: (
        <>
          <span className="dia-sur">Ce que vous y gagnez</span>
          <h2>Trois bénéfices, concrètement.</h2>
          <div className="dia-grille g3">
            <div className="dia-carte">
              <span className="dia-pastille">1</span>
              <h3>Flexibilité</h3>
              <p>Le présentiel n’est pas ce qui compte : c’est l’objectif et son atteinte.</p>
            </div>
            <div className="dia-carte">
              <span className="dia-pastille">2</span>
              <h3>Maîtrise financière</h3>
              <p>Je m’implique pleinement, la somme à la fin du mois reste fixe.</p>
            </div>
            <div className="dia-carte">
              <span className="dia-pastille">3</span>
              <h3>Accès à la compétence</h3>
              <p>
                Un directeur commercial issu du terrain industriel, sans les contraintes d’une
                embauche.
              </p>
            </div>
          </div>
        </>
      ),
    },
    {
      cle: 'cycle',
      contenu: (
        <>
          <span className="dia-sur">Comment ça marche</span>
          <h2>Je m’implique comme un cadre, puis je transmets.</h2>
          <ol className="dia-etapes" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
            <li>
              <h3>Analyser</h3>
              <p>Le diagnostic et les échanges avec l’équipe.</p>
            </li>
            <li>
              <h3>Proposer</h3>
              <p>Stratégie et plan d’action partagés.</p>
            </li>
            <li>
              <h3>Implanter</h3>
              <p>Outils, process, recrutements.</p>
            </li>
            <li>
              <h3>Mesurer</h3>
              <p>Indicateurs suivis dès le premier mois.</p>
            </li>
            <li>
              <h3>Innover</h3>
              <p>On ajuste, le système vous appartient.</p>
            </li>
          </ol>
          <p className="dia-note">Un nouveau cycle repart toujours à l’étape Analyser.</p>
        </>
      ),
    },
    {
      cle: 'role',
      contenu: (
        <>
          <span className="dia-sur">Mon rôle</span>
          <h2>Toute la fonction commerciale, sur tout le cycle de vente.</h2>
          <div className="dia-grille g4">
            <div className="dia-carte">
              <span className="dia-sur">01</span>
              <h3>Détecter</h3>
              <p>Canaux, cibles, pitch, salons.</p>
            </div>
            <div className="dia-carte">
              <span className="dia-sur">02</span>
              <h3>Qualifier</h3>
              <p>Un devis, oui ou non ?</p>
            </div>
            <div className="dia-carte">
              <span className="dia-sur">03</span>
              <h3>Chiffrer</h3>
              <p>Des devis robustes, rapides.</p>
            </div>
            <div className="dia-carte">
              <span className="dia-sur">04</span>
              <h3>Convertir</h3>
              <p>Présenter et relancer les devis.</p>
            </div>
          </div>
        </>
      ),
    },
    {
      cle: 'limites',
      contenu: (
        <>
          <span className="dia-sur">Mon rôle</span>
          <h2>Ce que je fais, ce que je ne fais pas.</h2>
          <div className="dia-grille g2">
            <div className="dia-carte fort">
              <h3>Ce que je fais</h3>
              <ul className="dia-puce-liste">
                <li>Je prends la fonction et la pilote à vos côtés.</li>
                <li>Je définis stratégie, pitch, outils et salons.</li>
                <li>Je recrute, manage et forme votre équipe.</li>
              </ul>
            </div>
            <div className="dia-carte">
              <h3>Ce que je ne fais pas</h3>
              <ul className="dia-puce-liste non">
                <li>Prospecter à votre place sur la durée.</li>
                <li>Du conseil facturé à la journée.</li>
                <li>Exécuter un plan figé.</li>
              </ul>
            </div>
          </div>
        </>
      ),
    },
    {
      cle: 'qui',
      contenu: (
        <div className="dia-bio">
          <img src={marc} alt="Marc Tabouret" />
          <div>
            <span className="dia-sur">Qui suis-je</span>
            <h2>Marc Tabouret</h2>
            <p>
              Ingénieur en mécanique de formation, j’ai occupé les postes que je vous aide à
              structurer : vendre, construire des équipes, piloter la performance commerciale.
            </p>
            <div className="dia-chiffres">
              <div>
                <b>Près de 15 ans</b>
                <span>responsable commercial dans l’industrie</span>
              </div>
              <div>
                <b>Services et produits</b>
                <span>sur tout le cycle de vente</span>
              </div>
              <div>
                <b>Réseaux de vente</b>
                <span>distributeurs et agents, France et export</span>
              </div>
              <div>
                <b>Équipes</b>
                <span>recrutement, management, pilotage</span>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      cle: 'reseau',
      contenu: (
        <>
          <span className="dia-sur">Un réseau, des outils</span>
          <h2 style={{ maxWidth: 'none', whiteSpace: 'nowrap' }}>Entouré pour aller plus loin.</h2>
          <div className="dia-grille g3">
            <div className="dia-carte">
              <h3>KAIROS</h3>
              <p>Réseau national de directeurs en mode partagé : 40 experts, 150+ entreprises.</p>
            </div>
            <div className="dia-carte">
              <h3>Alpes IA</h3>
              <p>Outils commerciaux sur mesure : CRM, automatisations, tableaux de bord.</p>
            </div>
            <div className="dia-carte marine">
              <h3>Mon propre OS</h3>
              <p>
                Je pilote mon activité avec un outil conçu sur mesure : celui que vous avez sous les
                yeux.
              </p>
            </div>
          </div>
        </>
      ),
    },
    {
      cle: 'commencer',
      contenu: (
        <>
          <span className="dia-sur">Par où commencer</span>
          <h2>Deux outils pour situer votre entreprise.</h2>
          <p>Les deux sont offerts, sans engagement.</p>
          <div className="dia-liens">
            <a className="dia-lien" href={`#/${slug}/presentation-diagnostic`}>
              <span className="dia-lien-logo">
                <img src={logoDiagnostic} alt="" />
              </span>
              <span>
                <b>Diagnostic d’endurance commerciale</b>
                <span>
                  <strong>Offert.</strong> 1 h 30 d’entretien, en partie sur site, puis un rapport
                  de préconisations.
                </span>
              </span>
              <span aria-hidden="true">→</span>
            </a>
            <a className="dia-lien" href={`#/${slug}/presentation-vma`}>
              <span className="dia-lien-logo">
                <img src={logoVma} alt="" />
              </span>
              <span>
                <b>Test VMA</b>
                <span>
                  <strong>Offert.</strong> Un auto-test de 10 minutes, réalisé à distance.
                </span>
              </span>
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </>
      ),
    },
  ];

  return (
    <Diaporama
      nom="Présentation de SIMATIS"
      slides={slides}
      actions={
        <a className="btn sm" href={`#/${slug}/diagnostics`}>
          ← Outils et diagnostics
        </a>
      }
    />
  );
}
