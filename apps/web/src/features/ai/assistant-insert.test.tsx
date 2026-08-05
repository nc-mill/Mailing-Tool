import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import csAi from '@mlain/i18n/messages/cs/ai.json';
import { draftFromToolOutput } from './use-ai-chat';

const replaceDocument = vi.fn();
const state = { document: { schemaVersion: 1, blocks: [{ id: 'b1' }] }, designHash: 'puvodni' };

vi.mock('@/features/editor/state/use-editor', () => ({
  useEditorStore: () => ({ getState: () => state, replaceDocument }),
}));

const chat = {
  status: 'ready' as const,
  step: 'validate' as const,
  text: '',
  errorCode: null as string | null,
  draft: null as { document: unknown; designHash: string | null } | null,
  send: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
};

// Modul se importuje jmenovitě, ne přes `typeof import(...)` v anotaci:
// pravidlo `consistent-type-imports` takové anotace zakazuje.
import type * as useAiChatModule from './use-ai-chat';

vi.mock('./use-ai-chat', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof useAiChatModule;
  return { ...actual, useAiChat: () => chat };
});

const { AiAssistantPanel } = await import('./assistant-panel');

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ ai: csAi }} timeZone="Europe/Prague">
      {ui}
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  replaceDocument.mockClear();
  chat.draft = null;
  chat.errorCode = null;
});

describe('vložení výsledku do editoru', () => {
  it('výstup nástroje se čte jako dokument, ne jako text', () => {
    expect(draftFromToolOutput({ document: { schemaVersion: 1, blocks: [] } })).toMatchObject({
      document: { schemaVersion: 1, blocks: [] },
    });
    expect(draftFromToolOutput({ blocks: [] })).not.toBeNull();
  });

  it('holý text není dokument a do editoru se nedostane', () => {
    expect(draftFromToolOutput('Ahoj, tady je váš e-mail.')).toBeNull();
    expect(draftFromToolOutput({ text: 'Ahoj' })).toBeNull();
    expect(draftFromToolOutput(null)).toBeNull();
  });

  it('hotový návrh se vkládá přes blokový model, ne jako text', () => {
    chat.draft = { document: { schemaVersion: 1, blocks: [{ id: 'novy' }] }, designHash: 'novy' };
    wrap(<AiAssistantPanel templateId="t1" workspaceId="w1" hasCredential brandName={null} />);

    expect(replaceDocument).toHaveBeenCalledTimes(1);
    const [document, hash] = replaceDocument.mock.calls[0] as [
      { blocks: Array<{ id: string }> },
      string,
    ];
    expect(document.blocks[0]?.id).toBe('novy');
    expect(hash).toBe('novy');
    // A teprve po vložení se nabízí rozhodnutí o návrhu.
    expect(screen.getByRole('button', { name: 'Nechat si ho' })).toBeInTheDocument();
  });

  it('Zkusit jinak vrátí původní dokument, práce se neztratí', () => {
    chat.draft = { document: { schemaVersion: 1, blocks: [{ id: 'novy' }] }, designHash: 'novy' };
    wrap(<AiAssistantPanel templateId="t1" workspaceId="w1" hasCredential brandName={null} />);
    replaceDocument.mockClear();

    screen.getByRole('button', { name: 'Zkusit jinak' }).click();

    expect(replaceDocument).toHaveBeenCalledWith(state.document, 'puvodni');
  });
});
