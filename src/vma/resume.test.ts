import { describe, expect, it } from 'vitest';
import { resumeResultat } from './releve.js';

const resultat = (calcul: Record<string, unknown>) =>
  ({
    id: '0'.repeat(32),
    invitation: '1'.repeat(32),
    type: 'premier',
    recueLe: '2026-10-20T09:00:00.000Z',
    version: '1.0',
    parametres: {},
    reponses: {},
    calcul,
    ecran: {
      entreprise: 'Atelier Fictif',
      vma: 15000,
      statut: 'prouvée',
      niveau: { label: 'Déjà à votre allure' },
    },
  }) as Parameters<typeof resumeResultat>[0];

// Les montants sont en euros entiers avec un séparateur de milliers (espace fine ou insécable).
const SEP = '\\s';

describe('résumé du sujet d’Inbox (contenu du rangement)', () => {
  it('donne l’entreprise, la date, le type, la VMA et les freins les plus lourds', () => {
    const texte = resumeResultat(
      resultat({
        potentiel: 11718.75,
        top: [{ label: 'Temps commercial', bloc: '6. Plan de canaux' }],
      }),
    );
    expect(texte).toContain('Entreprise : Atelier Fictif');
    expect(texte).toContain('Type : premier test');
    expect(texte).toMatch(new RegExp(`Potentiel brut : \\+11${SEP}719${SEP}€ par mois`));
    expect(texte).toContain('Temps commercial (bloc 6. Plan de canaux)');
    expect(texte).not.toContain('Socle récurrent');
  });

  it('ajoute le socle récurrent et l’allure actuelle quand il y en a un', () => {
    const texte = resumeResultat(
      resultat({ recurrent: 8000, allureActuelle: 23000, potentiel: 11718.75, top: [] }),
    );
    expect(texte).toMatch(new RegExp(`Socle récurrent : 8${SEP}000${SEP}€ par mois`));
    expect(texte).toMatch(new RegExp(`Allure actuelle : 23${SEP}000${SEP}€ par mois`));
  });

  it('dit qu’un essai ne se range pas', () => {
    const essai = { ...resultat({ top: [] }), type: 'essai' } as Parameters<
      typeof resumeResultat
    >[0];
    expect(resumeResultat(essai)).toContain('essai (non rangé, hors historique)');
  });
});
