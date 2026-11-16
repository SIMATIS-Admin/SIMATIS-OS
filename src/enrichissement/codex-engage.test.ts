import { describe, expect, it, vi } from 'vitest';
import { ErreurIA } from './client.js';
import { exigerChatgptEngage } from './codex.js';

const demande = { consigne: 'c', entree: 'e', schema: {} };

describe('exigerChatgptEngage', () => {
  it('laisse passer la recherche quand ChatGPT est engagé', async () => {
    const demander = vi.fn().mockResolvedValue({ json: { ok: 1 }, jetons: 0 });
    const client = exigerChatgptEngage({ demander }, () => Promise.resolve(true));
    await expect(client.demander(demande)).resolves.toEqual({ json: { ok: 1 }, jetons: 0 });
    expect(demander).toHaveBeenCalledOnce();
  });

  it("refuse la recherche avec un message clair quand ChatGPT n'est pas engagé", async () => {
    const demander = vi.fn();
    const client = exigerChatgptEngage({ demander }, () => Promise.resolve(false));
    const echec = await client.demander(demande).catch((e: unknown) => e);
    expect(echec).toBeInstanceOf(ErreurIA);
    expect((echec as ErreurIA).message).toContain('ChatGPT n’est pas engagé');
    expect(demander).not.toHaveBeenCalled();
  });
});
