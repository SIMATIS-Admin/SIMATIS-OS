import { z } from 'zod';
import { emailGenerique, normaliserEmail, normaliserLinkedin } from '../base-vivante/nettoyage.js';
import type { ClientIA } from './client.js';

const candidat = z.object({
  entreprise: z.string().trim().min(1),
  prenom: z.string().trim().min(1),
  nom: z.string().trim().min(1),
  fonction: z.string(),
  email: z.string().nullable(),
  linkedin: z.string().nullable(),
  source: z.preprocess(
    (valeur) =>
      typeof valeur === 'string'
        ? (valeur.match(/\[[^\]]*\]\((https:\/\/[^\s)]+)\)/)?.[1] ?? valeur.trim())
        : valeur,
    z.string().url().startsWith('https://'),
  ),
  qualification: z.string(),
});

export async function chercherProspects(client: ClientIA, consignes: string, nombre: number) {
  const champs = {
    entreprise: { type: 'string' },
    prenom: { type: 'string' },
    nom: { type: 'string' },
    fonction: { type: 'string' },
    email: { type: ['string', 'null'] },
    linkedin: { type: ['string', 'null'] },
    source: { type: 'string', format: 'uri' },
    qualification: { type: 'string' },
  };
  const { json } = await client.demander({
    consigne: `Recherche jusqu’à ${nombre} nouveaux prospects dans des sources publiques. Vérifie le poste actuel. Pour chaque personne, cherche LinkedIn et un e-mail professionnel nominatif effectivement publié. Laisse les coordonnées non vérifiées à null. Donne une URL HTTPS brute comme source, sans Markdown ni texte autour, et résume effectif, CA daté, évolution financière et reprise lorsqu’ils sont documentés. Écarte les candidats sans canal nominatif.`,
    entree: consignes,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['contacts'],
      properties: {
        contacts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: Object.keys(champs),
            properties: champs,
          },
        },
      },
    },
  });
  const contacts = z.object({ contacts: z.array(z.unknown()) }).parse(json).contacts;
  const vus = new Set<string>();
  return contacts
    .flatMap((brut) => {
      const resultat = candidat.safeParse(brut);
      if (!resultat.success) return [];
      const c = resultat.data;
      const email =
        c.email && !/\s/.test(c.email) && !emailGenerique(c.email)
          ? normaliserEmail(c.email)
          : null;
      const linkedin = normaliserLinkedin(c.linkedin);
      const cle = [c.entreprise, c.prenom, c.nom].join('|').toLowerCase();
      if ((!email && !linkedin) || vus.has(cle)) return [];
      vus.add(cle);
      return [{ ...c, email, linkedin }];
    })
    .slice(0, nombre);
}
