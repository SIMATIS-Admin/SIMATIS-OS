// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignatureProspection } from '../../api.js';
import { ProspectionReglages } from './ProspectionReglages.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let signatures: SignatureProspection[] = [];
let objectif = 30;
let refus: string | null = null;

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (method === 'GET') {
    return json({
      stats: { objectif, jour: 0, semaine: 0 },
      signatures,
      recentes: [],
    });
  }
  if (refus) return json({ error: refus }, 400);
  if (method === 'POST') {
    signatures = [
      ...signatures,
      { id: 's2', nom: 'Simatis et Kairos', defaut: false, typeMime: 'image/png' },
    ];
    return json(signatures[signatures.length - 1], 201);
  }
  if (method === 'PUT' && url.endsWith('/objectif'))
    objectif = (calls.at(-1)?.body as { objectif: number }).objectif;
  if (method === 'PATCH') {
    const champs = calls.at(-1)?.body as { nom?: string; defaut?: boolean };
    signatures = signatures.map((s) => ({
      ...s,
      ...(champs.nom && url.endsWith(s.id) ? { nom: champs.nom } : {}),
      ...(champs.defaut !== undefined ? { defaut: url.endsWith(s.id) && champs.defaut } : {}),
    }));
  }
  if (method === 'DELETE') signatures = signatures.filter((s) => !url.endsWith(s.id));
  return json({ ok: true });
}

const un = { id: 's1', nom: 'Simatis', defaut: true, typeMime: 'image/png' };

beforeEach(() => {
  calls = [];
  signatures = [un];
  objectif = 30;
  refus = null;
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fichier = (nom = 'signature.png', type = 'image/png') =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], nom, { type });

describe('Réglages de la prospection', () => {
  it("liste les signatures avec un aperçu de l'image et le défaut coché", async () => {
    render(<ProspectionReglages slug="simatis" />);
    expect(await screen.findByText('Simatis')).toBeTruthy();
    const img = screen.getByRole('img', { name: /Simatis/ });
    expect(img.getAttribute('src')).toBe('/api/i/simatis/prospection/signatures/s1/image');
    expect((screen.getByLabelText(/par défaut/) as HTMLInputElement).checked).toBe(true);
  });

  it('ajoute une signature à partir d’un fichier PNG et recharge la liste', async () => {
    render(<ProspectionReglages slug="simatis" />);
    await screen.findByText('Simatis');
    fireEvent.change(screen.getByLabelText('Nom de la nouvelle signature'), {
      target: { value: 'Simatis et Kairos' },
    });
    fireEvent.change(screen.getByLabelText('Image de la nouvelle signature'), {
      target: { files: [fichier()] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la signature' }));
    expect(await screen.findByText('Simatis et Kairos')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({ nom: 'Simatis et Kairos', typeMime: 'image/png' });
    expect((post?.body as { imageBase64: string }).imageBase64.length).toBeGreaterThan(0);
  });

  it('exige un nom et un fichier avant d’ajouter', async () => {
    render(<ProspectionReglages slug="simatis" />);
    await screen.findByText('Simatis');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la signature' }));
    expect(await screen.findByText(/nom et une image/i)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it("affiche le refus de l'API (image trop lourde)", async () => {
    refus = 'Image trop lourde : 400 Ko au maximum.';
    render(<ProspectionReglages slug="simatis" />);
    await screen.findByText('Simatis');
    fireEvent.change(screen.getByLabelText('Nom de la nouvelle signature'), {
      target: { value: 'Lourde' },
    });
    fireEvent.change(screen.getByLabelText('Image de la nouvelle signature'), {
      target: { files: [fichier()] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la signature' }));
    expect(await screen.findByText(/trop lourde/)).toBeTruthy();
  });

  it('renomme une signature', async () => {
    render(<ProspectionReglages slug="simatis" />);
    await screen.findByText('Simatis');
    fireEvent.click(screen.getByRole('button', { name: 'Renommer Simatis' }));
    fireEvent.change(screen.getByLabelText('Nouveau nom de Simatis'), {
      target: { value: 'Simatis seul' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le nom' }));
    expect(await screen.findByText('Simatis seul')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ nom: 'Simatis seul' });
  });

  it('change le défaut', async () => {
    signatures = [un, { id: 's2', nom: 'Kairos', defaut: false, typeMime: 'image/png' }];
    render(<ProspectionReglages slug="simatis" />);
    await screen.findByText('Kairos');
    fireEvent.click(screen.getByLabelText('Kairos : par défaut'));
    await waitFor(() =>
      expect((screen.getByLabelText('Kairos : par défaut') as HTMLInputElement).checked).toBe(true),
    );
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ defaut: true });
  });

  it('supprime après confirmation', async () => {
    render(<ProspectionReglages slug="simatis" />);
    await screen.findByText('Simatis');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Simatis' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
    await waitFor(() => expect(screen.queryByText('Simatis')).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it("enregistre l'objectif quotidien", async () => {
    render(<ProspectionReglages slug="simatis" />);
    await screen.findByText('Simatis');
    fireEvent.change(screen.getByLabelText('Objectif quotidien'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: "Enregistrer l'objectif" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ objectif: 45 }),
    );
  });

  it('propose d’ajouter une première signature quand il n’y en a aucune', async () => {
    signatures = [];
    render(<ProspectionReglages slug="simatis" />);
    expect(await screen.findByText(/Aucune signature/)).toBeTruthy();
  });
});
