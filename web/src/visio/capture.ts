export type Piste = 'moi' | 'autres';
export type EnvoiMorceau = (m: {
  piste: Piste;
  rang: number;
  debutMs: number;
  blob: Blob;
}) => Promise<void>;

// Le sous-ensemble de MediaRecorder dont on a besoin (simulable en test).
export type RecorderLike = {
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  mimeType: string;
  start: () => void;
  stop: () => void;
};

type Options = {
  creerRecorder?: (flux: MediaStream) => RecorderLike;
  dureeMorceauMs?: number;
  delaiReessaiMs?: number;
  essaisMax?: number;
  onErreur?: (e: unknown) => void;
};

type PisteEnCours = {
  nom: Piste;
  flux: MediaStream;
  rang: number;
  timer: ReturnType<typeof setTimeout> | null;
  courant: { recorder: RecorderLike; fini: Promise<void> } | null;
  // Envois en file : un morceau ne part qu'après le précédent de sa piste.
  envois: Promise<void>;
};

// Enregistre chaque piste en fichiers autonomes de quelques dizaines de secondes. Un MediaRecorder
// découpé en tranches (timeslice) donne des fragments dont seul le premier a son en-tête : ils ne se
// décodent pas seuls. On arrête donc le recorder et on en relance un à chaque morceau.
export class CaptureVisio {
  private pistes: PisteEnCours[] = [];
  private envoyer: EnvoiMorceau = () => Promise.resolve();
  private readonly creer: (flux: MediaStream) => RecorderLike;
  private readonly duree: number;
  private readonly delaiReessai: number;
  private readonly essaisMax: number;
  private readonly onErreur: (e: unknown) => void;

  constructor(options: Options = {}) {
    this.creer =
      options.creerRecorder ?? ((flux) => new MediaRecorder(flux) as unknown as RecorderLike);
    this.duree = options.dureeMorceauMs ?? 30_000;
    this.delaiReessai = options.delaiReessaiMs ?? 2_000;
    this.essaisMax = options.essaisMax ?? 5;
    this.onErreur = options.onErreur ?? (() => undefined);
  }

  demarrer(
    sources: { micro: MediaStream; onglet: MediaStream | null },
    envoyer: EnvoiMorceau,
  ): void {
    this.envoyer = envoyer;
    this.pistes = [
      this.piste('moi', sources.micro),
      ...(sources.onglet ? [this.piste('autres', sources.onglet)] : []),
    ];
    for (const p of this.pistes) this.lancer(p);
  }

  async arreter(): Promise<void> {
    for (const p of this.pistes) {
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      const courant = p.courant;
      p.courant = null;
      courant?.recorder.stop();
      await courant?.fini;
      await p.envois;
    }
  }

  private piste(nom: Piste, flux: MediaStream): PisteEnCours {
    return { nom, flux, rang: 0, timer: null, courant: null, envois: Promise.resolve() };
  }

  private lancer(p: PisteEnCours): void {
    const recorder = this.creer(p.flux);
    const rang = p.rang;
    const morceaux: Blob[] = [];
    recorder.ondataavailable = (e) => morceaux.push(e.data);
    const fini = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(morceaux, { type: recorder.mimeType });
        if (blob.size > 0) {
          const debutMs = rang * this.duree;
          p.envois = p.envois.then(() => this.envoyerAvecReessai(p.nom, rang, debutMs, blob));
        }
        resolve();
      };
    });
    recorder.start();
    p.courant = { recorder, fini };
    p.timer = setTimeout(() => {
      const precedent = p.courant;
      p.rang++;
      this.lancer(p);
      precedent?.recorder.stop();
    }, this.duree);
  }

  private async envoyerAvecReessai(
    piste: Piste,
    rang: number,
    debutMs: number,
    blob: Blob,
  ): Promise<void> {
    for (let essai = 1; ; essai++) {
      try {
        await this.envoyer({ piste, rang, debutMs, blob });
        return;
      } catch (e) {
        if (essai >= this.essaisMax) {
          this.onErreur(e);
          return;
        }
        await new Promise((r) => setTimeout(r, this.delaiReessai));
      }
    }
  }
}
