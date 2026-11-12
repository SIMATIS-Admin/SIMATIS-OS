import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const limiteSchema = z.object({
  restant: z.number().min(0).max(100),
  reinitialiseLe: z.iso.datetime(),
});

const fournisseurSchema = z.object({
  plan: z.string().min(1).max(80).nullable().optional(),
  fenetre5h: limiteSchema,
  hebdomadaire: limiteSchema,
});

const fichierSchema = z
  .object({
    actualiseLe: z.iso.datetime(),
    claude: fournisseurSchema.optional(),
    chatgpt: fournisseurSchema.optional(),
  })
  .strict();

export type LimiteIA = z.infer<typeof limiteSchema>;
export type FournisseurIA = {
  id: 'claude' | 'chatgpt';
  nom: string;
  etat: 'ok' | 'indisponible' | 'erreur';
  plan: string | null;
  fenetre5h: LimiteIA | null;
  hebdomadaire: LimiteIA | null;
};
export type LimitesIA = { actualiseLe: string | null; fournisseurs: FournisseurIA[] };

const vide = (id: FournisseurIA['id'], etat: FournisseurIA['etat']): FournisseurIA => ({
  id,
  nom: id === 'claude' ? 'Claude' : 'ChatGPT',
  etat,
  plan: null,
  fenetre5h: null,
  hebdomadaire: null,
});

export async function lireLimitesIA(fichier: string): Promise<LimitesIA> {
  let contenu: string;
  try {
    contenu = await readFile(fichier, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        actualiseLe: null,
        fournisseurs: [vide('claude', 'indisponible'), vide('chatgpt', 'indisponible')],
      };
    }
    return {
      actualiseLe: null,
      fournisseurs: [vide('claude', 'erreur'), vide('chatgpt', 'erreur')],
    };
  }

  let brut: unknown;
  try {
    brut = JSON.parse(contenu);
  } catch {
    brut = null;
  }
  const resultat = fichierSchema.safeParse(brut);
  if (!resultat.success) {
    return {
      actualiseLe: null,
      fournisseurs: [vide('claude', 'erreur'), vide('chatgpt', 'erreur')],
    };
  }

  const fournisseur = (id: FournisseurIA['id']): FournisseurIA => {
    const donnees = resultat.data[id];
    return donnees
      ? {
          id,
          nom: id === 'claude' ? 'Claude' : 'ChatGPT',
          etat: 'ok',
          plan: donnees.plan ?? null,
          fenetre5h: donnees.fenetre5h,
          hebdomadaire: donnees.hebdomadaire,
        }
      : vide(id, 'indisponible');
  };

  return {
    actualiseLe: resultat.data.actualiseLe,
    fournisseurs: [fournisseur('claude'), fournisseur('chatgpt')],
  };
}
