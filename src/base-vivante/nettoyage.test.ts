import { describe, expect, it } from 'vitest';
import { evaluer, peutEntrerDansLeCrm } from './completude.js';
import {
  clesDoublon,
  decouperNomComplet,
  normaliserEmail,
  normaliserFiche,
  normaliserLinkedin,
  normaliserTelephone,
} from './nettoyage.js';

describe('email', () => {
  it('normalise la casse, mailto et les chevrons, et prend la première adresse valide', () => {
    expect(normaliserEmail('  Jean.Durand@Atelier-Fictif.TEST ')).toBe(
      'jean.durand@atelier-fictif.test',
    );
    expect(normaliserEmail('mailto:a@b.test')).toBe('a@b.test');
    expect(normaliserEmail('Jean Durand <jd@atelier-fictif.test>')).toBe('jd@atelier-fictif.test');
    expect(normaliserEmail('pas-un-mail; a@b.test')).toBe('a@b.test');
  });
  it('rejette ce qui n’est pas une adresse', () => {
    expect(normaliserEmail('pas-un-mail')).toBeNull();
    expect(normaliserEmail('a@b')).toBeNull();
    expect(normaliserEmail('')).toBeNull();
  });
});

describe('téléphone', () => {
  it.each([
    ['06 12 34 56 78', '+33612345678'],
    ['06.12.34.56.78', '+33612345678'],
    ['0612345678', '+33612345678'],
    ['612345678', '+33612345678'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['+33 (0)6 12 34 56 78', '+33612345678'],
    ['0033 6 12 34 56 78', '+33612345678'],
    ['04 50 12 34 56 / 06 12 34 56 78', '+33450123456'],
    ['+41 22 123 45 67', '+41221234567'],
  ])('%s → %s', (entree, attendu) => {
    expect(normaliserTelephone(entree)).toBe(attendu);
  });
  it.each(['', 'abc', '12 34', '0012', '06 12 34'])('%s est invalide', (entree) => {
    expect(normaliserTelephone(entree)).toBeNull();
  });
});

describe('noms', () => {
  it.each([
    ['Jean DUPONT', 'Jean', 'DUPONT'],
    ['DUPONT Jean', 'Jean', 'DUPONT'],
    ['Dupont, Jean-Pierre', 'Jean-Pierre', 'Dupont'],
    ['Jean Dupont', 'Jean', 'Dupont'],
    ['Claire de la FONTAINE', 'Claire', 'de la FONTAINE'],
    ['MARTIN Claire', 'Claire', 'MARTIN'],
    ['Durand', null, 'Durand'],
  ])('%s', (entree, prenom, nom) => {
    const r = decouperNomComplet(entree);
    expect([r.prenom, r.nom]).toEqual([prenom, nom]);
  });
  it('lit la civilité en tête du nom', () => {
    expect(decouperNomComplet('Mme Claire Martin')).toEqual({
      civilite: 'Mme',
      prenom: 'Claire',
      nom: 'Martin',
    });
  });
});

describe('fiche', () => {
  it('met en forme prénom, NOM, civilité normalisée', () => {
    const { fiche } = normaliserFiche({
      entreprise: '  Atelier   Fictif ',
      civilite: 'monsieur',
      prenom: 'jean-PIERRE',
      nom: 'dupont',
    });
    expect(fiche).toMatchObject({
      entreprise: 'Atelier Fictif',
      civilite: 'M.',
      civiliteDeduite: false,
      prenom: 'Jean-Pierre',
      nom: 'DUPONT',
    });
  });

  it('déduit la civilité du prénom et la marque comme déduite', () => {
    expect(normaliserFiche({ prenom: 'Claire', nom: 'Martin' }).fiche).toMatchObject({
      civilite: 'Mme',
      civiliteDeduite: true,
    });
    expect(normaliserFiche({ prenom: 'Jean-Pierre', nom: 'Martin' }).fiche.civilite).toBe('M.');
  });

  it('ne devine pas la civilité d’un prénom mixte ou inconnu', () => {
    for (const prenom of ['Camille', 'Dominique', 'Zbigniew'])
      expect(normaliserFiche({ prenom, nom: 'Martin' }).fiche).toMatchObject({
        civilite: null,
        civiliteDeduite: false,
      });
  });

  it('déduit le domaine et, à défaut, l’entreprise de l’email professionnel', () => {
    const r = normaliserFiche({ nom: 'Durand', email: 'jd@acme-industrie.test' });
    expect(r.fiche).toMatchObject({ domaine: 'acme-industrie.test', entreprise: 'Acme Industrie' });
    expect(r.avertissements).toContain("Entreprise déduite du domaine de l'email");
  });

  it('ne déduit rien d’une adresse de fournisseur grand public', () => {
    const { fiche } = normaliserFiche({ nom: 'Durand', email: 'jd@gmail.com' });
    expect(fiche).toMatchObject({ domaine: null, entreprise: null });
  });

  it('signale un email ou un téléphone invalide sans bloquer la ligne', () => {
    const r = normaliserFiche({ entreprise: 'A', nom: 'B', email: 'xx', telephone: '12' });
    expect(r.avertissements).toEqual(['Email invalide', 'Téléphone invalide']);
    expect(r.fiche.email).toBeNull();
  });

  it('est idempotente : une fiche homogène ressort identique', () => {
    const brut = {
      entreprise: 'Atelier Fictif',
      nomComplet: 'dupont, jean pierre',
      email: 'Jd@Atelier-Fictif.test',
      telephone: '06 12 34 56 78',
      fonction: ' Directeur  général ',
      linkedin: 'https://fr.linkedin.com/in/Jean-Dupont/?trk=x',
    };
    const { fiche } = normaliserFiche(brut);
    expect(normaliserFiche(fiche).fiche).toEqual(fiche);
  });

  it('normalise l’URL LinkedIn', () => {
    expect(normaliserLinkedin('https://fr.linkedin.com/in/Jean-Dupont/?trk=x')).toBe(
      'https://www.linkedin.com/in/jean-dupont',
    );
    expect(normaliserLinkedin('https://exemple.test/profil')).toBeNull();
  });
});

describe('clés de doublon', () => {
  it('classe email, LinkedIn puis prénom + nom + domaine', () => {
    const { fiche } = normaliserFiche({
      entreprise: 'Acme',
      prenom: 'Léa',
      nom: 'Martin',
      email: 'lea@acme.test',
      linkedin: 'linkedin.com/in/lea',
    });
    expect(clesDoublon(fiche)).toEqual([
      'e:lea@acme.test',
      'l:https://www.linkedin.com/in/lea',
      'n:lea|martin|acme.test',
      'n:lea|martin|acme',
    ]);
  });
});

describe('complétude', () => {
  const fiche = (brut: Parameters<typeof normaliserFiche>[0]) => normaliserFiche(brut).fiche;

  it('exige entreprise et nom pour sortir du sas', () => {
    expect(evaluer(fiche({ nom: 'Durand' }))).toEqual({
      etat: 'sous_minimum',
      raison: 'Entreprise manquante',
    });
    expect(evaluer(fiche({ entreprise: 'Acme' }))).toEqual({
      etat: 'sous_minimum',
      raison: 'Nom manquant',
    });
    expect(evaluer(fiche({}))).toMatchObject({ etat: 'sous_minimum' });
  });

  it('range en « à enrichir » sans moyen de contact, en « prospectable » avec un', () => {
    expect(evaluer(fiche({ entreprise: 'Acme', nom: 'Durand' }))).toEqual({
      etat: 'pret',
      zone: 'a_enrichir',
    });
    expect(evaluer(fiche({ entreprise: 'Acme', nom: 'Durand', telephone: '0612345678' }))).toEqual({
      etat: 'pret',
      zone: 'prospectable',
    });
    expect(evaluer(fiche({ entreprise: 'Acme', nom: 'Durand', email: 'd@acme.test' }))).toEqual({
      etat: 'pret',
      zone: 'prospectable',
    });
  });

  it('un email invalide ne rend pas prospectable', () => {
    expect(evaluer(fiche({ entreprise: 'Acme', nom: 'Durand', email: 'xx' }))).toEqual({
      etat: 'pret',
      zone: 'a_enrichir',
    });
  });

  it('une fiche à enrichir n’entre jamais dans le CRM', () => {
    expect(peutEntrerDansLeCrm('a_enrichir')).toBe(false);
    expect(peutEntrerDansLeCrm('prospectable')).toBe(true);
  });
});
