import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureVisio, type EnvoiMorceau, type RecorderLike } from './capture.js';

// Faux MediaRecorder : à l'arrêt il rend un fichier, comme le vrai.
class FauxRecorder implements RecorderLike {
  static crees: FauxRecorder[] = [];
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = 'audio/webm';
  constructor(public flux: unknown) {
    FauxRecorder.crees.push(this);
  }
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(['son']) });
    this.onstop?.();
  }
}
const flux = (nom: string) => ({ nom }) as unknown as MediaStream;
const creer = (f: MediaStream) => new FauxRecorder(f);

describe('CaptureVisio', () => {
  let envois: { piste: string; rang: number; debutMs: number }[];
  let envoyer: EnvoiMorceau;
  beforeEach(() => {
    vi.useFakeTimers();
    FauxRecorder.crees = [];
    envois = [];
    envoyer = (m) => {
      envois.push({ piste: m.piste, rang: m.rang, debutMs: m.debutMs });
      return Promise.resolve();
    };
  });
  afterEach(() => vi.useRealTimers());

  it('découpe chaque piste en fichiers autonomes de 30 s, le dernier à l’arrêt', async () => {
    const capture = new CaptureVisio({ creerRecorder: creer });
    capture.demarrer({ micro: flux('micro'), onglet: flux('onglet') }, envoyer);
    await vi.advanceTimersByTimeAsync(65_000);
    await capture.arreter();
    const rangs = (piste: string) =>
      envois.filter((e) => e.piste === piste).map((e) => [e.rang, e.debutMs]);
    expect(rangs('moi')).toEqual([
      [0, 0],
      [1, 30_000],
      [2, 60_000],
    ]);
    expect(rangs('autres')).toEqual(rangs('moi'));
  });

  it('ne rend la main qu’une fois le dernier morceau envoyé', async () => {
    let fini = false;
    envoyer = () =>
      new Promise((resolve) =>
        setTimeout(() => {
          fini = true;
          resolve();
        }, 500),
      );
    const capture = new CaptureVisio({ creerRecorder: creer });
    capture.demarrer({ micro: flux('micro'), onglet: null }, envoyer);
    const arret = capture.arreter();
    await vi.advanceTimersByTimeAsync(600);
    await arret;
    expect(fini).toBe(true);
  });

  it('réessaie un envoi raté sans perdre l’ordre', async () => {
    let essais = 0;
    const recus: number[] = [];
    envoyer = (m) => {
      essais++;
      if (essais === 1) return Promise.reject(new Error('réseau'));
      recus.push(m.rang);
      return Promise.resolve();
    };
    const capture = new CaptureVisio({ creerRecorder: creer, delaiReessaiMs: 100 });
    capture.demarrer({ micro: flux('micro'), onglet: null }, envoyer);
    await vi.advanceTimersByTimeAsync(31_000);
    const arret = capture.arreter();
    await vi.advanceTimersByTimeAsync(1_000);
    await arret;
    expect(recus).toEqual([0, 1]);
  });

  it('n’enregistre que le micro sans le son de l’onglet', async () => {
    const capture = new CaptureVisio({ creerRecorder: creer });
    capture.demarrer({ micro: flux('micro'), onglet: null }, envoyer);
    await capture.arreter();
    expect(envois.map((e) => e.piste)).toEqual(['moi']);
  });
});
