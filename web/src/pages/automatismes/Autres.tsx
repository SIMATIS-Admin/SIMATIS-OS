import { useEffect, useState } from 'react';
import { lireAlerteSignaux, lireRoutineBrouillons, lireRoutineProspects } from '../../api.js';

type Reglage = { active: boolean; heure: string; dernierJour?: string; bilan?: string };

export const phraseEtat = (r: Pick<Reglage, 'active' | 'heure'>) =>
  r.active ? `Activé, chaque jour à ${r.heure}` : 'En pause';

// « 2026-11-11 » → « 11/11/2026 » : le jour du dernier passage, avec ce que l'automatisme a fait.
export const phrasePassage = (r: Pick<Reglage, 'dernierJour' | 'bilan'>) => {
  if (!r.dernierJour) return 'Pas encore passé.';
  const [a, m, j] = r.dernierJour.split('-');
  return `Dernier passage : ${j}/${m}/${a}.${r.bilan ? ` ${r.bilan}` : ''}`;
};

type Fiche = {
  cle: string;
  nom: string;
  utilite: string;
  lien: string;
  lire: (slug: string) => Promise<Reglage>;
};

// Trois automatismes se règlent dans les Bases vivantes : ils sont rappelés ici avec leur état, pour
// ne pas avoir à les chercher. Leurs réglages restent là-bas.
const FICHES: Fiche[] = [
  {
    cle: 'brouillons',
    nom: 'Les premiers mails et relances à froid',
    utilite:
      'Chaque jour, Claude prépare les premiers mails du Test de VMA et les relances dont le délai est écoulé. Ils attendent votre relecture dans Prospection : rien n’est envoyé sans vous.',
    lien: 'routine-recherche',
    lire: lireRoutineBrouillons,
  },
  {
    cle: 'recherche',
    nom: 'La recherche quotidienne de suspects',
    utilite:
      'Chaque jour, Claude cherche de nouveaux contacts selon votre cible et les ajoute à la Base vivante.',
    lien: 'routine-recherche',
    lire: lireRoutineProspects,
  },
  {
    cle: 'annonces',
    nom: 'L’alerte du BODACC',
    utilite:
      'Chaque jour, l’OS relit les annonces légales du BODACC (procédures, ventes, radiations) des entreprises de votre base et signale les plus récentes.',
    lien: 'alerte',
    lire: lireAlerteSignaux,
  },
];

export function AutresAutomatismes({ slug }: { slug: string }) {
  const [lus, setLus] = useState<{ fiche: Fiche; reglage: Reglage }[] | null>(null);
  useEffect(() => {
    let actif = true;
    void Promise.allSettled(FICHES.map((f) => f.lire(slug))).then((r) => {
      if (!actif) return;
      setLus(
        r.flatMap((x, i) =>
          x.status === 'fulfilled' && typeof x.value?.active === 'boolean'
            ? [{ fiche: FICHES[i]!, reglage: x.value }]
            : [],
        ),
      );
    });
    return () => {
      actif = false;
    };
  }, [slug]);
  if (!lus || lus.length === 0) return null;
  return (
    <section aria-label="Réglés dans d’autres écrans">
      <h2>Réglés dans d’autres écrans</h2>
      <div className="grid g2">
        {lus.map(({ fiche, reglage }) => (
          <div key={fiche.cle} className="panel">
            <div className="panel-h">
              <div>
                <h2>{fiche.nom}</h2>
                <p className="small">{fiche.utilite}</p>
                <div className="small muted">{phraseEtat(reglage)}</div>
              </div>
            </div>
            <div className="panel-b">
              <p style={{ marginTop: 0 }}>{phrasePassage(reglage)}</p>
            </div>
            <div className="decision">
              <a className="btn sm" href={`#/${slug}/bases/ouvrir/${fiche.lien}`}>
                Régler
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
