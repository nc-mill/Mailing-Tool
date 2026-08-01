import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertCompiledFixture, type CompiledFixture } from '../src/compiled';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'compiled',
);
const files = (await readdir(fixturesDir)).filter((f) => f.endsWith('.json')).sort();

describe('kontrakt 5: fixtures kompilované šablony', () => {
  it('adresář je buď prázdný, nebo úplný; nikdy rozdělaný', () => {
    // Data píše P08. Do té doby je adresář prázdný a to je v pořádku.
    // Osmnáct je počet z části 3, tedy od vlastníka kontraktu (nález N6).
    expect(files.length === 0 || files.length === 18).toBe(true);
    if (files.length === 18) {
      expect(files).toEqual(
        Array.from({ length: 18 }, (_, i) => `CT-${String(i + 1).padStart(3, '0')}.json`),
      );
    }
  });

  it.each(files)('%s má vyrenderovaný výstup a jeho tvrzení sedí', async (file) => {
    const fixture = JSON.parse(
      await readFile(path.join(fixturesDir, file), 'utf8'),
    ) as CompiledFixture;
    expect(fixture.compiled, `${fixture.id}: chybí compiled.html a compiled.text`).toBeDefined();
    expect(assertCompiledFixture(fixture, fixture.compiled!)).toEqual([]);
  });

  it('tvrzení odhalí chybějící slot pixelu a přebývající značku', () => {
    const fixture: CompiledFixture = {
      id: 'CT-000',
      description: 'umělá fixture pro test samotného tvrzení',
      document: {},
      context: { trackOpens: true, trackClicks: true, language: 'cs' },
      expect: { clickMarkerCount: 1, hasOpenPixelSlot: true, textContains: ['Odhlásit'] },
    };
    const mismatches = assertCompiledFixture(fixture, { html: '<p>nic</p>', text: 'ML_RAW_0001' });
    const details = mismatches.map((m) => m.detail).join('\n');
    expect(details).toMatch(/značek odkazu je 0/);
    expect(details).toMatch(/slot pixelu/);
    expect(details).toMatch(/neobsahuje "Odhlásit"/);
    expect(details).toMatch(/ML_RAW_/);
  });
});
