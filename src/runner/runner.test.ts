import { describe, expect, it } from 'vitest';
import {
  argumentsClaude,
  PARTAGE_OUTILS_LECTURE,
  WISPR_OUTILS_LECTURE,
  type Demande,
} from './runner.js';

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
  it('inbox : pas de mode strict, outils = simatis + les outils Wispr et espace partagé en lecture', async () => {
    const { args } = await argumentsClaude(demande('alimenter-inbox'), 'config.json', undefined);
    expect(args).not.toContain('--strict-mcp-config');
    const outils = args[args.indexOf('--allowedTools') + 1] ?? '';
    expect(outils.split(',')).toEqual([
      'mcp__simatis__*',
      ...WISPR_OUTILS_LECTURE,
      ...PARTAGE_OUTILS_LECTURE,
    ]);
    expect(outils).not.toMatch(/deposer_message|publier_document/);
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
    expect(args.join(' ')).not.toMatch(/Wispr|partage/);
  });

  it('autre routine : mode strict conservé, aucun outil Wispr', async () => {
    const { args } = await argumentsClaude(demande('autre-skill'), 'config.json', undefined);
    expect(args).toContain('--strict-mcp-config');
    expect(args.join(' ')).not.toMatch(/Wispr|partage/);
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
