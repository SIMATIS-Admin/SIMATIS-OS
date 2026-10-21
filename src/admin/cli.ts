import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { importerProjets, importSchema } from '../diagnostic/import.js';
import { connectGoogle } from '../connecteurs/google/oauth.js';
import type { Frequence, Kind } from '../connexions/schema.js';
import { configureConnexion, FREQUENCES, syncNow } from '../connexions/service.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { connexions } from '../connexions/schema.js';
import { brancherGoogle } from '../connexions/brancher.js';
import { eq, isNull } from 'drizzle-orm';
import { entreprises } from '../crm/schema.js';
import { diagnosticProjets } from '../diagnostic/schema.js';
import { proposerRapprochements } from '../diagnostic/rapprochement.js';
import { currentInstance } from '../db/columns.js';
import { loadInstanceSecrets, writeGoogleToken } from '../secrets.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import type { InstanceType } from '../instances/schema.js';
import { createToken, listTokens, revokeToken } from '../mcp/tokens.js';
import {
  archiveInstance,
  createInstance,
  listInstances,
  PHASES,
  purgeInstance,
  setEcrituresReelles,
  setModule,
  setPhase,
  type Phase,
} from '../instances/service.js';

export const USAGE = `Commandes :
  instance:list
  instance:create --slug <slug> --nom "<nom>" --type propre|mandat|prospect [--phase closing|en_cours]
  instance:phase --slug <slug> --phase closing|en_cours   (mandat en Closing ou en cours)
  instance:archive --slug <slug>
  instance:purge --slug <slug> --confirmer
  instance:ecritures --slug <slug> --on|--off   (second verrou des écritures réelles)
  instance:module --slug <slug> --module <devis|site-web|…> --on|--off
  demo:seed
  diagnostic:import --slug <slug> --fichier <chemin.json|->   (projets de diagnostic, espace SIMATIS)
  diagnostic:rattacher --slug <slug> [--appliquer]   (rattache les projets à leur entreprise ; simulation sans --appliquer)
  token:create --nom <nom> (--instance <slug> | --portefeuille | --runner)
  token:list
  token:revoke --id <id>
  connexion:set --slug <slug> --kind crm|messagerie|agenda --fournisseur <f> [--frequence 5min|15min|1h|1j|manuel]
  connexion:list --slug <slug>
  connexion:sync --slug <slug> --kind crm|messagerie|agenda
  google:connect --slug <slug>   (sur l'ordinateur de l'OS, avec un navigateur)`;

type GoogleConnect = (options: {
  clientId: string;
  clientSecret: string;
  open: (url: string) => void;
}) => Promise<{ refresh_token: string; scope: string }>;

type Deps = {
  db: Database;
  out: (line: string) => void;
  secretsDir?: string;
  realWrites?: boolean;
  openUrl?: (url: string) => void;
  connectGoogle?: GoogleConnect;
};

async function requireActive(db: Database, slug: string) {
  const instance = (await listInstances(db)).find((i) => i.slug === slug);
  if (!instance) throw new Error(`Instance inconnue ou archivée : ${slug}`);
  return instance;
}

