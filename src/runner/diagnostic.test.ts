import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { promptDiagnostic, skillsDe, type AttenteDiag } from './runner.js';

const attente: AttenteDiag = {
  id: '00000000-0000-4000-8000-000000000001',
  instance: 'simatis',
  nom: 'Atelier Fictif',
  activite: 'Autre activité',
  contexte: 'Contexte fictif.',
  etape: 2,
  profil: 'Joggeur',
  dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
  statutDiagnostic: 'Rapport à rédiger',
  revue: { statut: 'brouillon' },
  conversation: [
    { etape: 1, de: 'pilote', texte: 'Ancienne question', at: '2026-10-18T08:00:00.000Z' },
    { etape: 2, de: 'pilote', texte: 'Question fictive', at: '2026-10-19T08:00:00.000Z' },
  ],
  modele: 'sonnet',
};

describe('Prompt du chat de diagnostic', () => {
  it('demande une seule réponse via l outil, pour ce projet et cette étape', () => {
    const texte = promptDiagnostic(attente, new Date('2026-10-19T08:00:00Z'));
    expect(texte).toContain(`projetId ${attente.id}`);
    expect(texte).toContain('repondre_diagnostic');
    expect(texte).toContain('étape 2 sur 3');
  });

  it("ne reprend que l'échange de l'étape en cours", () => {
    const texte = promptDiagnostic(attente);
    expect(texte).toContain('Question fictive');
    expect(texte).not.toContain('Ancienne question');
  });
});

describe('Skills du poste', () => {
  it('compte aussi les skills synchronisées depuis claude.ai', async () => {
    const dossier = await mkdtemp(path.join(tmpdir(), 'skills-'));
    await mkdir(path.join(dossier, 'alimenter-inbox'));
    await mkdir(path.join(dossier, 'synced', 'compte-fictif', 'skill-synchronisee'), {
      recursive: true,
    });
    expect((await skillsDe(dossier)).sort()).toEqual(['alimenter-inbox', 'skill-synchronisee']);
    await rm(dossier, { recursive: true, force: true });
  });

  it('rend une liste vide sans dossier de skills', async () => {
    expect(await skillsDe(path.join(tmpdir(), 'absent-' + Date.now()))).toEqual([]);
  });
});
