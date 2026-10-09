import { describe, expect, it } from 'vitest';
import { typeTache } from './type-tache.js';

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
