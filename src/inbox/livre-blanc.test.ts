import { describe, expect, it } from 'vitest';
import { destinataireLivreBlanc, LIVRES_BLANCS, mailLivreBlanc } from './livre-blanc.js';

const resume = [
  'Contact : Jeanne DUPONT, Gérante',
  'Email : jeanne@exemple.test',
  'Message :\nBonjour, pouvez-vous m’envoyer le livre blanc ?',
].join('\n');

describe('Destinataire d’une demande de livre blanc', () => {
  it('lit l’adresse et le nom dans le résumé d’une demande du site', () => {
    expect(
      destinataireLivreBlanc('Demande du livre blanc — Atelier Fictif (Jeanne)', resume),
    ).toEqual({ email: 'jeanne@exemple.test', nom: 'Jeanne DUPONT' });
  });

  it('reconnaît aussi une demande saisie à la main', () => {
    expect(destinataireLivreBlanc('Envoyer le Livre Blanc à Jeanne', resume)?.email).toBe(
      'jeanne@exemple.test',
    );
  });

  it('ne propose rien pour une autre entrée', () => {
    expect(destinataireLivreBlanc('Demande de diagnostic — Atelier', resume)).toBeNull();
  });

  it('ne propose rien sans adresse lisible', () => {
    expect(destinataireLivreBlanc('Demande du livre blanc', 'Contact : Jeanne')).toBeNull();
    expect(destinataireLivreBlanc('Demande du livre blanc', null)).toBeNull();
  });
});

describe('Mail du livre blanc', () => {
  it('propose chaque numéro avec le gabarit standard et le lien des livres blancs', () => {
    for (const lb of LIVRES_BLANCS) {
      const mail = mailLivreBlanc({ numero: lb.numero, nom: 'Jeanne DUPONT' });
      expect(mail.html).toContain('Bonjour Jeanne,');
      expect(mail.html).not.toContain('DUPONT');
      expect(mail.html).toContain('href="https://alpes-ia.fr/livres-blancs"');
      expect(mail.html).toContain('Réserver un créneau');
      expect(mail.html).toContain('Marc Tabouret');
      expect(mail.subject).toContain(`n° ${lb.numero}`);
    }
  });

  it('le numéro 2 est celui de la délégation à l’IA, sans prénom la salutation reste générique', () => {
    const mail = mailLivreBlanc({ numero: 2, nom: null });
    expect(mail.html).toContain('>Bonjour,</p>');
    expect(mail.html).toContain('ChatGPT');
  });
});
