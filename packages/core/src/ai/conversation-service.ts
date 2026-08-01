export const MAX_RAW_OUTPUT_CHARS = 4000;

export function nextSeq(existing: readonly { seq: number }[]): number {
  return existing.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
}

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
