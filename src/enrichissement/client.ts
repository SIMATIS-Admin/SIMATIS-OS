import type { FetchLike } from '../connecteurs/google/oauth.js';

export type DemandeIA = { consigne: string; entree: string; schema: object };
export type ReponseIA = { json: unknown; jetons: number };

export interface ClientIA {
  demander(d: DemandeIA): Promise<ReponseIA>;
}

// `fatale` : clé refusée ou quota atteint, inutile d'insister sur les fiches suivantes.
export class ErreurIA extends Error {
  constructor(
    message: string,
    readonly fatale: boolean,
  ) {
    super(message);
  }
}

const URL_API = 'https://api.openai.com/v1/responses';

type Sortie = {
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

// Le message d'erreur du fournisseur n'est jamais repris : il peut citer la clé.
export function creerClientOpenAI(
  cfg: { cle: string; modele: string },
  fetchFn: FetchLike = fetch,
  attenteMs = 1000,
): ClientIA {
  const appeler = async (d: DemandeIA): Promise<Response> =>
    fetchFn(URL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.cle}` },
      body: JSON.stringify({
        model: cfg.modele,
        instructions: d.consigne,
        input: d.entree,
        tools: [{ type: 'web_search' }],
        text: {
          format: { type: 'json_schema', name: 'enrichissement', strict: true, schema: d.schema },
        },
      }),
    });

  return {
    async demander(d) {
      let res = await appeler(d);
      if (res.status >= 500) {
        await new Promise((r) => setTimeout(r, attenteMs));
        res = await appeler(d);
      }
      if (res.status === 401 || res.status === 429)
        throw new ErreurIA(
          res.status === 401 ? 'Clé OpenAI refusée' : 'Quota OpenAI atteint',
          true,
        );
      if (!res.ok) throw new ErreurIA(`OpenAI indisponible (HTTP ${res.status})`, false);
      let corps: Sortie;
      try {
        corps = (await res.json()) as Sortie;
      } catch {
        throw new ErreurIA('Réponse OpenAI illisible', false);
      }
      const texte = corps.output
        ?.flatMap((o) => (o.type === 'message' ? (o.content ?? []) : []))
        .find((c) => c.type === 'output_text')?.text;
      if (!texte) throw new ErreurIA('Réponse OpenAI vide ou refusée', false);
      try {
        return {
          json: JSON.parse(texte) as unknown,
          jetons: (corps.usage?.input_tokens ?? 0) + (corps.usage?.output_tokens ?? 0),
        };
      } catch {
        throw new ErreurIA('Réponse OpenAI illisible', false);
      }
    },
  };
}
