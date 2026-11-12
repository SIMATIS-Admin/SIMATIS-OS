const { spawn } = require('node:child_process');
const { readFile, rename, writeFile } = require('node:fs/promises');
const { homedir } = require('node:os');
const path = require('node:path');

const CODEX =
  process.env.CODEX_BIN ??
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const SORTIE = path.resolve(process.env.IA_LIMITS_FILE ?? 'secrets/ia-limites.json');
const SURVEILLER = process.argv.includes('--watch');
const CINQ_MINUTES = 5 * 60_000;

const iso = (secondes) => new Date(secondes * 1000).toISOString();
const restant = (utilise) => Math.max(0, Math.min(100, 100 - utilise));

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

async function jetonClaude() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    const brut = JSON.parse(await readFile(path.join(homedir(), '.claude', '.credentials.json')));
    return brut.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

async function limitesClaude() {
  const jeton = await jetonClaude();
  if (!jeton) return null;
  const reponse = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      authorization: `Bearer ${jeton}`,
      'anthropic-beta': 'oauth-2025-04-20',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!reponse.ok) throw new Error(`Limites Claude indisponibles (${reponse.status})`);
  const source = await reponse.json();
  if (!source.five_hour?.resets_at || !source.seven_day?.resets_at)
    throw new Error('Fenêtres Claude absentes');
  return {
    plan: null,
    fenetre5h: {
      restant: restant(source.five_hour.utilization),
      reinitialiseLe: source.five_hour.resets_at,
    },
    hebdomadaire: {
      restant: restant(source.seven_day.utilization),
      reinitialiseLe: source.seven_day.resets_at,
    },
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

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
