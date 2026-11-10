import { describe, expect, it } from 'vitest';
import { ACCUSES_MAX_PAR_RELEVE, evaluerDemande } from './filtre.js';
import type { DemandeSite } from './releve.js';

const demande = (extra: Partial<DemandeSite> = {}): DemandeSite => ({
  id: '00000000-0000-4000-8000-000000000001',
  recueLe: '2026-10-12T09:00:00.000Z',
  objet: 'echange',
  nom: 'Jeanne Fictive',
  entreprise: 'Atelier Fictif',
  email: 'jeanne@exemple.fr',
  message: 'Nous vendons sans CRM.',
  ...extra,
});

describe('Site web : filtre des demandes de contact', () => {
  it('lets a normal request through', () => {
    expect(evaluerDemande(demande())).toEqual({ ok: true, raisons: [] });
  });

  it('lets through a request without message', () => {
    expect(evaluerDemande(demande({ message: null })).ok).toBe(true);
  });

  it('flags an unusual e-mail domain', () => {
    const v = evaluerDemande(demande({ email: 'x@exemple.my.id' }));
    expect(v.ok).toBe(false);
    expect(v.raisons[0]).toContain('exemple.my.id');
  });

  it('flags a disposable address, whatever the case', () => {
    expect(evaluerDemande(demande({ email: 'x@Mailinator.com' })).ok).toBe(false);
  });

  it('flags a link in the message', () => {
    for (const message of [
      'Voir https://exemple.test/doc',
      'Voir www.exemple.test',
      'Voir exemple-partage.online/fr/doc',
    ]) {
      expect(evaluerDemande(demande({ message })).raisons).toContain('lien dans le message');
    }
  });

  it('flags a link in the name or the company', () => {
    expect(evaluerDemande(demande({ nom: 'Cliquez https://exemple.test' })).ok).toBe(false);
    expect(evaluerDemande(demande({ entreprise: 'www.exemple.test' })).ok).toBe(false);
  });

  it('does not flag a plain mention of a file or a sentence with dots', () => {
    const v = evaluerDemande(demande({ message: 'Bonjour. Voir le devis.pdf svp. Merci.' }));
    expect(v.ok).toBe(true);
  });

  it('lists every reason at once', () => {
    const v = evaluerDemande(
      demande({ email: 'x@exemple.my.id', message: 'https://exemple.test' }),
    );
    expect(v.raisons).toHaveLength(2);
  });

  it('caps the acknowledgements of one pass', () => {
    expect(ACCUSES_MAX_PAR_RELEVE).toBeGreaterThan(0);
  });
});
