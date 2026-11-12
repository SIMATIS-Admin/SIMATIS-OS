import { describe, expect, it } from 'vitest';
import type { Execution } from '../api.js';
import { AUTOMATISMES, phraseDuResultat } from './automatismes.js';

const exec = (statut: Execution['statut'], rapport: Execution['rapport'] = null): Execution => ({
  id: 'e1',
  routine: 'inbox',
  statut,
  demandePar: 'pilote',
  debut: null,
  fin: '2026-11-12T05:31:00Z',
  createdAt: '2026-11-12T05:30:00Z',
  etapes: [],
  rapport,
});

describe('phraseDuResultat', () => {
  it('dit quand rien ne s’est encore passé, ou que ça tourne', () => {
    expect(phraseDuResultat(null)).toBe('Pas encore lancé.');
    expect(phraseDuResultat(exec('demandee'))).toMatch(/exécuteur/);
    expect(phraseDuResultat(exec('en_cours'))).toBe('Claude travaille en ce moment.');
  });

  it('résume en une phrase ce qui a été fait, avec ce qui attend le pilote', () => {
    const p = phraseDuResultat(
      exec('terminee', {
        fait: ['3 sujets déposés dans l’Inbox', 'Wispr Flow : 0 réunion'],
        attente: ['3 à traiter'],
        echec: [],
      }),
    );
    expect(p).toContain('jeudi 12 novembre');
    expect(p).toContain('3 sujets déposés dans l’Inbox (et 1 autre).');
    expect(p).toContain('1 à valider de votre côté.');
    expect(p).not.toContain('problème');
  });

  it('signale un problème sans recopier les messages techniques', () => {
    const p = phraseDuResultat(
      exec('terminee', {
        fait: ['1 sujet reporté'],
        attente: [],
        echec: ['Espace partagé (nouveautes_partage) : « fetch failed »'],
      }),
    );
    expect(p).toContain('Un point a posé problème : voir le détail.');
    expect(p).not.toContain('fetch failed');
    expect(phraseDuResultat(exec('echouee'))).toContain('un problème est survenu');
  });

  it('abrège une phrase trop longue et gère un rapport vide', () => {
    const long = 'x'.repeat(300);
    expect(phraseDuResultat(exec('terminee', { fait: [long], attente: [], echec: [] }))).toContain(
      '…',
    );
    expect(phraseDuResultat(exec('terminee', { fait: [], attente: [], echec: [] }))).toContain(
      'rien à signaler',
    );
    expect(phraseDuResultat(exec('terminee'))).toContain('terminé');
  });
});

describe('AUTOMATISMES', () => {
  it('nomme chacune des six routines, au quotidien ou occasionnellement', () => {
    expect(Object.keys(AUTOMATISMES).sort()).toEqual(
      ['base', 'evenement', 'hebdo', 'inbox', 'nettoyage', 'quotidienne'].sort(),
    );
    expect(AUTOMATISMES.inbox?.groupe).toBe('quotidien');
    expect(AUTOMATISMES.quotidienne?.groupe).toBe('quotidien');
    expect(AUTOMATISMES.hebdo?.groupe).toBe('occasionnel');
  });
});
