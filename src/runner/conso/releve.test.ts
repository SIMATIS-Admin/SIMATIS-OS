import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Releve } from '../../ia/conso/service.js';
import { classerClaude, classerCodex, sujetDe, tourConso, type DossiersConso } from './releve.js';

const SID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SID_COWORK = 'bbbbbbbb-0000-4000-8000-000000000002';
const SID_EXEC = 'dddddddd-0000-4000-8000-000000000004';

const ligneAssistant = (sid: string, at: string, id: string, entrypoint: string, entree = 1) =>
  JSON.stringify({
    type: 'assistant',
    sessionId: sid,
    timestamp: at,
    uuid: id,
    cwd: '/tmp/fictif',
    entrypoint,
    message: {
      id,
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: entree,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });

let racine: string;
let dossiers: DossiersConso;

beforeEach(async () => {
  racine = await mkdtemp(path.join(tmpdir(), 'conso-ia-test-'));
  dossiers = {
    claude: path.join(racine, 'claude'),
    cowork: path.join(racine, 'cowork'),
    codex: path.join(racine, 'codex', 'sessions'),
  };
  const projet = path.join(dossiers.claude, '-tmp-projet-fictif');
  await mkdir(path.join(projet, SID, 'subagents'), { recursive: true });
  await writeFile(
    path.join(projet, `${SID}.jsonl`),
    await readFile('test/fixtures/conso-ia/claude-code.jsonl', 'utf8'),
  );
  await writeFile(
    path.join(projet, SID, 'subagents', 'agent-fictif.jsonl'),
    ligneAssistant(SID, '2026-11-10T10:20:00.000Z', 'msg_sous_agent', 'claude-desktop') + '\n',
  );
  const executeur = path.join(dossiers.claude, '-private-var-folders-T-simatis-runner-x');
  await mkdir(executeur, { recursive: true });
  await writeFile(
    path.join(executeur, `${SID_EXEC}.jsonl`),
    ligneAssistant(SID_EXEC, '2026-11-10T11:00:00.000Z', 'msg_exec', 'sdk-cli') + '\n',
  );
  const cowork = path.join(dossiers.cowork, 'org', 'local_1', '.claude', 'projects', '-cowork');
  await mkdir(cowork, { recursive: true });
  await writeFile(
    path.join(cowork, `${SID_COWORK}.jsonl`),
    await readFile('test/fixtures/conso-ia/cowork.jsonl', 'utf8'),
  );
  const jour = path.join(dossiers.codex, '2026', '11', '10');
  await mkdir(jour, { recursive: true });
  await writeFile(
    path.join(jour, 'rollout-2026-11-10T12-00-00-fictif.jsonl'),
    await readFile('test/fixtures/conso-ia/codex.jsonl', 'utf8'),
  );
});

afterEach(async () => {
  await rm(racine, { recursive: true, force: true });
});

function fauxServeur(statut = 200) {
  const envois: Releve[] = [];
  const fetch: typeof globalThis.fetch = (_url, init) => {
    envois.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Releve);
    return Promise.resolve(new Response('{"ok":true}', { status: statut }));
  };
  return { envois, fetch };
}

const opts = (f: typeof globalThis.fetch) => ({
  base: 'http://os',
  token: 't',
  claude: 'claude',
  fetch: f,
});
const sansPr = () => Promise.resolve(null);

describe('tourConso', () => {
  it('envoie un cumul par session, heure et modèle', async () => {
    const s = fauxServeur();
    await tourConso(opts(s.fetch), { depuis: new Date(Date.now() - 3_600_000) }, dossiers, sansPr);
    const cumuls = s.envois.flatMap((e) => e.cumuls).filter((c) => c.sessionId === `claude:${SID}`);
    expect(cumuls.map((c) => c.heure)).toEqual([
      '2026-11-10T09:00:00.000Z',
      '2026-11-10T10:00:00.000Z',
    ]);
  });

  it('un sous-agent compte pour sa session', async () => {
    const s = fauxServeur();
    await tourConso(opts(s.fetch), { depuis: new Date(Date.now() - 3_600_000) }, dossiers, sansPr);
    const envoi = s.envois.flatMap((e) => e.cumuls);
    expect(envoi.find((c) => c.heure === '2026-11-10T10:00:00.000Z')?.entree).toBe(21);
    const sessions = s.envois.flatMap((e) => e.sessions).map((x) => x.id);
    expect(sessions.filter((id) => id.startsWith('claude:'))).toHaveLength(3);
  });

  it('classe Cowork, Code, exécuteur et Codex', async () => {
    const s = fauxServeur();
    await tourConso(opts(s.fetch), { depuis: new Date(Date.now() - 3_600_000) }, dossiers, sansPr);
    const outils = Object.fromEntries(
      s.envois.flatMap((e) => e.sessions).map((x) => [x.id, x.outil]),
    );
    expect(outils).toEqual({
      [`claude:${SID}`]: 'code',
      [`claude:${SID_EXEC}`]: 'executeur',
      [`claude:${SID_COWORK}`]: 'cowork',
      'chatgpt:cccccccc-0000-4000-8000-000000000003': 'executeur',
    });
    expect(s.envois.flatMap((e) => e.jauges)).toHaveLength(3);
  });

  it('n’avance pas après un échec d’envoi', async () => {
    const s = fauxServeur(500);
    const depuis = new Date(Date.now() - 3_600_000);
    const etat = { depuis };
    await expect(tourConso(opts(s.fetch), etat, dossiers, sansPr)).rejects.toThrow('500');
    expect(etat.depuis).toBe(depuis);
    const ok = fauxServeur();
    await tourConso(opts(ok.fetch), etat, dossiers, sansPr);
    expect(etat.depuis.getTime()).toBeGreaterThan(depuis.getTime());
  });
});

