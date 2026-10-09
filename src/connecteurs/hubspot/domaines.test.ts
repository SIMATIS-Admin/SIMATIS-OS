import { describe, expect, it } from 'vitest';
import { domaineExclu, normaliserDomaine } from './domaines.js';

describe('normaliserDomaine', () => {
  it('keeps the domain of an address, a link or a bare domain', () => {
    expect(normaliserDomaine('Banque-Fictive.example')).toBe('banque-fictive.example');
    expect(normaliserDomaine('  conseiller@banque-fictive.example ')).toBe(
      'banque-fictive.example',
    );
    expect(normaliserDomaine('@banque-fictive.example')).toBe('banque-fictive.example');
    expect(normaliserDomaine('https://www.banque-fictive.example/agences?x=1')).toBe(
      'banque-fictive.example',
    );
  });

  it('rejects what is not a domain', () => {
    expect(normaliserDomaine('')).toBeNull();
    expect(normaliserDomaine('banque')).toBeNull();
    expect(normaliserDomaine('banque fictive.example')).toBeNull();
  });
});

describe('domaineExclu', () => {
  const exclus = ['banque-fictive.example'];

  it('matches an email or a domain, subdomains included', () => {
    expect(domaineExclu('conseiller@banque-fictive.example', exclus)).toBe(true);
    expect(domaineExclu('BANQUE-FICTIVE.example', exclus)).toBe(true);
    expect(domaineExclu('agence@lyon.banque-fictive.example', exclus)).toBe(true);
  });

  it('keeps other domains, look-alikes and empty values', () => {
    expect(domaineExclu('client@fonderie.example', exclus)).toBe(false);
    expect(domaineExclu('x@autre-banque-fictive.example', exclus)).toBe(false);
    expect(domaineExclu(null, exclus)).toBe(false);
    expect(domaineExclu('', exclus)).toBe(false);
    expect(domaineExclu('client@fonderie.example', [])).toBe(false);
  });
});
