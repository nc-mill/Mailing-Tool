import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createHtmlEngine, createTextEngine } from '../src/liquid/engine';
import { prepareRenderData } from '../src/liquid/prepare-render-data';
import { validateLiquid, type LiquidRoots } from '../src/liquid/validator';
import { writeGoldenReport } from './golden-report';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liquidDir = path.join(packageRoot, 'fixtures', 'liquid');

type Fixture = {
  id: string;
  description: string;
  context?: 'html' | 'text';
  level?: 'authored' | 'compiled';
  template: string;
  data?: Record<string, unknown>;
  presence?: string[];
  expected?: string;
  expect_validation_error?: { code: string; hint_contains?: string };
};

/** Jeden katalog pro všechny fixtures. Fixture, která by potřebovala jiný, by rozešla obě strany. */
const FIELDS: LiquidRoots = {
  contactFirstClass: [
    'first_name',
    'first_name_vocative',
    'greeting',
    'city',
    'country',
    'zip',
    'is_vip',
    'active',
    'age',
    'score',
    'note',
    'tags',
    'signup_at',
    'created_at',
    'email',
  ],
  contactAttrKeys: ['city', 'vs'],
};

const files = (await readdir(liquidDir)).filter((f) => f.endsWith('.json')).sort();
const fixtures: Fixture[] = await Promise.all(
  files.map(
    async (file) => JSON.parse(await readFile(path.join(liquidDir, file), 'utf8')) as Fixture,
  ),
);

const groups: Record<string, number> = {};
/**
 * Id fixtur, které SKUTEČNĚ doběhly. `skipped` se z nich dopočítá jako rozdíl
 * proti celkovému počtu, nikdy se nepíše jako literál. Dřívější znění mělo
 * `skipped: 0` napevno, takže přeskočená fixture byla neviditelná a kontrola
 * „nepřeskočené fixtures" neměřila vůbec nic.
 */
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'liquid',
    total: fixtures.length,
    ids: executed,
    groups,
    files: files.map((file) => path.join(liquidDir, file)),
  });
});

describe('Liquid golden fixtures', () => {
  it('je jich přesně 55 a skupiny sedí se součtem tabulky', () => {
    const group = (id: string): string => `LQ-${id.slice(3, 4)}xx`;
    const byGroup: Record<string, number> = {};
    for (const fixture of fixtures)
      byGroup[group(fixture.id)] = (byGroup[group(fixture.id)] ?? 0) + 1;
    expect(fixtures).toHaveLength(55);
    expect(byGroup).toEqual({
      'LQ-0xx': 8,
      'LQ-1xx': 10,
      'LQ-2xx': 6,
      'LQ-3xx': 8,
      'LQ-4xx': 4,
      'LQ-5xx': 11,
      'LQ-6xx': 4,
      'LQ-7xx': 4,
    });
  });

  it('žádné id se neopakuje a soubor se jmenuje podle id', () => {
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
    expect(files).toEqual(fixtures.map((f) => `${f.id}.json`));
  });

  it.each(fixtures)('$id $description', async (fixture) => {
    const level = fixture.level ?? 'compiled';
    const validation = validateLiquid(fixture.template, {
      level,
      fields: FIELDS,
      template_kind: 'campaign',
    });

    if (fixture.expect_validation_error) {
      expect(validation.ok).toBe(false);
      const issue = validation.issues.find((i) => i.code === fixture.expect_validation_error!.code);
      expect(issue, `čekal se kód ${fixture.expect_validation_error.code}`).toBeDefined();
      if (fixture.expect_validation_error.hint_contains) {
        expect(JSON.stringify(issue)).toContain(fixture.expect_validation_error.hint_contains);
      }
    } else {
      expect(
        validation.ok,
        `fixture musí projít validací: ${JSON.stringify(validation.issues)}`,
      ).toBe(true);
      const engine =
        (fixture.context ?? 'html') === 'html' ? createHtmlEngine() : createTextEngine();
      const data = prepareRenderData(fixture.data ?? {}, {
        fields: [],
        presence: fixture.presence ?? [],
      });
      const rendered = await engine.parseAndRender(fixture.template, data);
      // Bajt po bajtu, žádná normalizace mezer.
      expect(rendered).toBe(fixture.expected);
    }

    // AŽ TADY, jako poslední řádky těla. Kdyby se počítalo nahoře nebo mimo tělo,
    // započítala by se i fixture, která spadla nebo se vůbec nespustila.
    const group = `LQ-${fixture.id.slice(3, 4)}xx`;
    groups[group] = (groups[group] ?? 0) + 1;
    executed.push(fixture.id);
  });
});
