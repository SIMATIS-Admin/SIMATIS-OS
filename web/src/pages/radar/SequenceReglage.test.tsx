// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SequenceReglage, versDelais } from './SequenceReglage.js';

describe('versDelais', () => {
  it('convertit les jours depuis le premier mail en jours entre deux touches', () => {
    expect(versDelais([4, 9, 15])).toEqual([4, 5, 6]);
    expect(versDelais([10])).toEqual([10]);
  });
  it('refuse des jours qui ne croissent pas, nuls ou absents', () => {
    expect(versDelais([9, 4])).toBeNull();
    expect(versDelais([4, 4])).toBeNull();
    expect(versDelais([0, 3])).toBeNull();
    expect(versDelais([])).toBeNull();
    expect(versDelais([Number.NaN])).toBeNull();
  });
});

describe('SequenceReglage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const simuler = () => {
    const appels: { url: string; method?: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: { method?: string; body?: string }) => {
        appels.push({
          url,
          method: init?.method,
          body: init?.body ? (JSON.parse(init.body) as unknown) : undefined,
        });
        const corps =
          init?.method === 'PUT'
            ? { delais: [3, 7], cumul: [3, 10] }
            : { delais: [4, 5, 6], cumul: [4, 9, 15] };
        return Promise.resolve(new Response(JSON.stringify(corps)));
      }),
    );
    return appels;
  };

  it('montre la séquence en jours depuis le premier mail', async () => {
    simuler();
    render(<SequenceReglage slug="simatis" />);
    expect(await screen.findByText('J+4, J+9, J+15')).toBeTruthy();
    expect(screen.getByText(/rien ne part sans votre clic/)).toBeTruthy();
  });

  it('enregistre les nouveaux jours, convertis en jours entre touches', async () => {
    const appels = simuler();
    render(<SequenceReglage slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier la séquence' }));
    fireEvent.change(screen.getByLabelText('Relance 1, jour'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Relance 2, jour'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la dernière' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(appels.find((a) => a.method === 'PUT')?.body).toEqual({ delais: [3, 7] }),
    );
    expect(await screen.findByText('J+3, J+10')).toBeTruthy();
  });

  it('refuse des jours qui ne croissent pas, sans rien enregistrer', async () => {
    const appels = simuler();
    render(<SequenceReglage slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier la séquence' }));
    fireEvent.change(screen.getByLabelText('Relance 2, jour'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(appels.some((a) => a.method === 'PUT')).toBe(false);
  });
});
