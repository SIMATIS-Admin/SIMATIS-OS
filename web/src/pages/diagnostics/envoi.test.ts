import { describe, expect, it } from 'vitest';
import { messageEnvoi, messageRelance } from './envoi.js';

describe('Message d’envoi de l’invitation', () => {
  it('sans envoi, n’annonce rien', () => {
    expect(messageEnvoi(null, null)).toBeNull();
  });

  it('dit à qui le mail est parti', () => {
    expect(messageEnvoi({ statut: 'envoye' }, 'jeanne@exemple.test')).toBe(
      'Mail envoyé à jeanne@exemple.test.',
    );
  });

  it('dit pourquoi le mail n’est pas parti', () => {
    expect(messageEnvoi({ statut: 'echec', raison: 'Connexion absente' }, 'a@b.test')).toContain(
      'Mail non envoyé : Connexion absente',
    );
    expect(messageEnvoi({ statut: 'simule' }, 'a@b.test')).toContain('simulation');
  });
});

describe('Message de relance', () => {
  it('dit à qui la relance est partie', () => {
    expect(messageRelance({ statut: 'envoye' }, 'jeanne@exemple.test')).toBe(
      'Relance envoyée à jeanne@exemple.test.',
    );
  });

  it('dit quand la relance n’est pas partie', () => {
    expect(messageRelance({ statut: 'simule' }, 'a@b.test')).toContain('simulation');
    expect(messageRelance({ statut: 'echec', raison: 'adresse refusée' }, 'a@b.test')).toBe(
      'Relance non envoyée : adresse refusée.',
    );
  });
});
