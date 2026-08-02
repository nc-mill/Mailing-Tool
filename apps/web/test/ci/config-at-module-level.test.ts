import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Brána proti konfiguraci vyhodnocené při SESTAVENÍ místo za běhu.
 *
 * Tahle vada se v repozitáři objevila třikrát a pokaždé vypadala jinak:
 *
 *   Failed to collect page data for /t/[[...path]]
 *   Failed to collect page data for /api/v1/[[...route]]
 *   Failed to collect page data for /api/internal/ai/chat
 *
 * Pokaždé to hlásilo trasu, ale příčina byla jinde. Naposledy stačilo, že
 * `lib/api/rate-limit.ts` volal `getConfig()` v literálu objektu na úrovni
 * modulu; ten soubor importuje `authenticate.ts` a ten importuje kdekdo.
 * Opravování trasu po trase byla hra na krtky.
 *
 * Následek není kosmetický. `next build` bez tajemství v prostředí spadne, což
 * shodí úlohu `build-image` v CI, a kdyby je tam někdo „na opravu" dodal,
 * ZAPEKL BY JE DO VRSTEV IMAGE. Obraz nesoucí podpisový klíč se nedá
 * distribuovat. Červená stavba je menší zlo.
 *
 * Past, na kterou se dá naletět: `export const dynamic = 'force-dynamic'` na
 * tohle NESTAČÍ. Řídí, jestli se trasa předrenderuje, ne jestli se naimportuje
 * její modul. V obou zmíněných trasách byl celou dobu a stavba padala stejně.
 *
 * Pravidlo je proto jednoduché: `loadConfig()` a `getConfig()` smějí být jedině
 * uvnitř funkce. Když potřebujete odvozenou konstantu, udělejte z ní líný
 * memoizovaný přístup, jak to dělá `rateLimitRules()`.
 */

const FORBIDDEN = ['loadConfig(', 'getConfig('] as const;

function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) throw new Error('Kořen workspace se nepodařilo najít.');
    dir = parent;
  }
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      out.push(...(await sourceFiles(full)));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Hledá volání mimo tělo funkce. Rozhoduje se podle odsazení a podle toho, co
 * řádku předchází, ne parsováním, protože přesnost tady není potřeba: cílem je
 * chytit `const X = getConfig().Y` na úrovni modulu, což je vždycky na začátku
 * řádku nebo uvnitř literálu objektu, který začíná na úrovni modulu.
 */
function offendingLines(source: string): string[] {
  const lines = source.split('\n');
  const bad: string[] = [];
  let depth = 0;
  let insideFunction = false;
  let functionDepth = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // `default` musí být v regulárním výrazu taky. Bez něj detektor přehlédl
    // `export default async function Page()`, což je tvar KAŽDÉ stránky
    // App Routeru, a hlásil jejich vnitřek jako úroveň modulu. Chytil to až
    // první ostrý běh, kdy nahlásil dvě stránky, ve kterých je volání správně.
    const startsFunction =
      /^(export\s+)?(default\s+)?(async\s+)?function\s/.test(trimmed) ||
      /=>\s*\{?\s*$/.test(trimmed) ||
      /^(export\s+)?(default\s+)?class\s/.test(trimmed);

    if (!insideFunction && startsFunction) {
      insideFunction = true;
      functionDepth = depth;
    }

    if (!insideFunction && !trimmed.startsWith('*') && !trimmed.startsWith('//')) {
      for (const needle of FORBIDDEN) {
        if (trimmed.includes(needle)) {
          bad.push(`${index + 1}: ${trimmed.slice(0, 100)}`);
        }
      }
    }

    depth += (line.match(/[{(]/g) ?? []).length;
    depth -= (line.match(/[})]/g) ?? []).length;
    if (insideFunction && depth <= functionDepth) insideFunction = false;
  });

  return bad;
}

