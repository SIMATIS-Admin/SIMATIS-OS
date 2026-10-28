import { describe, expect, it } from 'vitest';
import { propositionSchema, consignesProposition, type Proposition } from './proposition.js';

const fictive: Proposition = {
  formule: {
    libelle: 'Accompagnement commercial fictif',
    mensualite: 1500,
    engagementMois: 12,
    tacite: true,
    prestations: ['Un point hebdomadaire', 'Un tableau de bord mensuel'],
  },
  options: [
    {
      id: 'o1',
      libelle: 'Outil de suivi sur mesure fictif',
      description: 'Relié au nouvel outil de gestion',
      tarif: { mode: 'forfait', montant: null },
    },
    {
      id: 'o2',
      libelle: 'Atelier fictif',
      description: '',
      tarif: { mode: 'mensuel', montant: 200 },
    },
  ],
};

describe('propositionSchema', () => {
  it('accepte une proposition complète', () => {
    expect(propositionSchema.safeParse(fictive).success).toBe(true);
  });

  it('applique 12 mois et la tacite reconduction par défaut', () => {
    const r = propositionSchema.parse({
      formule: { libelle: 'Formule fictive', mensualite: null, prestations: [] },
      options: [],
    });
    expect(r.formule.engagementMois).toBe(12);
    expect(r.formule.tacite).toBe(true);
  });

  it('refuse un montant négatif', () => {
    const r = propositionSchema.safeParse({
      ...fictive,
      formule: { ...fictive.formule, mensualite: -1 },
    });
    expect(r.success).toBe(false);
  });

  it('refuse une option sans libellé', () => {
    const r = propositionSchema.safeParse({
      ...fictive,
      options: [{ ...fictive.options[0], libelle: '' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('consignesProposition', () => {
  it('décrit la formule, l engagement et les options avec leurs tarifs', () => {
    const texte = consignesProposition(fictive).join('\n');
    expect(texte).toContain('Accompagnement commercial fictif');
    expect(texte).toMatch(/1\D500 € par mois/);
    expect(texte).toContain('engagement de 12 mois');
    expect(texte).toContain('reconduction tacite');
    expect(texte).toContain('Un tableau de bord mensuel');
    expect(texte).toContain('Outil de suivi sur mesure fictif');
    expect(texte).toMatch(/200 € par mois/);
  });

  it('un montant absent s affiche « sur devis », sans chiffre inventé', () => {
    const texte = consignesProposition(fictive).join('\n');
    expect(texte).toMatch(/Outil de suivi sur mesure fictif[^\n]*sur devis/);
    const sans = consignesProposition({
      ...fictive,
      formule: { ...fictive.formule, mensualite: null },
    }).join('\n');
    expect(sans).toContain('mensualité sur devis');
  });

  it('sans option, aucune diapositive d option n est demandée', () => {
    const texte = consignesProposition({ ...fictive, options: [] }).join('\n');
    expect(texte).not.toContain('Options');
  });
});
