import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertCompiledFixture, type CompiledFixture } from '@mlain/contracts/compiled';
import { RESERVED_MARKERS } from '@mlain/contracts/markers';
import { CT_CASES, runCtCase } from './ct-cases';

const require = createRequire(import.meta.url);
const FIXTURES = join(
  dirname(require.resolve('@mlain/contracts/package.json')),
  'fixtures',
  'compiled',
);

const read = (id: string): CompiledFixture =>
  JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), 'utf8')) as CompiledFixture;

describe('contract fixtures CT-*', () => {
  it('ships exactly eighteen fixtures, numbered without a gap', () => {
    expect(CT_CASES).toHaveLength(18);
    expect(CT_CASES.map((c) => c.id)).toEqual(
      Array.from({ length: 18 }, (_, i) => `CT-${String(i + 1).padStart(3, '0')}`),
    );
  });

  it.each(CT_CASES)('$id $description', async (testCase) => {
    const fixture = read(testCase.id);
    const result = await runCtCase(testCase, fixture.context);

    if (fixture.expect.error) {
      expect(result.ok, testCase.id).toBe(false);
      if (result.ok) return;
      expect(
        result.issues.map((i) => i.code),
        testCase.id,
      ).toContain(fixture.expect.error);
      return;
    }

    if (!result.ok) throw new Error(`${testCase.id}: ${JSON.stringify(result.issues)}`);

    // Tvrzení dodává KONTRAKT, ne tenhle balíček. Kdyby si je psal sám,
    // znamenalo by „sedí" na každé straně něco jiného.
    const mismatches = assertCompiledFixture(fixture, { html: result.html, text: result.text });
    expect(mismatches, `${testCase.id}: ${JSON.stringify(mismatches)}`).toEqual([]);
  });

  it('keeps the stored compiled output in sync with the renderer', async () => {
    for (const testCase of CT_CASES) {
      const fixture = read(testCase.id);
      const result = await runCtCase(testCase, fixture.context);
      if (fixture.expect.error) {
        // Klíč `compiled` je podle schématu kontraktu povinný i tady, ale
        // z nekompilovatelného dokumentu nemůže být nic jiného než prázdný.
        expect(fixture.compiled, `${testCase.id} chybový případ`).toEqual({ html: '', text: '' });
        expect(result.ok, testCase.id).toBe(false);
        continue;
      }
      if (!result.ok) throw new Error(`${testCase.id}: ${JSON.stringify(result.issues)}`);
      // Bez tohohle by uložený `compiled` mohl zestárnout a Go strana by
      // testovala výstup, který dnešní renderer už nevydává.
      expect(fixture.compiled?.html, `${testCase.id} html`).toBe(result.html);
      expect(fixture.compiled?.text, `${testCase.id} text`).toBe(result.text);
    }
  });

  it('leaves no reserved marker unresolved in any fixture output', () => {
    for (const testCase of CT_CASES) {
      const fixture = read(testCase.id);
      if (!fixture.compiled) continue;
      for (const marker of RESERVED_MARKERS) {
        // Značka odkazu obsahuje `mlain.invalid` schválně, tu nahrazuje sender.
        if (marker === 'mlain.invalid') continue;
        // Slot pixelu tam naopak zůstat MÁ, nahrazuje ho taky sender.
        if (marker === 'ML_OPEN_PIXEL') continue;
        const haystack = `${fixture.compiled.html}\n${fixture.compiled.text}`.toUpperCase();
        expect(haystack.includes(marker.toUpperCase()), `${testCase.id} ${marker}`).toBe(false);
      }
    }
  });
});
