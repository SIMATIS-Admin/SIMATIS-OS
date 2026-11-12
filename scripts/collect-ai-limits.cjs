const { spawn } = require('node:child_process');
const { rename, writeFile } = require('node:fs/promises');
const path = require('node:path');

const CODEX =
  process.env.CODEX_BIN ??
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const SORTIE = path.resolve(process.env.IA_LIMITS_FILE ?? 'secrets/ia-limites.json');
const SURVEILLER = process.argv.includes('--watch');
const CINQ_MINUTES = 5 * 60_000;

const iso = (secondes) => new Date(secondes * 1000).toISOString();
const restant = (utilise) => Math.max(0, Math.min(100, 100 - utilise));

function executer(executable, arguments_, duree = 20_000) {
  return new Promise((resolve, reject) => {
    const enfant = spawn(executable, arguments_, { stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    let erreur = '';
    const delai = setTimeout(() => {
      enfant.kill();
      reject(new Error(`${executable} ne répond pas`));
    }, duree);
    enfant.stdout.setEncoding('utf8');
    enfant.stderr.setEncoding('utf8');
    enfant.stdout.on('data', (morceau) => (sortie += morceau));
    enfant.stderr.on('data', (morceau) => (erreur += morceau));
    enfant.once('error', reject);
    enfant.once('close', (code) => {
      clearTimeout(delai);
      if (code === 0) resolve(sortie);
      else reject(new Error(erreur.trim() || `${executable} s'est arrêté avec le code ${code}`));
    });
  });
}

const MOIS = new Map(
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(
    (mois, index) => [mois, index],
  ),
);

function dateClaude(texte, maintenant) {
  const resultat = texte.match(/([A-Z][a-z]{2}) (\d{1,2}) at (\d{1,2}):(\d{2})(am|pm)/);
  if (!resultat) throw new Error('Date de réinitialisation Claude illisible');
  const mois = MOIS.get(resultat[1]);
  if (mois === undefined) throw new Error('Mois de réinitialisation Claude illisible');
  let heure = Number(resultat[3]) % 12;
  if (resultat[5] === 'pm') heure += 12;
  let date = new Date(
    maintenant.getFullYear(),
    mois,
    Number(resultat[2]),
    heure,
    Number(resultat[4]),
  );
  if (date.getTime() < maintenant.getTime() - 24 * 60 * 60_000) {
    date = new Date(
      maintenant.getFullYear() + 1,
      mois,
      Number(resultat[2]),
      heure,
      Number(resultat[4]),
    );
  }
  return date.toISOString();
}

function analyserUsageClaude(sortie, maintenant = new Date()) {
  const session = sortie.match(/Current session:\s*([\d.]+)% used\s*·\s*resets (.+?) \(/);
  const semaine = sortie.match(
    /Current week \(all models\):\s*([\d.]+)% used\s*·\s*resets (.+?) \(/,
  );
  if (!session || !semaine) throw new Error('Fenêtres Claude absentes');
  return {
    fenetre5h: {
      restant: restant(Number(session[1])),
      reinitialiseLe: dateClaude(session[2], maintenant),
    },
    hebdomadaire: {
      restant: restant(Number(semaine[1])),
      reinitialiseLe: dateClaude(semaine[2], maintenant),
    },
  };
}

async function limitesChatGPT() {
  const enfant = spawn(CODEX, ['app-server', '--stdio'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let tampon = '';

  return new Promise((resolve, reject) => {
    const finir = (resultat, erreur) => {
      clearTimeout(delai);
      enfant.kill();
      if (erreur) reject(erreur);
      else resolve(resultat);
    };
    const delai = setTimeout(
      () => finir(null, new Error('Lecture des limites ChatGPT trop longue')),
      20_000,
    );
    const envoyer = (message) => enfant.stdin.write(`${JSON.stringify(message)}\n`);

    enfant.once('error', (error) => finir(null, error));
    enfant.stdout.setEncoding('utf8');
    enfant.stdout.on('data', (morceau) => {
      tampon += morceau;
      for (;;) {
        const fin = tampon.indexOf('\n');
        if (fin < 0) break;
        const ligne = tampon.slice(0, fin);
        tampon = tampon.slice(fin + 1);
        if (!ligne.trim()) continue;
        const message = JSON.parse(ligne);
        if (message.id === 1) {
          envoyer({
            id: 2,
            method: 'account/rateLimits/read',
            params: { excludeResetCreditDetails: true },
          });
        }
        if (message.id === 2) {
          if (message.error) return finir(null, new Error('Limites ChatGPT indisponibles'));
          const source = message.result?.rateLimits;
          if (!source?.primary?.resetsAt || !source?.secondary?.resetsAt)
            return finir(null, new Error('Fenêtres ChatGPT absentes'));
          return finir({
            plan: source.planType ?? null,
            fenetre5h: {
              restant: restant(source.primary.usedPercent),
              reinitialiseLe: iso(source.primary.resetsAt),
            },
            hebdomadaire: {
              restant: restant(source.secondary.usedPercent),
              reinitialiseLe: iso(source.secondary.resetsAt),
            },
          });
        }
      }
    });
    envoyer({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'simatis-os', version: '0.1.0' } },
    });
  });
}

async function limitesClaude() {
  const [usage, statut] = await Promise.all([
    executer(CLAUDE, [
      '-p',
      '/usage',
      '--output-format',
      'text',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk',
    ]),
    executer(CLAUDE, ['auth', 'status', '--json']),
  ]);
  const source = analyserUsageClaude(usage);
  const abonnement = JSON.parse(statut).subscriptionType;
  return {
    plan: abonnement ? abonnement[0].toUpperCase() + abonnement.slice(1) : null,
    ...source,
  };
}

async function collecter() {
  const [chatgpt, claude] = await Promise.allSettled([limitesChatGPT(), limitesClaude()]);
  const resultat = {
    actualiseLe: new Date().toISOString(),
    ...(claude.status === 'fulfilled' && claude.value ? { claude: claude.value } : {}),
    ...(chatgpt.status === 'fulfilled' ? { chatgpt: chatgpt.value } : {}),
  };
  const temporaire = `${SORTIE}.tmp`;
  await writeFile(temporaire, `${JSON.stringify(resultat, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaire, SORTIE);
  console.log(
    `Limites IA actualisées : Claude ${resultat.claude ? 'ok' : 'non connecté'}, ChatGPT ${resultat.chatgpt ? 'ok' : 'indisponible'}`,
  );
}

async function main() {
  await collecter();
  if (SURVEILLER) setInterval(() => void collecter().catch(console.error), CINQ_MINUTES);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { analyserUsageClaude };
