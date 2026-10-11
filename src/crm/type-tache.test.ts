import { describe, expect, it } from 'vitest';
import { canalDe, typeActivite, typeTache } from './type-tache.js';

describe('typeTache', () => {
  it('recognises a phone task from its title', () => {
    for (const titre of [
      'Appeler Agathe Vallière',
      'Rappeler lundi',
      'TÉL. Romain',
      'tel Romain',
      'Call fournisseur',
      'Téléphoner au gérant',
    ]) {
      expect(typeTache(titre), titre).toBe('appel');
    }
  });

  it('recognises an email task from its title', () => {
    for (const titre of [
      'Envoyer la plaquette',
      'Relance e-mail',
      'Courriel de suivi',
      'mail récap',
      'Envoi du devis',
    ]) {
      expect(typeTache(titre), titre).toBe('email');
    }
  });

  it('only matches whole words', () => {
    expect(typeTache("Vérifier l'appellation")).toBe('tache');
    expect(typeTache('Préparer le devis')).toBe('tache');
  });

  it('prefers phone when both families appear', () => {
    expect(typeTache('Appeler pour envoyer le devis')).toBe('appel');
  });

  it('falls back on the HubSpot type, then on Action', () => {
    expect(typeTache('Préparer le devis', 'CALL')).toBe('appel');
    expect(typeTache('Préparer le devis', 'EMAIL')).toBe('email');
    expect(typeTache('Préparer le devis', 'TODO')).toBe('tache');
    expect(typeTache('Préparer le devis', null)).toBe('tache');
  });

  it('lets the title win over the HubSpot type', () => {
    expect(typeTache('Envoyer la plaquette', 'CALL')).toBe('email');
  });
});

describe('typeActivite', () => {
  it('recognises meetings, lunches and deadlines', () => {
    expect(typeActivite('Déjeuner avec Agathe')).toBe('dejeuner');
    expect(typeActivite('RDV Fonderie')).toBe('reunion');
    expect(typeActivite('Réunion de lancement')).toBe('reunion');
    expect(typeActivite('Échéance devis')).toBe('echeance');
    expect(typeActivite('Date limite dossier')).toBe('echeance');
  });

  it('keeps phone, then email, before the other types', () => {
    expect(typeActivite('Appeler pour caler la réunion')).toBe('appel');
    expect(typeActivite('Envoyer le compte rendu de réunion')).toBe('email');
    expect(typeActivite('Préparer le devis')).toBe('tache');
    expect(typeActivite('Préparer le devis', 'CALL')).toBe('appel');
  });

  it('derives the channel from the type', () => {
    expect(canalDe('reunion')).toBe('tache');
    expect(canalDe('dejeuner')).toBe('tache');
    expect(canalDe('echeance')).toBe('tache');
    expect(canalDe('email')).toBe('email');
    expect(canalDe('appel')).toBe('appel');
  });
});
