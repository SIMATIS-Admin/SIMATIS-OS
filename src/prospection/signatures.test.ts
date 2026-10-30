import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import {
  ajouterSignature,
  definirDefaut,
  imageSignature,
  listerSignatures,
  remplacerImage,
  renommerSignature,
  reglerObjectif,
  SignatureInvalide,
  supprimerSignature,
} from './signatures.js';
import { statsProspection } from './stats.js';

// Petites images fictives : les octets magiques suffisent, rien n'est lu sur disque.
const png = (extra = 16) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra),
  ]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const b64 = (b: Buffer) => b.toString('base64');

describe('Signatures et objectif de prospection', () => {
  let t: TestApp;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'sig-a', nom: 'A', type: 'mandat' })).id;
    b = (await createInstance(t.owner.db, { slug: 'sig-b', nom: 'B', type: 'mandat' })).id;
  });

  afterAll(async () => {
    await t.drop();
  });

  const dansA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a, fn);
  const refus = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(SignatureInvalide);

  it("ajoute une signature PNG et la liste sans l'image", async () => {
    const s = await dansA((tx) =>
      ajouterSignature(tx, { nom: 'Simatis', typeMime: 'image/png', imageBase64: b64(png()) }),
    );
    expect(s).toMatchObject({ nom: 'Simatis', defaut: false, typeMime: 'image/png' });
    const liste = await dansA((tx) => listerSignatures(tx));
    expect(liste.map((x) => x.nom)).toEqual(['Simatis']);
    expect(JSON.stringify(liste)).not.toContain('image"');
    const img = await dansA((tx) => imageSignature(tx, s.id));
    expect(img?.typeMime).toBe('image/png');
    expect(img?.octets.equals(png())).toBe(true);
  });

  it('accepte le JPEG et refuse un autre type', async () => {
    await dansA((tx) =>
      ajouterSignature(tx, { nom: 'Photo', typeMime: 'image/jpeg', imageBase64: b64(jpeg()) }),
    );
    await refus(
      dansA((tx) =>
        ajouterSignature(tx, { nom: 'Gif', typeMime: 'image/gif', imageBase64: b64(png()) }),
      ),
    );
    // Le type annoncé ne suffit pas : les octets doivent être ceux d'une image PNG ou JPEG.
    await refus(
      dansA((tx) =>
        ajouterSignature(tx, {
          nom: 'Faux',
          typeMime: 'image/png',
          imageBase64: b64(Buffer.from('<svg></svg>')),
        }),
      ),
    );
  });

  it('refuse une image de plus de 400 Ko et un base64 invalide', async () => {
    await refus(
      dansA((tx) =>
        ajouterSignature(tx, {
          nom: 'Lourde',
          typeMime: 'image/png',
          imageBase64: b64(png(400 * 1024)),
        }),
      ),
    );
    await refus(
      dansA((tx) =>
        ajouterSignature(tx, {
          nom: 'Cassée',
          typeMime: 'image/png',
          imageBase64: '!!pas du base64!!',
        }),
      ),
    );
  });

  it('refuse un nom vide, trop long ou en doublon', async () => {
    const nouvelle = (nom: string) =>
      dansA((tx) => ajouterSignature(tx, { nom, typeMime: 'image/png', imageBase64: b64(png()) }));
    await refus(nouvelle('   '));
    await refus(nouvelle('x'.repeat(61)));
    await refus(nouvelle('Simatis'));
  });

  it("une seule signature par défaut : en définir une retire l'autre", async () => {
    const [premiere, seconde] = await dansA((tx) => listerSignatures(tx));
    await dansA((tx) => definirDefaut(tx, premiere!.id));
    await dansA((tx) => definirDefaut(tx, seconde!.id));
    const liste = await dansA((tx) => listerSignatures(tx));
    expect(liste.filter((x) => x.defaut).map((x) => x.id)).toEqual([seconde!.id]);
  });

  it('supprimer la signature par défaut ne laisse aucun défaut', async () => {
    const liste = await dansA((tx) => listerSignatures(tx));
    const defaut = liste.find((x) => x.defaut)!;
    await dansA((tx) => supprimerSignature(tx, defaut.id));
    const apres = await dansA((tx) => listerSignatures(tx));
    expect(apres.some((x) => x.defaut)).toBe(false);
    expect(apres.some((x) => x.id === defaut.id)).toBe(false);
  });

  it("renomme et remplace l'image", async () => {
    const [s] = await dansA((tx) => listerSignatures(tx));
    await dansA((tx) => renommerSignature(tx, s!.id, 'Simatis et Kairos'));
    await dansA((tx) =>
      remplacerImage(tx, s!.id, { typeMime: 'image/jpeg', imageBase64: b64(jpeg()) }),
    );
    const [apres] = await dansA((tx) => listerSignatures(tx));
    expect(apres).toMatchObject({ nom: 'Simatis et Kairos', typeMime: 'image/jpeg' });
    await refus(dansA((tx) => renommerSignature(tx, s!.id, '')));
  });

  it("règle l'objectif entre 0 et 500", async () => {
    await dansA((tx) => reglerObjectif(tx, 45));
    expect((await dansA((tx) => statsProspection(tx))).objectif).toBe(45);
    await dansA((tx) => reglerObjectif(tx, 0));
    expect((await dansA((tx) => statsProspection(tx))).objectif).toBe(0);
    await refus(dansA((tx) => reglerObjectif(tx, 501)));
    await refus(dansA((tx) => reglerObjectif(tx, -1)));
    await refus(dansA((tx) => reglerObjectif(tx, 12.5)));
  });

  it("isole les signatures et l'objectif entre instances", async () => {
    const dansB = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, b, fn);
    expect(await dansB((tx) => listerSignatures(tx))).toEqual([]);
    expect((await dansB((tx) => statsProspection(tx))).objectif).toBe(30);
    const [s] = await dansA((tx) => listerSignatures(tx));
    await expect(dansB((tx) => supprimerSignature(tx, s!.id))).rejects.toBeInstanceOf(
      SignatureInvalide,
    );
  });
});