// Returns the process exit code. Runs on the owner connection.
export async function runCommand(argv: string[], deps: Deps): Promise<number> {
  const { db, out } = deps;
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      slug: { type: 'string' },
      nom: { type: 'string' },
      type: { type: 'string' },
      phase: { type: 'string' },
      confirmer: { type: 'boolean', default: false },
      instance: { type: 'string' },
      portefeuille: { type: 'boolean', default: false },
      runner: { type: 'boolean', default: false },
      on: { type: 'boolean', default: false },
      off: { type: 'boolean', default: false },
      id: { type: 'string' },
      kind: { type: 'string' },
      fournisseur: { type: 'string' },
      frequence: { type: 'string' },
      module: { type: 'string' },
      fichier: { type: 'string' },
      appliquer: { type: 'boolean', default: false },
    },
  });
  const need = (
    name: 'slug' | 'nom' | 'type' | 'phase' | 'id' | 'kind' | 'fournisseur' | 'module' | 'fichier',
  ): string => {
    const value = values[name];
    if (!value) throw new Error(`Option manquante : --${name}`);
    return value;
  };

  try {
    switch (positionals[0]) {
      case 'instance:list':
        for (const i of await listInstances(db, { includeArchived: true })) {
          out(`${i.slug.padEnd(20)} ${i.type.padEnd(9)} ${i.statut.padEnd(8)} ${i.nom}`);
        }
        return 0;
      case 'instance:create': {
        const type = need('type') as InstanceType;
        if (
          values.phase !== undefined &&
          (type !== 'mandat' || !PHASES.includes(values.phase as Phase))
        ) {
          throw new Error('--phase closing|en_cours, pour un mandat seulement');
        }
        const created = await createInstance(db, {
          slug: need('slug'),
          nom: need('nom'),
          type,
          ...(values.phase ? { config: { phase: values.phase as Phase } } : {}),
        });
        out(`Instance créée : ${created.slug} (${created.type})`);
        return 0;
      }
      case 'instance:ecritures': {
        if (values.on === values.off) throw new Error('Préciser --on ou --off');
        const i = await setEcrituresReelles(db, need('slug'), values.on);
        out(
          `Écritures réelles ${i.config.ecrituresReelles ? 'autorisées' : 'désactivées'} pour ${i.slug}` +
            (i.config.ecrituresReelles ? ' (effectives seulement avec REAL_WRITES=on).' : '.'),
        );
        return 0;
      }
      case 'instance:module': {
        if (values.on === values.off) throw new Error('Préciser --on ou --off');
        const i = await setModule(db, need('slug'), need('module'), values.on);
        out(`${i.slug} : modules ${(i.config.modules ?? []).join(', ') || 'aucun'}`);
        return 0;
      }
      case 'instance:phase': {
        const i = await setPhase(db, need('slug'), need('phase') as Phase);
        out(`${i.slug} : mandat ${i.config.phase === 'closing' ? 'en Closing' : 'en cours'}`);
        return 0;
      }
      case 'instance:archive':
        out(`Instance archivée : ${(await archiveInstance(db, need('slug'))).slug}`);
        return 0;
      case 'instance:purge':
        if (!values.confirmer) {
          out('Purge irréversible des données métier : relancer avec --confirmer.');
          return 1;
        }
        out(`Instance purgée et archivée : ${(await purgeInstance(db, need('slug'))).slug}`);
        return 0;
      case 'diagnostic:import': {
        const instance = await requireActive(db, need('slug'));
        const source = need('fichier');
        const texte = source === '-' ? await lireEntree() : await readFile(source, 'utf8');
        const parsed = importSchema.safeParse(JSON.parse(texte));
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Fichier invalide');
        const { crees, deja, completes } = await importerProjets(db, instance, parsed.data.projets);
        out(`Créés : ${crees.join(', ') || 'aucun'}`);
        out(`Support ajouté : ${completes.join(', ') || 'aucun'}`);
        out(`Déjà présents (inchangés) : ${deja.join(', ') || 'aucun'}`);
        return 0;
      }
      case 'diagnostic:rattacher': {
        // Simulation par défaut : on affiche les rapprochements, rien n'est écrit sans --appliquer.
        const instance = await requireActive(db, need('slug'));
        const { projets, annuaire } = await withInstance(db, instance.id, async (tx) => ({
          projets: await tx
            .select({ id: diagnosticProjets.id, nom: diagnosticProjets.nom })
            .from(diagnosticProjets)
            .where(isNull(diagnosticProjets.entrepriseId)),
          annuaire: await tx
            .select({ id: entreprises.id, nom: entreprises.nom })
            .from(entreprises),
        }));
        const propositions = proposerRapprochements(projets, annuaire);
        for (const p of propositions) {
          const nom = projets.find((x) => x.id === p.projetId)?.nom ?? p.projetId;
          if (p.statut === 'exact') out(`exact : ${nom} → ${p.entrepriseNom}`);
          else if (p.statut === 'ambigu')
            out(`ambigu : ${nom} → ${p.candidates.map((c) => c.entrepriseNom).join(' ou ')}`);
          else out(`aucun : ${nom}`);
        }
        if (values.appliquer) {
          for (const p of propositions) {
            if (p.statut !== 'exact') continue;
            await withInstance(db, instance.id, (tx) =>
              tx
                .update(diagnosticProjets)
                .set({ entrepriseId: p.entrepriseId })
                .where(eq(diagnosticProjets.id, p.projetId)),
            );
          }
          out(`Rattachés : ${propositions.filter((p) => p.statut === 'exact').length}`);
        } else {
          out('Simulation : rien n’a été écrit. Ajoutez --appliquer pour rattacher les « exact ».');
        }
        return 0;
      }
      case 'demo:seed':
        out(
          (await seedDemoIfEmpty(db))
            ? 'Instances fictives chargées.'
            : 'Base non vide : rien chargé.',
        );
        return 0;
      case 'token:create': {
        const { token } = await createToken(db, {
          nom: need('nom'),
          portee: values.runner ? 'runner' : values.portefeuille ? 'portefeuille' : 'instance',
          instanceSlug: values.instance,
        });
        out('Jeton MCP (affiché une seule fois, à copier maintenant) :');
        out(token);
        return 0;
      }
      case 'token:list':
        for (const j of await listTokens(db)) {
          out(
            `${j.id}  ${j.nom.padEnd(20)} ${j.portee.padEnd(12)} ${(j.instance ?? '-').padEnd(16)} ${j.revokedAt ? 'révoqué' : 'actif'}`,
          );
        }
        return 0;
      case 'token:revoke':
        out(
          (await revokeToken(db, need('id')))
            ? 'Jeton révoqué.'
            : 'Jeton introuvable ou déjà révoqué.',
        );
        return 0;
      case 'connexion:set': {
        const instance = await requireActive(db, need('slug'));
        const frequence = (values.frequence ?? '15min') as Frequence;
        if (!(frequence in FREQUENCES)) throw new Error(`Fréquence invalide : ${frequence}`);
        await withInstance(db, instance.id, (tx) =>
          configureConnexion(tx, {
            kind: need('kind') as Kind,
            fournisseur: need('fournisseur'),
            reglages: { frequence },
          }),
        );
        out(`Connexion ${need('kind')} réglée pour ${instance.slug} : ${need('fournisseur')}`);
        return 0;
      }
      case 'connexion:list': {
        const instance = await requireActive(db, need('slug'));
        const rows = await withInstance(db, instance.id, (tx) =>
          tx.select().from(connexions).where(eq(connexions.instanceId, currentInstance)),
        );
        for (const c of rows) {
          out(
            `${c.kind.padEnd(11)} ${c.fournisseur.padEnd(14)} ${c.etat.padEnd(15)} ${c.derniereSynchro?.toISOString() ?? 'jamais'}${c.derniereErreur ? `  ${c.derniereErreur}` : ''}`,
          );
        }
        return 0;
      }
      case 'google:connect': {
        const instance = await requireActive(db, need('slug'));
        const dir = deps.secretsDir ?? './secrets/instances';
        const secrets = await loadInstanceSecrets(dir, instance.slug);
        if (!secrets.GOOGLE_CLIENT_ID || !secrets.GOOGLE_CLIENT_SECRET) {
          throw new Error(
            `GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET manquent dans ${dir}/${instance.slug}.env (identifiant OAuth « application de bureau » du Google de l'instance).`,
          );
        }
        const connect: GoogleConnect =
          deps.connectGoogle ?? ((o) => connectGoogle({ ...o, fetch: (u, i) => fetch(u, i) }));
        out(`Autorisez l'accès avec le compte Google de ${instance.nom}, à cette adresse :`);
        const token = await connect({
          clientId: secrets.GOOGLE_CLIENT_ID,
          clientSecret: secrets.GOOGLE_CLIENT_SECRET,
          open: (url) => {
            out(url);
            deps.openUrl?.(url);
          },
        });
        await writeGoogleToken(dir, instance.slug, token);
        await withInstance(db, instance.id, brancherGoogle);
        out(`Google connecté pour ${instance.slug} : messagerie et agenda branchés.`);
        return 0;
      }
      case 'connexion:sync': {
        const report = await syncNow(db, need('slug'), need('kind') as Kind, {
          secretsDir: deps.secretsDir ?? './secrets/instances',
          realWrites: deps.realWrites ?? false,
        });
        out(`Synchronisé : ${report.lus} lus, ${report.crees} créés, ${report.maj} mis à jour.`);
        return 0;
      }
      default:
        out(USAGE);
        return 1;
    }
  } catch (error) {
    out(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// Lit le fichier d'import sur l'entrée standard (--fichier -), pour ne jamais l'écrire sur disque.
async function lireEntree(): Promise<string> {
  process.stdin.setEncoding('utf8');
  let texte = '';
  for await (const morceau of process.stdin) texte += morceau;
  return texte;
}
