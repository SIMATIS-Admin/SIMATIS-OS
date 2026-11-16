// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EngagementIA } from './EngagementIA.js';

describe('EngagementIA', () => {
  let enregistre: unknown[];
  beforeEach(() => {
    enregistre = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          enregistre.push(JSON.parse(init.body as string));
          return Promise.resolve(new Response(JSON.stringify({ options: {} })));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              favoris: [],
              options: { ensuite: true, claudeEngage: true, chatgptEngage: false },
            }),
          ),
        );
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("allume les IA engagées et grise les autres, indépendamment l'une de l'autre", async () => {
    render(<EngagementIA />);
    const claude = screen.getByRole('button', { name: 'Claude' });
    const chatgpt = screen.getByRole('button', { name: 'ChatGPT' });
    await waitFor(() => expect(chatgpt.getAttribute('aria-pressed')).toBe('false'));
    expect(claude.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chatgpt);
    expect(chatgpt.getAttribute('aria-pressed')).toBe('true');
    expect(claude.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(enregistre).toEqual([{ chatgptEngage: true }]));
    fireEvent.click(claude);
    expect(claude.getAttribute('aria-pressed')).toBe('false');
    await waitFor(() =>
      expect(enregistre).toEqual([{ chatgptEngage: true }, { claudeEngage: false }]),
    );
  });

  it("revient en arrière si le changement n'est pas enregistré", async () => {
    render(<EngagementIA />);
    const claude = screen.getByRole('button', { name: 'Claude' });
    await waitFor(() => expect(claude.getAttribute('aria-pressed')).toBe('true'));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))),
    );
    fireEvent.click(claude);
    await waitFor(() => expect(claude.getAttribute('aria-pressed')).toBe('true'));
  });
});
