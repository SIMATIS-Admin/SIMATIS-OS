// Lancement de Codex pour les tâches que Claude exécute avec des outils MCP : routines, ajout à
// l'Inbox, campagnes. Codex n'a ni skills ni `--allowedTools` : la skill est collée dans la consigne,
// les outils sont limités par la config du serveur MCP, et le jeton ne passe que par l'environnement.

export const PREFIXE_OUTILS_SIMATIS = 'mcp__simatis__';
export const VARIABLE_JETON = 'SIMATIS_MCP_TOKEN';

export type LancementCodex = {
  args: string[];
  cwd?: string;
  env: Record<string, string>;
};

export function argumentsCodex(a: {
  base: string;
  token: string;
  consigne: string;
  // Outils MCP autorisés, au nom de Claude (`mcp__simatis__x`, ou `mcp__simatis__*` pour tous ceux de l'instance).
  outils: string[];
  // Second cerveau : le seul dossier où Codex peut écrire. Sans lui, Codex n'a que les outils MCP.
  cerveau?: string;
}): LancementCodex {
  const simatis = a.outils
    .filter((o) => o.startsWith(PREFIXE_OUTILS_SIMATIS))
    .map((o) => o.slice(PREFIXE_OUTILS_SIMATIS.length));
  const tous = simatis.includes('*');
  const args = [
    'exec',
    '--ignore-user-config',
    '--skip-git-repo-check',
    '--ephemeral',
    '--sandbox',
    a.cerveau ? 'workspace-write' : 'read-only',
    // Sans second cerveau, Codex n'a rien à lire ni à écrire sur le poste : outil shell coupé.
    ...(a.cerveau ? ['-C', a.cerveau] : ['--disable', 'shell_tool']),
    '-c',
    `mcp_servers.simatis.url=${JSON.stringify(`${a.base}/mcp`)}`,
    '-c',
    `mcp_servers.simatis.bearer_token_env_var=${JSON.stringify(VARIABLE_JETON)}`,
    ...(tous ? [] : ['-c', `mcp_servers.simatis.enabled_tools=${JSON.stringify(simatis)}`]),
    '-c',
    'mcp_servers.simatis.default_tools_approval_mode="approve"',
    '-c',
    'approval_policy="never"',
    a.consigne,
  ];
  return { args, ...(a.cerveau ? { cwd: a.cerveau } : {}), env: { [VARIABLE_JETON]: a.token } };
}
