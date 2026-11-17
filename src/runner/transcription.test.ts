import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  nettoyerTranscription,
  outilsDepuisEnv,
  passerTranscriptions,
  transcrireMorceau,
  type OutilsTranscription,
} from './transcription.js';

const outils: OutilsTranscription = {
  ffmpeg: 'ffmpeg-fictif',
  whisper: 'whisper-fictif',
  modele: '/modeles/fictif.bin',
};

type Appel = { commande: string; args: string[] };

// Faux processus : ffmpeg crée le wav demandé, whisper écrit le texte à l'endroit demandé.
function fauxLanceur(opts: { texte?: string; ffmpegEchoue?: boolean } = {}) {
  const appels: Appel[] = [];
  const lancer = async (commande: string, args: string[]) => {
    appels.push({ commande, args });
    if (commande === outils.ffmpeg) {
      if (opts.ffmpegEchoue) return 1;
      await writeFile(args[args.length - 1] ?? '', 'wav-fictif');
      return 0;
    }
    const base = args[args.indexOf('-of') + 1] ?? '';
    await writeFile(`${base}.txt`, opts.texte ?? ' Bonjour à tous. ');
    return 0;
  };
  return { appels, lancer };
}

describe('nettoyerTranscription', () => {
  it('retire les marqueurs entre crochets et les espaces superflus', () => {
    expect(nettoyerTranscription(' [BLANK_AUDIO]\n Bonjour   à tous. [Musique] ')).toBe(
      'Bonjour à tous.',
    );
  });
});

describe('outilsDepuisEnv', () => {
  it('exige le programme et le modèle de transcription', () => {
    expect(outilsDepuisEnv({})).toBeNull();
    expect(outilsDepuisEnv({ WHISPER_BIN: 'w' })).toBeNull();
    expect(outilsDepuisEnv({ WHISPER_BIN: 'w', WHISPER_MODEL: 'm' })).toEqual({
      ffmpeg: 'ffmpeg',
      whisper: 'w',
      modele: 'm',
    });
  });
});

describe('transcrireMorceau', () => {
  it('convertit en wav 16 kHz mono puis transcrit en français', async () => {
    const { appels, lancer } = fauxLanceur();
    const texte = await transcrireMorceau(
      { mime: 'audio/webm;codecs=opus', audio: Buffer.from('son') },
      outils,
      lancer,
    );
    expect(texte).toBe('Bonjour à tous.');
    const [conversion, transcription] = appels;
    expect(conversion?.args).toEqual(expect.arrayContaining(['-ar', '16000', '-ac', '1', '-i']));
    expect(transcription?.args).toEqual(
      expect.arrayContaining(['-m', outils.modele, '-l', 'fr', '-nt']),
    );
  });

  it('supprime ses fichiers temporaires, même en cas d’échec', async () => {
    const { appels, lancer } = fauxLanceur({ ffmpegEchoue: true });
    await expect(
      transcrireMorceau({ mime: 'audio/webm', audio: Buffer.from('son') }, outils, lancer),
    ).rejects.toThrow(/conversion/i);
    const entree = appels[0]?.args[appels[0].args.indexOf('-i') + 1] ?? '';
    expect(path.isAbsolute(entree)).toBe(true);
    expect(existsSync(path.dirname(entree))).toBe(false);
  });
});

describe('passerTranscriptions', () => {
  const attente = (rang: number) => ({
    instance: 'inst',
    enregistrementId: 'e1',
    piste: 'moi',
    rang,
    mime: 'audio/webm',
    audio: Buffer.from('son').toString('base64'),
  });

  it('rend le texte de chaque morceau à l’OS', async () => {
    const rendus: { chemin: string; corps: unknown }[] = [];
    const api = vi.fn((chemin: string, corps?: unknown) => {
      if (corps === undefined) return Promise.resolve([attente(0), attente(1)]);
      rendus.push({ chemin, corps });
      return Promise.resolve({});
    });
    const n = await passerTranscriptions(api as never, outils, fauxLanceur().lancer);
    expect(n).toBe(2);
    expect(rendus.map((r) => r.chemin)).toEqual([
      '/api/runner/transcriptions/e1/moi/0',
      '/api/runner/transcriptions/e1/moi/1',
    ]);
    expect(rendus[0]?.corps).toEqual({ instance: 'inst', texte: 'Bonjour à tous.' });
  });

  it('signale un morceau illisible sans bloquer les suivants', async () => {
    const rendus: unknown[] = [];
    const api = vi.fn((_chemin: string, corps?: unknown) => {
      if (corps === undefined) return Promise.resolve([attente(0)]);
      rendus.push(corps);
      return Promise.resolve({});
    });
    await passerTranscriptions(api as never, outils, fauxLanceur({ ffmpegEchoue: true }).lancer);
    expect(rendus[0]).toMatchObject({ instance: 'inst', texte: '' });
    expect((rendus[0] as { erreur: string }).erreur).toMatch(/conversion/i);
  });

  it('ne fait rien et le dit une seule fois quand la transcription n’est pas configurée', async () => {
    const api = vi.fn();
    const journal = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await passerTranscriptions(api as never, null, fauxLanceur().lancer)).toBe(0);
    expect(await passerTranscriptions(api as never, null, fauxLanceur().lancer)).toBe(0);
    expect(api).not.toHaveBeenCalled();
    expect(journal).toHaveBeenCalledTimes(1);
    journal.mockRestore();
  });
});
