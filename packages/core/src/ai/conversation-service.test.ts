import { describe, expect, it } from 'vitest';
import { compactToolResult, nextSeq, truncateRawOutput } from './conversation-service';

describe('ukládání zpráv konverzace', () => {
  it('pořadí zpráv je hustá řada od jedničky', () => {
    expect(nextSeq([])).toBe(1);
    expect(nextSeq([{ seq: 1 }, { seq: 2 }])).toBe(3);
  });

  it('výsledek compose_template se neukládá celý, jen shrnutí', () => {
    const compacted = compactToolResult('composeTemplate', {
      templateDraftId: 'd1',
      preview: { sections: new Array(6).fill({ kind: 'article', body: 'x'.repeat(5000) }) },
    });
    expect(compacted).toEqual({
      type: 'tool-result',
      toolName: 'composeTemplate',
      result: { templateDraftId: 'd1', sectionCount: 6 },
    });
    expect(JSON.stringify(compacted).length).toBeLessThan(300);
  });

  it('výsledky ostatních nástrojů se ukládají tak, jak jsou', () => {
    const compacted = compactToolResult('suggestSubject', { variants: [{ subject: 'Ahoj' }] });
    expect(compacted).toEqual({
      type: 'tool-result',
      toolName: 'suggestSubject',
      result: { variants: [{ subject: 'Ahoj' }] },
    });
  });

  it('surová odpověď modelu se do zprávy ukládá zkrácená na 4000 znaků', () => {
    expect(truncateRawOutput('a'.repeat(10_000))).toHaveLength(4000);
    expect(truncateRawOutput('krátká')).toBe('krátká');
    expect(truncateRawOutput(undefined)).toBeNull();
  });
});
