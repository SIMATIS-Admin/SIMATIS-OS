// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SuspectsBase } from './SuspectsBase.js';

describe('SuspectsBase', () => {
  afterEach(cleanup);

  it('liste les fiches de la base avec un lien vers les Bases vivantes', () => {
    render(
      <SuspectsBase
        slug="simatis"
        suspects={[
          {
            id: 's1',
            nom: 'Alice Martin',
            entreprise: 'Société Fictive',
            fonction: 'Directrice',
            email: null,
            telephone: null,
          },
        ]}
      />,
    );
    expect(screen.getByText('Alice Martin')).toBeTruthy();
    expect(screen.getByText('Société Fictive')).toBeTruthy();
    expect(screen.getByText(/1 fiche pas encore dans le CRM/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Ouvrir les Bases vivantes' }).getAttribute('href'),
    ).toBe('#/simatis/bases');
  });

  it("n'affiche rien quand il n'y a aucun suspect", () => {
    const { container } = render(<SuspectsBase slug="simatis" suspects={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
