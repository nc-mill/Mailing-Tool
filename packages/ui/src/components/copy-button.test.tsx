import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './copy-button';

describe('CopyButton', () => {
  it('zkopíruje hodnotu a přizná to i čtečce', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<CopyButton value="req_01J8XK2M9P" label="Zkopírovat" copiedLabel="Zkopírováno" />);
    await user.click(screen.getByRole('button', { name: /Zkopírovat/ }));

    expect(writeText).toHaveBeenCalledWith('req_01J8XK2M9P');
    expect(screen.getByRole('status')).toHaveTextContent('Zkopírováno');
  });
});
