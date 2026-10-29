import { beforeEach, describe, expect, it } from 'vitest';
import {
  ajouterDocumentPartage,
  cartePartage,
  deposerMessage,
  ecrirePartage,
  lirePartage,
  raisonLectureSeule,
  type AppelerPartage,
} from './partage.js';

// Faux espace partagé, au format de réponse du vrai serveur MCP « partage ».
let fichiers: Map<string, string>;
let appels: { outil: string; args: Record<string, unknown> }[];
const appeler: AppelerPartage = (outil, args) => {
  appels.push({ outil, args });
  if (outil === 'lister_partage')
    return Promise.resolve(
      [...fichiers.keys()]
        .sort()
        .map((p) => `- ${p} · 1 Ko · hier · Marc`)
        .join('\n') || 'aucun fichier',
    );
  if (outil === 'lire_partage') {
    const chemin = String(args.chemin);
    const contenu = fichiers.get(chemin);
    if (contenu === undefined) return Promise.reject(new Error(`échec : introuvable : ${chemin}`));
    return Promise.resolve(`[${chemin} · modifié le 29 oct. par Marc]\n\n${contenu}`);
  }
  if (outil === 'publier_document') {
    fichiers.set(String(args.chemin), String(args.contenu).replace(/\s*$/, '\n'));
    return Promise.resolve(JSON.stringify({ fait: true, chemin: args.chemin }));
  }
  if (outil === 'deposer_message')
    return Promise.resolve(
      JSON.stringify({ fait: true, chemin: 'echanges/2026-10-29-1300-marc-sujet.md' }),
    );
  return Promise.reject(new Error(`outil inconnu : ${outil}`));
};

beforeEach(() => {
  appels = [];
  fichiers = new Map([
    ['index.md', '# Index\n\n[Offre](reference/offre.md)\n'],
    ['reference/offre.md', '# Offre fictive\n\nTexte.\n'],
    ['prospection/point.md', '# Point fictif\n\nTexte.\n'],
    [
      'echanges/2026-10-29-1200-christophe-question.md',
      '---\nde: christophe\ntype: question\nsujet: "Question fictive"\n---\n\nCorps.\n',
    ],
    ['reference/logo.png', 'binaire'],
  ]);
});

describe('raisonLectureSeule', () => {
  it('seul le dossier de l’auteur se modifie', () => {
    expect(raisonLectureSeule('prospection/point.md', 'marc')).toBeNull();
    expect(raisonLectureSeule('reference/offre.md', 'marc')).toMatch(/appartient à Christophe/);
    expect(raisonLectureSeule('echanges/x.md', 'marc')).toMatch(/ne se modifie plus/);
    expect(raisonLectureSeule('archives/2026-10/x.md', 'marc')).toMatch(/archives/i);
    expect(raisonLectureSeule('index.md', 'marc')).toMatch(/curateur/);
  });
});

