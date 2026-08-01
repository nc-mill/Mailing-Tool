import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { writeGoldenReport } from './golden-report';
import {
  CLICK_MARKER_PREFIX,
  countClickMarkers,
  deriveLinkId,
  FILTER_SLOT_PATTERN,
  findLeftoverMarker,
  OPEN_PIXEL_MARKER,
  openPixelHtml,
  RAW_SLOT_PATTERN,
  RESERVED_MARKERS,
  replaceClickMarkers,
  replaceOpenPixel,
} from '../src/markers';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'markers',
);

type MarkerFixture = {
  id: string;
  description: string;
  source: string;
  tracking_domain: string;
  link_tokens: Record<string, string>;
  open_token?: string | null;
  expected: string;
  expected_replacements: number;
};

const files = (await readdir(fixturesDir)).filter((f) => f.endsWith('.json')).sort();
const fixtures: MarkerFixture[] = await Promise.all(
  files.map(
    async (f) => JSON.parse(await readFile(path.join(fixturesDir, f), 'utf8')) as MarkerFixture,
  ),
);
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'markers',
    total: fixtures.length,
    ids: executed,
    files: files.map((file) => path.join(fixturesDir, file)),
  });
});

describe('kontrakt 5: značky', () => {
  it('má přesné tvary značek a čtyři vyhrazené řetězce', () => {
    expect(CLICK_MARKER_PREFIX).toBe('https://track.mlain.invalid/c/');
    expect(OPEN_PIXEL_MARKER).toBe('<!--ML_OPEN_PIXEL-->');
    expect(RESERVED_MARKERS).toEqual(['mlain.invalid', 'ML_OPEN_PIXEL', 'ML_ARG_', 'ML_RAW_']);
  });

  it('vyhrazený řetězec se pozná i malými písmeny', () => {
    // P08 generuje slot syrového bloku malými písmeny, kdežto kontrakt ho píše
    // velkými. Porovnání citlivé na velikost by `ml_raw_0001` propustilo
    // a zbytek značky by odešel příjemci. Rozhodnutí D16.
    expect(findLeftoverMarker('<p>ml_raw_0001</p>')).toBe('ML_RAW_');
    expect(findLeftoverMarker('<p>ML_RAW_0001</p>')).toBe('ML_RAW_');
    expect(findLeftoverMarker('<p>MLAIN.INVALID</p>')).toBe('mlain.invalid');
    expect(findLeftoverMarker('<p>nic zvláštního</p>')).toBeUndefined();
  });

  it('pixel má přesný tvar náhrady', () => {
    expect(openPixelHtml('https://t.example.cz/t/o/t1abc')).toBe(
      '<img src="https://t.example.cz/t/o/t1abc" width="1" height="1" alt="" ' +
        'style="display:none;max-height:0;overflow:hidden" />',
    );
  });

  it('deriveLinkId je deterministické a nulová kampaň dá stabilní hodnotu', () => {
    const a = deriveLinkId('0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071', 1);
    const b = deriveLinkId('0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071', 1);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveLinkId('0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071', 2)).not.toBe(a);
  });

  it('je deset fixtur značek', () => {
    expect(fixtures).toHaveLength(10);
  });

  it.each(fixtures)('$id $description', (fixture) => {
    const clicks = replaceClickMarkers(fixture.source, (linkId) => {
      const token = fixture.link_tokens[linkId];
      if (!token) throw new Error(`neznámé link_id ${linkId}`);
      return `${fixture.tracking_domain}/t/c/${token}`;
    });
    const withPixel = fixture.open_token
      ? replaceOpenPixel(
          clicks.output,
          openPixelHtml(`${fixture.tracking_domain}/t/o/${fixture.open_token}`),
        )
      : replaceOpenPixel(clicks.output, '');

    expect(withPixel.output).toBe(fixture.expected);
    expect(clicks.count).toBe(fixture.expected_replacements);
    expect(findLeftoverMarker(withPixel.output)).toBeUndefined();
    executed.push(fixture.id);
  });

  it('zbylá značka po náhradě je chyba marker_not_replaced', () => {
    expect(findLeftoverMarker('<a href="https://track.mlain.invalid/c/x">a</a>')).toBe(
      'mlain.invalid',
    );
  });

  it.each([
    // ŽETONY OPSANÉ Z P08, ne vymyšlené. Test, který si vstup vyrobí podle
    // vlastní představy, tuhle chybu nezachytí, a přesně proto přežila:
    // vzor /ML_RAW_(\d{4})/ nenašel ani jeden z těchhle čtyř řetězců.
    ['ML_RAW_ab12cd34ef_0001', 'ab12cd34ef', '0001'], // rawPrefix z testů P08
    ['ml_raw_ab12cd34ef_0001', 'ab12cd34ef', '0001'], // P08 generuje malými písmeny
    ['ML_RAW_goldennonce_0001', 'goldennonce', '0001'], // pevný nonce golden fixtures
    ['ML_RAW_contractnonce_0012', 'contractnonce', '0012'], // pevný nonce fixtur kontraktu
  ])('slot syrového bloku %s se najde i s nonce', (token, nonce, index) => {
    RAW_SLOT_PATTERN.lastIndex = 0;
    const match = RAW_SLOT_PATTERN.exec(token);
    expect(match, `${token} se nenašel`).not.toBeNull();
    expect(match![1]!.toLowerCase()).toBe(nonce);
    expect(match![2]).toBe(index);
  });

  it('slot syrového bloku se nepoplete se slotem argumentu filtru', () => {
    RAW_SLOT_PATTERN.lastIndex = 0;
    expect(RAW_SLOT_PATTERN.test('ML_ARG_0007')).toBe(false);
    FILTER_SLOT_PATTERN.lastIndex = 0;
    expect(FILTER_SLOT_PATTERN.test('ML_RAW_ab12cd34ef_0001')).toBe(false);
  });

  it('slot argumentu filtru se hledá bez ohledu na velikost písmen', () => {
    // ML_ARG_ má číslo hned za předponou, tenhle vzor tedy sedí a nemění se.
    expect('ml_arg_0007'.match(FILTER_SLOT_PATTERN)).toEqual(['ml_arg_0007']);
    expect('ML_ARG_1234'.match(FILTER_SLOT_PATTERN)).toEqual(['ML_ARG_1234']);
  });

  it('neparsovatelné UUID za prefixem je chyba, ne tichý přeskok', () => {
    expect(() =>
      replaceClickMarkers(`<a href="${CLICK_MARKER_PREFIX}nic">x</a>`, () => 'u'),
    ).toThrow(/neplatné link_id/);
  });

  it('počet ve zdroji se porovnává rovností, ve vyrenderovaném výstupu jen shora', () => {
    const source = `${CLICK_MARKER_PREFIX}0192f3a0-1c2d-7e42-9c3d-4e5f60718293`;
    expect(countClickMarkers(source + source)).toBe(2);
    expect(countClickMarkers('')).toBe(0);
  });
});
