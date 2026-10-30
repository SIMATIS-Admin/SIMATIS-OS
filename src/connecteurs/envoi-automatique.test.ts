import { describe, expect, it } from 'vitest';
import { adressesDe, estAutomatique } from './envoi-automatique.js';

const h = (name: string, value: string) => ({ name, value });

describe('envoi automatique', () => {
  it('un message sans en-tête particulier est humain', () => {
    expect(estAutomatique([h('Subject', 'Bonjour')], 'Paul <paul@client.example>')).toBe(false);
  });

  it.each([
    [[h('List-Unsubscribe', '<mailto:stop@x.example>')]],
    [[h('Precedence', 'bulk')]],
    [[h('Precedence', 'List')]],
    [[h('Auto-Submitted', 'auto-generated')]],
    [[h('X-Auto-Response-Suppress', 'All')]],
  ])('en-têtes %j : automatique', (entetes) => {
    expect(estAutomatique(entetes, 'paul@client.example')).toBe(true);
  });

  it('Auto-Submitted: no et Precedence: first-class restent humains', () => {
    expect(estAutomatique([h('Auto-Submitted', 'no'), h('Precedence', 'first-class')], null)).toBe(
      false,
    );
  });

  it.each(['noreply@x.example', 'No-Reply <no-reply@x.example>', 'notifications@x.example'])(
    'expéditeur %s : automatique',
    (de) => {
      expect(estAutomatique([], de)).toBe(true);
    },
  );

  it('un expéditeur dont le nom ressemble seulement n’est pas écarté', () => {
    expect(estAutomatique([], 'replying@x.example')).toBe(false);
  });

  it('extrait les adresses d’une liste de destinataires', () => {
    expect(adressesDe('Paul <Paul@X.example>, "Léa, L" <lea@y.example>; z@w.example')).toEqual([
      'paul@x.example',
      'lea@y.example',
      'z@w.example',
    ]);
    expect(adressesDe(null)).toEqual([]);
  });
});
