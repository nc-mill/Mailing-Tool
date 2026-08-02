import { describe, expect, it } from 'vitest';
import { handlerModulePath, queue } from '../../queues';
import { handlers as aiHandlers } from './queue-handlers';

describe('registrace handlerů pro codegen workeru', () => {
  it('fronta retence konverzací má handler', () => {
    expect(aiHandlers['ai.cleanup_conversations']).toBeTypeOf('function');
  });

  /**
   * Pojistka proti tomu, na čem plán dřív ztroskotal: handler ležel v
   * `src/brand/jobs`, ale codegen ho hledá podle PREFIXU JMÉNA FRONTY, tedy
   * v `src/content/jobs`. Soubor by nikdo nenašel a nic by nespadlo.
   */
  it('cesta souboru odpovídá tomu, kde ji codegen hledá', () => {
    expect(handlerModulePath(queue('ai.cleanup_conversations'))).toBe(
      'packages/core/src/ai/jobs/queue-handlers.ts',
    );
    expect(handlerModulePath(queue('content.brand_extract'))).toBe(
      'packages/core/src/content/jobs/queue-handlers.ts',
    );
  });
});