describe('lirePartage', () => {
  it('rend le contenu sans l’en-tête du serveur, avec empreinte et droit d’écriture', async () => {
    const n = await lirePartage(appeler, 'prospection/point.md', 'marc');
    expect(n.contenu).toBe('# Point fictif\n\nTexte.\n');
    expect(n.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(n.lectureSeule).toBeNull();
    expect((await lirePartage(appeler, 'reference/offre.md', 'marc')).lectureSeule).toBeTruthy();
  });

  it('une note absente ou un fichier non texte sont des erreurs claires', async () => {
    await expect(lirePartage(appeler, 'prospection/nope.md', 'marc')).rejects.toThrow(
      /introuvable/,
    );
    const binaire: AppelerPartage = () =>
      Promise.resolve(
        '[reference/logo.png · modifié le x par y]\nFichier non textuel (1 Ko), enregistré ici : /tmp/x',
      );
    await expect(lirePartage(binaire, 'reference/logo.png', 'marc')).rejects.toThrow(
      /pas une note texte/,
    );
  });
});

describe('ecrirePartage', () => {
  it('publie dans le dossier de Marc après avoir relu le document', async () => {
    const avant = await lirePartage(appeler, 'prospection/point.md', 'marc');
    const r = await ecrirePartage(
      appeler,
      'prospection/point.md',
      '# Point fictif\n\nChangé.',
      avant.empreinte,
      'marc',
    );
    expect(fichiers.get('prospection/point.md')).toBe('# Point fictif\n\nChangé.\n');
    expect(r.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(appels.filter((a) => a.outil === 'publier_document')).toHaveLength(1);
  });

  it('refuse un document modifié ailleurs et ne publie rien', async () => {
    const avant = await lirePartage(appeler, 'prospection/point.md', 'marc');
    fichiers.set('prospection/point.md', '# Point fictif\n\nChangé par Christophe.\n');
    await expect(
      ecrirePartage(appeler, 'prospection/point.md', 'Mon texte', avant.empreinte, 'marc'),
    ).rejects.toMatchObject({ conflit: true });
    expect(appels.some((a) => a.outil === 'publier_document')).toBe(false);
  });

  it('refuse le dossier de Christophe et les messages sans appeler le serveur', async () => {
    await expect(ecrirePartage(appeler, 'reference/offre.md', 'x', 'e', 'marc')).rejects.toThrow(
      /Christophe/,
    );
    await expect(
      ecrirePartage(appeler, 'echanges/2026-10-29-1200-christophe-question.md', 'x', 'e', 'marc'),
    ).rejects.toThrow(/ne se modifie plus/);
    expect(appels).toHaveLength(0);
  });
});

describe('ajouterDocumentPartage', () => {
  const JOUR = new Date('2026-10-29T10:00:00Z');
  it('crée un document dans prospection/ sans en écraser un existant', async () => {
    const un = await ajouterDocumentPartage(
      appeler,
      { titre: 'Point du jour', texte: 'a' },
      'marc',
      JOUR,
    );
    const deux = await ajouterDocumentPartage(
      appeler,
      { titre: 'Point du jour', texte: 'b' },
      'marc',
      JOUR,
    );
    expect(un.chemin).toBe('prospection/2026-10-29_point-du-jour.md');
    expect(deux.chemin).toBe('prospection/2026-10-29_point-du-jour-2.md');
    expect(fichiers.get(un.chemin)).toContain('a');
    expect(fichiers.get(deux.chemin)).toContain('b');
  });

  it('refuse un titre vide', async () => {
    await expect(
      ajouterDocumentPartage(appeler, { titre: ' ', texte: 'x' }, 'marc', JOUR),
    ).rejects.toThrow(/titre/);
  });
});

describe('deposerMessage', () => {
  it('passe le type, le sujet, le corps et le message cité au serveur', async () => {
    const r = await deposerMessage(appeler, {
      genre: 'reponse',
      sujet: 'Sujet',
      corps: 'Corps',
      enReponseA: 'echanges/2026-10-29-1200-christophe-question.md',
    });
    expect(r.chemin).toMatch(/^echanges\//);
    expect(appels[0]).toEqual({
      outil: 'deposer_message',
      args: {
        type: 'reponse',
        sujet: 'Sujet',
        corps: 'Corps',
        en_reponse_a: 'echanges/2026-10-29-1200-christophe-question.md',
      },
    });
  });
});

describe('cartePartage', () => {
  it('une note par fichier Markdown, titres des messages lus dans l’en-tête, liens suivis', async () => {
    const carte = await cartePartage(appeler, 'marc');
    const par = Object.fromEntries(carte.noeuds.map((n) => [n.id, n]));
    expect(Object.keys(par)).toEqual([
      'echanges/2026-10-29-1200-christophe-question.md',
      'index.md',
      'prospection/point.md',
      'reference/offre.md',
    ]);
    expect(par['echanges/2026-10-29-1200-christophe-question.md']).toMatchObject({
      titre: 'Question fictive',
      categorie: 'echanges',
    });
    expect(par['reference/offre.md']?.categorie).toBe('reference');
    expect(carte.liens).toEqual([{ de: 'index.md', vers: 'reference/offre.md' }]);
    expect(carte.autresFichiers).toBe(1);
  });
});
