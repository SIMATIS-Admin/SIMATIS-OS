// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./Inbox.js', () => ({ Inbox: ({ slug }: { slug: string }) => <p>Inbox de {slug}</p> }));
vi.mock('./Brief.js', () => ({ Brief: ({ slug }: { slug: string }) => <p>Brief de {slug}</p> }));

import { Cockpit } from './Cockpit.js';

describe('Cockpit', () => {
  afterEach(cleanup);

  it("réunit l'Inbox puis le brief du jour, pour la même instance", () => {
    render(<Cockpit slug="simatis" />);
    const inbox = screen.getByRole('region', { name: 'Inbox' });
    const brief = screen.getByRole('region', { name: 'Brief du jour' });
    expect(inbox.textContent).toBe('Inbox de simatis');
    expect(brief.textContent).toBe('Brief de simatis');
    // L'Inbox vient avant le brief : c'est là que l'on agit en premier.
    expect(inbox.compareDocumentPosition(brief)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
