import { describe, expect, it } from 'vitest';
import { messageEnvoi } from './envoi.js';

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
