import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { REGISTRE } from './registre.js';
import type { TypeObjet } from './types.js';

const types = Object.keys(REGISTRE) as TypeObjet[];

describe('REGISTRE', () => {
  it('ne cite que des colonnes qui existent', () => {
    for (const t of types) {
      const r = REGISTRE[t];
      const colonnes = Object.keys(getTableColumns(r.table));
      for (const l of r.liens) expect(colonnes, `${t}.${l.colonne}`).toContain(l.colonne);
      for (const l of r.liaisons) {
        const cols = Object.keys(getTableColumns(l.table));
        expect(cols).toContain(l.colProprietaire);
        expect(cols).toContain(l.colCible);
      }
    }
  });

  it('ne pointe que vers des types du registre', () => {
    for (const t of types) {
      for (const l of REGISTRE[t].liens) expect(types).toContain(l.vers);
      for (const l of REGISTRE[t].liaisons) expect(types).toContain(l.cible);
      for (const o of REGISTRE[t].obligatoires) expect(types).toContain(o);
    }
  });

  it('rend obligatoires les enfants de l’affaire mais propose ses contacts', () => {
    expect(REGISTRE.affaire.obligatoires).toEqual(
      expect.arrayContaining(['tache', 'rdv', 'sujet']),
    );
    expect(REGISTRE.affaire.obligatoires).not.toContain('contact');
  });

  it('propose l’entreprise d’un contact', () => {
    expect(REGISTRE.contact.obligatoires).not.toContain('entreprise');
  });
});