describe('konfigurace se nesmí vyhodnocovat při sestavení', () => {
  it('žádný soubor v apps/web/src nevolá loadConfig ani getConfig na úrovni modulu', async () => {
    const root = repoRoot();
    const files = await sourceFiles(join(root, 'apps/web/src'));
    expect(files.length).toBeGreaterThan(50);

    const problems: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (!FORBIDDEN.some((needle) => source.includes(needle))) continue;
      const bad = offendingLines(source);
      if (bad.length > 0) {
        problems.push(`${relative(root, file)}\n  ${bad.join('\n  ')}`);
      }
    }

    expect(
      problems,
      'Konfigurace se čte při načtení modulu, takže `next build` spadne ve fázi ' +
        '„Collecting page data" a produkční image nepůjde postavit bez tajemství ' +
        'v prostředí. Zabalte to do funkce s memoizací, jako to dělá `rateLimitRules()`.\n\n' +
        problems.join('\n\n'),
    ).toEqual([]);
  });

  /**
   * Druhá podoba téže vady, kterou kontrola výš NEZACHYTÍ, protože volání je
   * uvnitř funkce a tedy formálně v pořádku.
   *
   * Stránka bez dynamického segmentu se při sestavení PŘEDRENDEROVÁVÁ, takže
   * se její tělo spustí a konfigurace se přečte i tak:
   *
   *   Export encountered an error on /[locale]/(account)/no-workspace/page
   *
   * Léčí to `export const dynamic = 'force-dynamic'`. U stránek pomáhá, na
   * rozdíl od route handlerů, kde řídí jen předrenderování a ne import modulu.
   *
   * Spoléhat na to, že stránku „drží dynamický segment v cestě", nestačí:
   * shodí ji první `generateStaticParams` nad tím segmentem.
   */
  it('každá stránka, která čte konfiguraci, má vypnuté předrenderování', async () => {
    const root = repoRoot();
    const files = (await sourceFiles(join(root, 'apps/web/src/app'))).filter((f) =>
      /\/page\.tsx$/.test(f),
    );

    const problems: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (!FORBIDDEN.some((needle) => source.includes(needle))) continue;
      if (/export\s+const\s+dynamic\s*=\s*'force-dynamic'/.test(source)) continue;
      problems.push(relative(root, file));
    }

    expect(
      problems,
      'Stránka čte konfiguraci, ale nemá vypnuté předrenderování. Next ji při ' +
        '`next build` vykreslí, sáhne na `SECRET_KEY` a `DATABASE_URL`, které ' +
        'stavba nezná, a stavba spadne. Doplňte `export const dynamic = ' +
        "'force-dynamic'`.\n\n" +
        problems.join('\n'),
    ).toEqual([]);
  });

  it('detektor skutečně chytí vzor, který tuhle vadu vyrobil', () => {
    // Bez tohohle testu by stačila chyba v detektoru a brána by mlčky
    // propouštěla všechno, přesně jako zelený job, který nic nespustil.
    const rozbite = [
      "import { getConfig } from '../runtime';",
      '',
      'export const RULES = {',
      '  api_key_read: { points: getConfig().RATE_LIMIT_API_READ },',
      '};',
    ].join('\n');

    expect(offendingLines(rozbite)).not.toEqual([]);
  });

  it('detektor nehlásí volání uvnitř výchozí exportované stránky', () => {
    // Tvar každé stránky App Routeru. Detektor ho zpočátku nepoznal a hlásil
    // její vnitřek jako úroveň modulu, což by bránu udělalo neprůchodnou
    // z falešného důvodu. Neprůchodná brána se obvykle „opraví" tím, že se
    // vypne, takže tenhle případ je tu natvrdo.
    const stranka = [
      "import { getConfig } from '../runtime';",
      '',
      'export default async function BackupsPage() {',
      '  const config = getConfig();',
      '  return <div>{config.BACKUP_DIR}</div>;',
      '}',
    ].join('\n');

    expect(offendingLines(stranka)).toEqual([]);
  });

  it('detektor nehlásí volání uvnitř funkce', () => {
    const spravne = [
      "import { getConfig } from '../runtime';",
      '',
      'let cached;',
      'export function rules() {',
      '  cached ??= { points: getConfig().RATE_LIMIT_API_READ };',
      '  return cached;',
      '}',
    ].join('\n');

    expect(offendingLines(spravne)).toEqual([]);
  });
});
