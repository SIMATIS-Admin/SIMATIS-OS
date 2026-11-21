// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AjoutRadar } from './AjoutRadar.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reponse = (corps: unknown, statut = 200) =>
  Promise.resolve(new Response(JSON.stringify(corps), { status: statut }));

type Appel = { url: string; init?: RequestInit };
const simuler = (
  contacts: unknown[] = [],
  envoi: () => Promise<Response> = () => reponse({ id: 'a', contactId: 'c' }, 201),
) => {
  const appels: Appel[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      appels.push({ url, init });
      return url.includes('/radar/entrees') ? envoi() : reponse(contacts);
    }),
  );
  return appels;
};
const corpsEnvoye = (appels: Appel[]) =>
  JSON.parse(String(appels.find((a) => a.url.includes('/radar/entrees'))?.init?.body)) as Record<
    string,
    unknown
  >;
const rendre = (origines: string[] = []) => {
  const onFerme = vi.fn();
  const onAjoute = vi.fn();
  render(<AjoutRadar slug="demo" origines={origines} onFerme={onFerme} onAjoute={onAjoute} />);
  return { onFerme, onAjoute };
};

it('envoie le formulaire rempli : nom, mail, entreprise, canal LinkedIn par défaut, étape 0', async () => {
  const appels = simuler();
  const { onAjoute, onFerme } = rendre();
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Fictive' } });
  fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } });
  fireEvent.change(screen.getByLabelText('Entreprise'), { target: { value: 'Société Exemple' } });
  fireEvent.change(screen.getByLabelText('Adresse mail'), {
    target: { value: 'alice@exemple.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  await waitFor(() => expect(onAjoute).toHaveBeenCalled());
  expect(onFerme).toHaveBeenCalled();
  expect(corpsEnvoye(appels)).toEqual({
    prenom: 'Alice',
    nom: 'Fictive',
    entreprise: 'Société Exemple',
    email: 'alice@exemple.test',
    canal: 'LinkedIn',
    etape: 0,
  });
});

it('le nom est obligatoire : pas d’envoi sans lui, message en français', async () => {
  const appels = simuler();
  rendre();
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Le nom est obligatoire.');
  expect(appels.some((a) => a.url.includes('/radar/entrees'))).toBe(false);
});

it('propose les contacts connus pendant la saisie, et en choisir un envoie son contactId', async () => {
  const appels = simuler([
    { id: 'c1', nom: 'Bruno Connu', entreprise: 'Société Connue', email: null },
  ]);
  const { onAjoute } = rendre();
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Bruno' } });
  fireEvent.click(await screen.findByRole('button', { name: /Bruno Connu/ }));
  expect(screen.getByText(/Contact existant : Bruno Connu/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  await waitFor(() => expect(onAjoute).toHaveBeenCalled());
  expect(corpsEnvoye(appels)).toMatchObject({ nom: 'Bruno Connu', contactId: 'c1' });
});

it('les origines déjà utilisées sont proposées', () => {
  simuler();
  rendre(['Origine A', 'Origine B']);
  const options = Array.from(document.querySelectorAll('datalist option')).map((o) =>
    o.getAttribute('value'),
  );
  expect(options).toEqual(['Origine A', 'Origine B']);
});

it('une erreur serveur s’affiche et garde le formulaire rempli', async () => {
  simuler([], () => reponse({ error: 'Ce contact a déjà une affaire ouverte.' }, 400));
  const { onAjoute } = rendre();
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Fictive' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  expect((await screen.findByRole('alert')).textContent).toContain('déjà une affaire ouverte');
  expect(onAjoute).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Nom') as HTMLInputElement).value).toBe('Fictive');
});
