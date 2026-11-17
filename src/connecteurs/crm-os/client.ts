// Client of the compatible CRM exchange API (GET /api/echange/*, profile crm/1). Read only.
export type FicheCrmOs = {
  id: string;
  source: string;
  source_id: string | null;
  modifie_le: string;
  champs: Record<string, unknown>;
  liens: Record<string, string | string[] | null>;
};

export type ObjetCrmOs =
  'entreprise' | 'contact' | 'affaire' | 'tache' | 'rendez_vous' | 'activite';

export type EtapeCrmOs = {
  id: string;
  label: string;
  ordre: number;
  clos: boolean;
  gagne: boolean;
  probabilite: number;
};

export class CrmOsError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const TAILLE_PAGE = 200;
// A container reaches the host through host.docker.internal; those are not remote servers.
const LOCAUX = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'];

export function validerUrl(brut: string): string {
  let url: URL;
  try {
    url = new URL(brut);
  } catch {
    throw new CrmOsError('CRM_OS_URL n’est pas une adresse valide');
  }
  if (url.protocol !== 'https:' && !LOCAUX.includes(url.hostname)) {
    throw new CrmOsError('CRM_OS_URL doit être en https');
  }
  return url.origin;
}

export type OptionsClient = { fetch?: typeof fetch };

export function crmOsClient(secrets: Record<string, string>, options: OptionsClient = {}) {
  const f = options.fetch ?? fetch;
  const base = validerUrl(secrets.CRM_OS_URL ?? '');
  const jeton = secrets.CRM_OS_TOKEN;
  if (!jeton) throw new CrmOsError('CRM_OS_TOKEN est absent');

  async function get<T>(chemin: string): Promise<T> {
    let reponse: Response;
    try {
      reponse = await f(`${base}/api${chemin}`, {
        headers: { authorization: `Bearer ${jeton}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new CrmOsError(
        `CRM compatible injoignable : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (reponse.status === 401) throw new CrmOsError('Le CRM compatible refuse le jeton', 401);
    if (!reponse.ok)
      throw new CrmOsError(`CRM compatible : erreur ${reponse.status}`, reponse.status);
    return (await reponse.json()) as T;
  }

  return {
    // Checks the server speaks the profile this connector reads.
    async verifier(): Promise<void> {
      const index = await get<{ profil?: string }>('/echange');
      if (index.profil !== 'crm/1') {
        throw new CrmOsError(`Profil d’échange inattendu : ${index.profil ?? 'inconnu'}`);
      }
    },
    async etapes(): Promise<EtapeCrmOs[]> {
      return (await get<{ etapes: EtapeCrmOs[] }>('/echange/etapes')).etapes;
    },
    // Every record changed since `depuis`, page by page, oldest first.
    async fiches(objet: ObjetCrmOs, depuis: Date | null): Promise<FicheCrmOs[]> {
      const toutes: FicheCrmOs[] = [];
      for (let decalage = 0; ; decalage += TAILLE_PAGE) {
        const q = new URLSearchParams({ limite: String(TAILLE_PAGE), decalage: String(decalage) });
        if (depuis) q.set('depuis', depuis.toISOString());
        const page = await get<FicheCrmOs[]>(`/echange/${objet}?${q.toString()}`);
        toutes.push(...page);
        if (page.length < TAILLE_PAGE) return toutes;
      }
    },
    async suppressions(depuis: Date | null): Promise<{ objet: string; id: string }[]> {
      const q = depuis ? `?depuis=${encodeURIComponent(depuis.toISOString())}` : '';
      return get(`/echange/suppressions${q}`);
    },
  };
}

export type CrmOsClient = ReturnType<typeof crmOsClient>;
