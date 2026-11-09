import { useState } from 'react';
import { ouvrirEspaceTesteurVma } from '../api.js';
import logoVma from '../assets/test-vma.svg';
import { Diaporama, type Slide } from '../shell/Diaporama.js';

// Présentation du Test de VMA, montrée à un client. Texte générique : ni méthode de calcul, ni gains,
// ni potentiel (réservés à Marc), et un exemple de résultat entièrement fictif.
export function PresentationVma({ slug }: { slug: string }) {
  const [erreur, setErreur] = useState<string | null>(null);

  // L'onglet s'ouvre tout de suite, pendant le clic : après une attente, le navigateur le bloquerait.
  const ouvrirTesteur = async () => {
    setErreur(null);
    const onglet = window.open('', '_blank');
    try {
      const { lien } = await ouvrirEspaceTesteurVma(slug);
      if (onglet) onglet.location.href = lien;
      else window.location.href = lien;
    } catch (e) {
      onglet?.close();
      setErreur(e instanceof Error ? e.message : 'Espace testeur indisponible');
    }
  };

  const slides: Slide[] = [
    {
      cle: 'titre',
      classe: 'titre',
      contenu: (
        <>
          <div>
            <span className="dia-sur">SIMATIS · Test VMA</span>
            <h2>Votre performance commerciale du moment, en 10 minutes.</h2>
            <p>
              Un auto-diagnostic que vous remplissez seul. Il mesure votre rythme commercial du
              moment et l’écart avec vos objectifs commerciaux.
            </p>
            <div className="dia-puces">
              <span>10 minutes</span>
              <span>Seul, en ligne</span>
              <span>Résultat immédiat</span>
              <span>Sans rapport</span>
            </div>
          </div>
          <div className="dia-identite">
            <div className="dia-plaque">
              <img src={logoVma} alt="Logo du Test VMA : piste de course, flèche et pastille VMA" />
            </div>
            <strong>TEST VMA</strong>
          </div>
        </>
      ),
    },
    {
      cle: 'principe',
      contenu: (
        <>
          <span className="dia-sur">Le principe</span>
          <h2>Le diagnostic mesure l’endurance. Le test mesure la vitesse du moment.</h2>
          <div className="dia-grille g2">
            <div className="dia-carte">
              <h3>Diagnostic d’endurance commerciale</h3>
              <p>Le bilan du coureur : combien de temps le système commercial peut tenir.</p>
            </div>
            <div className="dia-carte fort">
              <h3>Test de VMA</h3>
              <p>
                La vitesse maximale du moment : ce que votre système produit aujourd’hui, et
                jusqu’où il peut aller.
              </p>
            </div>
          </div>
          <p className="dia-note">Deux outils distincts, qui se répondent.</p>
        </>
      ),
    },
    {
      cle: 'course',
      contenu: (
        <>
          <span className="dia-sur">Comme en course à pied</span>
          <h2>Un repère de départ, puis un plan pour progresser.</h2>
          <div className="dia-grille g3">
            <div className="dia-carte">
              <span className="dia-sur">Les dernières courses</span>
              <h3>Vos 3 derniers mois</h3>
              <p>Ils prouvent votre vitesse réelle, bien mieux qu’une impression.</p>
            </div>
            <div className="dia-carte">
              <span className="dia-sur">Le temps visé</span>
              <h3>Votre ambition</h3>
              <p>Un chiffre d’affaires visé à 1 an, 2 ans ou plus.</p>
            </div>
            <div className="dia-carte">
              <span className="dia-sur">Le plan d’entraînement</span>
              <h3>Le plan d’action</h3>
              <p>Ce qui mène de l’un à l’autre, construit avec le diagnostic.</p>
            </div>
          </div>
        </>
      ),
    },
    {
      cle: 'deroule',
      contenu: (
        <>
          <span className="dia-sur">Le déroulé</span>
          <h2>Trois étapes, dix minutes.</h2>
          <ol className="dia-etapes" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <li>
              <h3>Vos chiffres récents</h3>
              <p>
                Ce que vous avez proposé et signé sur les 3 derniers mois. Un chiffre inconnu peut
                être estimé.
              </p>
            </li>
            <li>
              <h3>Votre situation</h3>
              <p>Quelques questions sur ce qui freine votre performance au quotidien.</p>
            </li>
            <li>
              <h3>Votre ambition</h3>
              <p>Le chiffre d’affaires que vous visez, et à quelle échéance.</p>
            </li>
          </ol>
        </>
      ),
    },
    {
      cle: 'resultat',
      contenu: (
        <>
          <span className="dia-sur">Ce que vous recevez</span>
          <h2>Votre résultat, dès que vous avez fini.</h2>
          <div className="dia-fenetre" role="img" aria-label="Exemple de résultat du Test VMA">
            <div className="dia-fenetre-barre" aria-hidden="true">
              <i />
              <i />
              <i />
              <span>Test de VMA · Société Exemple</span>
            </div>
            <div className="dia-fenetre-corps" aria-hidden="true">
              <div className="dia-bloc vma">
                <span className="dia-sur">Votre VMA commerciale</span>
                <div className="dia-gros">
                  15 000 €<small>de CA commandé par mois, soit 180 000 € par an</small>
                </div>
                <p>
                  Le chiffre d’affaires commandé que votre activité commerciale génère chaque mois,
                  à son rythme actuel.
                </p>
              </div>
              <div className="dia-bloc">
                <span className="dia-sur">Votre objectif</span>
                <div className="dia-verdict">
                  <b>Réaliste</b>
                  <span>20 000 € par mois dans 2 ans</span>
                </div>
                <div className="dia-piste">
                  <span className="rempli" style={{ width: '65%' }} />
                  <span className="cible" style={{ left: '87%' }} />
                </div>
                <div className="dia-legende">
                  <span>Aujourd’hui : 15 000 € / mois</span>
                  <span>Objectif : 20 000 € / mois</span>
                </div>
                <p>
                  <strong>Il vous manque 5 000 € par mois</strong>, soit 60 000 € par an.
                </p>
              </div>
              <div className="dia-bloc">
                <span className="dia-sur">Où se perd votre VMA</span>
                <ol className="dia-freins">
                  <li>
                    <i>1</i>
                    <span>
                      <b>Le temps de vente</b>Il n’est tenu qu’une semaine sur deux.
                    </span>
                  </li>
                  <li>
                    <i>2</i>
                    <span>
                      <b>Les anciens clients et devis perdus</b>Ils ne sont pas recontactés.
                    </span>
                  </li>
                </ol>
              </div>
            </div>
          </div>
          <p className="dia-note">Exemple de résultat, entreprise fictive.</p>
        </>
      ),
    },
    {
      cle: 'usage',
      contenu: (
        <>
          <span className="dia-sur">Quand l’utiliser</span>
          <h2>Au démarrage, puis au point d’étape.</h2>
          <div className="dia-grille g3">
            <div className="dia-carte">
              <h3>Au démarrage d’un mandat</h3>
              <p>Il cale le plan : l’ambition visée et les freins à lever en premier.</p>
            </div>
            <div className="dia-carte">
              <h3>Au point d’étape</h3>
              <p>Un re-test, au plus une fois par semestre, mesure les progrès.</p>
            </div>
            <div className="dia-carte fort">
              <h3>Avec le diagnostic</h3>
              <p>Le test mesure, le plan d’action du diagnostic prescrit.</p>
            </div>
          </div>
          <div style={{ marginTop: '2em' }}>
            <button className="btn primary" type="button" onClick={() => void ouvrirTesteur()}>
              Ouvrir le module d’essai
            </button>
            <p className="dia-note">Démonstration en direct : rien n’est enregistré.</p>
            {erreur && (
              <p className="dia-note" role="alert">
                {erreur}
              </p>
            )}
          </div>
        </>
      ),
    },
  ];

  return (
    <Diaporama
      nom="Présentation du Test VMA"
      slides={slides}
      actions={
        <a className="btn sm" href={`#/${slug}/diagnostics`}>
          ← Outils et diagnostics
        </a>
      }
    />
  );
}