describe('robustesse du relevé', () => {
  it('un titre trop long est tronqué au lieu de bloquer le relevé', async () => {
    const projet = path.join(dossiers.claude, '-tmp-projet-fictif');
    const sid = 'eeeeeeee-0000-4000-8000-000000000005';
    await writeFile(
      path.join(projet, `${sid}.jsonl`),
      ligneAssistant(sid, '2026-11-10T15:00:00.000Z', 'msg_long', 'claude-desktop') +
        '\n' +
        JSON.stringify({ type: 'custom-title', customTitle: 'T'.repeat(400), sessionId: sid }) +
        '\n',
    );
    const s = fauxServeur();
    await tourConso(opts(s.fetch), { depuis: new Date(Date.now() - 3_600_000) }, dossiers, sansPr);
    const session = s.envois.flatMap((e) => e.sessions).find((x) => x.id === `claude:${sid}`);
    expect(session?.sujet.length).toBeLessThanOrEqual(200);
    expect(session?.titre?.length).toBeLessThanOrEqual(300);
  });

  it('une session Codex répartie sur deux fichiers n’est envoyée qu’une fois', async () => {
    const jour = path.join(dossiers.codex, '2026', '11', '10');
    await writeFile(
      path.join(jour, 'rollout-2026-11-10T13-00-00-reprise.jsonl'),
      await readFile('test/fixtures/conso-ia/codex.jsonl', 'utf8'),
    );
    const s = fauxServeur();
    await tourConso(opts(s.fetch), { depuis: new Date(Date.now() - 3_600_000) }, dossiers, sansPr);
    const ids = s.envois.flatMap((e) => e.sessions).map((x) => x.id);
    expect(ids.filter((id) => id.startsWith('chatgpt:'))).toHaveLength(1);
    const cumuls = s.envois
      .flatMap((e) => e.cumuls)
      .filter((c) => c.sessionId.startsWith('chatgpt:'));
    expect(new Set(cumuls.map((c) => `${c.heure}|${c.modele}`)).size).toBe(cumuls.length);
  });
});

describe('passage annoncé à l’OS', () => {
  it('seul le dernier envoi annonce le nouveau passage', async () => {
    const s = fauxServeur();
    const depuis = new Date(Date.now() - 3_600_000);
    await tourConso(opts(s.fetch), { depuis }, dossiers, sansPr);
    expect(s.envois.length).toBeGreaterThan(1);
    // Tant que tout n'est pas envoyé, l'OS garde l'ancien passage : l'archive attend la fin.
    expect(s.envois.slice(0, -1).every((e) => e.passage === depuis.toISOString())).toBe(true);
    expect(s.envois.at(-1)?.passage).not.toBe(depuis.toISOString());
  });
});

describe('classement et sujet', () => {
  it('classe les outils', () => {
    expect(
      classerClaude('/x/cowork/a.jsonl', { ...dossiers, cowork: '/x/cowork' }, 'local-agent'),
    ).toBe('cowork');
    expect(classerClaude('/x/claude/p/a.jsonl', dossiers, 'sdk-cli')).toBe('executeur');
    expect(classerClaude('/x/claude/p/a.jsonl', dossiers, 'claude-desktop')).toBe('code');
    expect(classerCodex('Codex Desktop')).toBe('codex');
    expect(classerCodex('codex_work_desktop')).toBe('agent');
    expect(classerCodex('codex_exec')).toBe('executeur');
  });

  it('sujet : PR, branche, titre, question', async () => {
    const pr = (branche: string) => Promise.resolve(branche === 'feature/a' ? 12 : null);
    const s = (o: Partial<Parameters<typeof sujetDe>[0]>) =>
      sujetDe({ outil: 'code', branche: null, titre: null, cwd: null, ...o }, pr);
    expect(await s({ branche: 'feature/a' })).toBe('PR #12');
    expect(await s({ branche: 'feature/b' })).toBe('feature/b');
    expect(await s({ branche: 'main', titre: 'Titre fictif' })).toBe('Titre fictif');
    expect(await s({})).toBe('question');
    expect(await s({ outil: 'cowork' })).toBe('Cowork');
  });
});
