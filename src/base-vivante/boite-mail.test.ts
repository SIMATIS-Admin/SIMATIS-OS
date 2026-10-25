import { describe, expect, it } from 'vitest';
import { adressesEnEchec } from './boite-mail.js';

describe('adressesEnEchec', () => {
  it('ne garde que le destinataire en échec, pas ceux du message cité', () => {
    const corps = `Delivery has failed.
Final-Recipient: rfc822; a@exemple.test
Action: failed

Content-Type: message/rfc822
To: a@exemple.test, b@exemple.test`;
    expect(adressesEnEchec(corps)).toEqual(['a@exemple.test']);
  });

  it("s'arrête avant le message d'origine quand il n'y a pas de Final-Recipient", () => {
    const corps = `Adresse introuvable : a@exemple.test
--- Original message ---
To: a@exemple.test, b@exemple.test`;
    expect(adressesEnEchec(corps)).toEqual(['a@exemple.test']);
  });
});
