import { describe, expect, it } from 'vitest';
import { argumentsClaude, WISPR_OUTILS_LECTURE, type Demande } from './runner.js';

const demande = (skill: string, cerveau = true): Demande => ({
  id: '00000000-0000-4000-8000-000000000001',
  instance: 'fictif',
  nom: 'Atelier Fictif',
  routine: 'inbox',
  libelle: 'Routine fictive',
  skill,
  cerveau,
});

describe('argumentsClaude', () => {
  it('inbox : pas de mode strict, outils = simatis + les 3 outils Wispr en lecture', async () => {
    const { args } = await argumentsClaude(demande('alimenter-inbox'), 'config.json', undefined);
    expect(args).not.toContain('--strict-mcp-config');
    const outils = args[args.indexOf('--allowedTools') + 1] ?? '';
    expect(outils.split(',')).toEqual(['mcp__simatis__*', ...WISPR_OUTILS_LECTURE]);
    expect(WISPR_OUTILS_LECTURE).toHaveLength(3);
    expect(outils).not.toMatch(/Gmail|HubSpot|Google_Drive|Calendar/);
  });

  it('démo (pas de second cerveau) : mode strict et aucun outil Wispr, même pour la routine Inbox', async () => {
    const { args } = await argumentsClaude(
      demande('alimenter-inbox', false),
      'config.json',
      undefined,
    );
    expect(args).toContain('--strict-mcp-config');
    expect(args.join(' ')).not.toMatch(/Wispr/);
  });

  it('autre routine : mode strict conservé, aucun outil Wispr', async () => {
    const { args } = await argumentsClaude(demande('autre-skill'), 'config.json', undefined);
    expect(args).toContain('--strict-mcp-config');
    expect(args.join(' ')).not.toMatch(/Wispr/);
  });

  it('inbox avec second cerveau : règles Read/Edit/Write du dossier conservées', async () => {
    const dossier = process.cwd();
    const { args } = await argumentsClaude(
      demande('alimenter-inbox', true),
      'config.json',
      dossier,
    );
    const outils = args[args.indexOf('--allowedTools') + 1] ?? '';
    expect(outils).toContain(`Read(/${dossier}/**)`);
    expect(outils).toContain(`Write(/${dossier}/**)`);
    expect(outils).toContain(WISPR_OUTILS_LECTURE[0]);
    expect(args).not.toContain('--strict-mcp-config');
  });
});
