import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { handlerModulePath, queue } from '../../queues';
import { handlers } from './queue-handlers';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');

describe('registrace handleru extrakce značky pro codegen workeru', () => {
  it('fronta content.brand_extract má handler', () => {
    expect(handlers['content.brand_extract']).toBeTypeOf('function');
  });

  it('cesta souboru odpovídá tomu, kde ji codegen hledá', () => {
    expect(handlerModulePath(queue('content.brand_extract'))).toBe(
      'packages/core/src/content/jobs/queue-handlers.ts',
    );
  });

  /**
   * Pojistka proti pasti mapy `exports`: Node bere v jednom vzoru jen JEDEN
   * zástupný znak a vyhrává nejdelší shoda základu, ne pořadí deklarace.
   * Bez explicitního klíče `./content/jobs` se import z workeru nerozřeší
   * a spadne to až při stavbě produkční image, tedy daleko od příčiny.
   *
   * Totéž hlídá `assertExportsMapCovers` v `apps/worker/codegen.mjs`; tenhle
   * test to říká nahlas i v sérii testů balíčku.
   */
  it('mapa exports má explicitní klíč pro doménu content', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, 'packages/core/package.json'), 'utf8'),
    ) as { exports: Record<string, string> };
    expect(manifest.exports['./content/jobs']).toBe('./src/content/jobs/queue-handlers.ts');
  });
});
