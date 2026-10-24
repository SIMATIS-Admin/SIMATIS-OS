import { describe, expect, it } from 'vitest';
import { mailAccuse } from './accuse.js';

describe('accusé de réception du formulaire de contact', () => {
  it('salue le visiteur, promet 48 heures ouvrées et échappe son nom', () => {
    const { subject, html } = mailAccuse({ nom: '<i>Jeanne</i> Dupont' });
    expect(subject).toBe('Votre demande est bien reçue');
    expect(html).toContain('Bonjour &lt;i&gt;Jeanne&lt;/i&gt;,');
    expect(html).toContain('sous 48 heures ouvrées');
    expect(html).toContain('Réserver un créneau');
    expect(html).not.toContain('<i>');
  });

  it('salue par le prénom seul, sans le nom de famille', () => {
    const { html } = mailAccuse({ nom: 'Jeanne DUPONT' });
    expect(html).toContain('Bonjour Jeanne,');
    expect(html).not.toContain('DUPONT');
  });

  it('livre blanc : promet le livre blanc sous 24 heures', () => {
    const { subject, html } = mailAccuse({ nom: 'Jeanne', objet: 'livre-blanc' });
    expect(subject).toContain('livre blanc');
    expect(html).toContain('sous 24 heures');
  });
});
