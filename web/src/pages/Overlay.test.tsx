// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Overlay.js';

describe('Modal', () => {
  afterEach(cleanup);

  it('confines focus, closes with Escape and restores the previous focus', () => {
    const close = vi.fn();
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const { unmount } = render(
      <Modal title="Modifier" onClose={close}>
        <input aria-label="Nom" />
        <button>Enregistrer</button>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Modifier' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fermer' }));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Enregistrer' }));
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fermer' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(before);
    before.remove();
  });
});
