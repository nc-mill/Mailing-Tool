export const MAX_RAW_OUTPUT_CHARS = 4000;

/*
 * SMAZANÁ FUNKCE `nextSeq`, ZÁMĚRNĚ A NATRVALO. Plán P15 (úkol 12) počítal
 * s tím, že se pořadí zprávy dopočítá v aplikaci z už načtených řádků. Tak se
 * to ale nedělá: `repo.appendMessage` dosazuje `seq` poddotazem uvnitř téhož
 * `INSERT`, protože dva dotazy za sebou by při souběžných zprávách spadly na
 * unikátním indexu `uq_ai_messages__ws_conversation_seq`.
 *
 * Nebylo to tedy zapomenuté zapojení, ale funkce, kterou produkce vědomě
 * nahradila lepším řešením. Kdyby ji někdo zapojil, aby přestala být mrtvým
 * kódem, vrátil by tím souběhovou vadu.
 */

export type CompactedToolResult = {
  type: 'tool-result';
  toolName: string;
  result: unknown;
};

/**
 * `composeTemplate` vrací celý návrh, tedy desítky kilobajtů. Do `ai_messages`
 * se ukládá jen shrnutí; kdo chce vidět, co vzniklo, otevře verzi šablony.
 */
export function compactToolResult(toolName: string, result: unknown): CompactedToolResult {
  if (toolName === 'composeTemplate') {
    const typed = result as { templateDraftId?: string; preview?: { sections?: unknown[] } } | null;
    return {
      type: 'tool-result',
      toolName,
      result: {
        templateDraftId: typed?.templateDraftId ?? null,
        sectionCount: typed?.preview?.sections?.length ?? 0,
      },
    };
  }
  return { type: 'tool-result', toolName, result };
}

export function truncateRawOutput(text: string | undefined): string | null {
  if (text === undefined) return null;
  return text.length > MAX_RAW_OUTPUT_CHARS ? text.slice(0, MAX_RAW_OUTPUT_CHARS) : text;
}
