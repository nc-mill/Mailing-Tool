// @vitest-environment node
// Test čte adresářový strom z disku, DOM k tomu nepotřebuje. V jsdom
// prostředí (výchozí pro tenhle balíček) je import.meta.url adresa
// http://, ze které fileURLToPath cestu neodvodí (viz lib/tokens.test.ts).
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PATTERNS_ROOT = fileURLToPath(new URL('.', import.meta.url));
const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function allFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return allFiles(full);
      return [full];
    }),
  );
  return files.flat();
}

describe('úplnost design systému', () => {
  it('existuje všech osm komponent K1 až K8', async () => {
    const entries = await readdir(PATTERNS_ROOT, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

    for (const required of [
      'data-table', // K1
      'query-builder', // K2
      'wizard', // K3
      'file-upload', // K4
      'toast', // K5
      'email-preview', // K6
      'charts', // K7
      'timeline', // K8
    ]) {
      expect(directories, `chybí komponenta ${required}`).toContain(required);
    }
  });

  it('každý vzor má barrel, aby se dal importovat podcestou', async () => {
    const entries = await readdir(PATTERNS_ROOT, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const files = await readdir(`${PATTERNS_ROOT}${entry.name}`);
      expect(files, `${entry.name} nemá index.ts`).toContain('index.ts');
    }
  });

  it('balíček nemá kořenový vstupní bod, takže import z holého @mlain/ui nejde', async () => {
    // Uzávěr S11 nestačí napsat, musí se dát porušit jen tak, že spadne build.
    // Kdyby někdo klíč "." do exports vrátil, spadne tenhle test, ne až
    // jedenáct navazujících plánů.
    const manifest = JSON.parse(
      await readFile(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { exports: Record<string, string> };

    expect(Object.keys(manifest.exports), 'klíč "." se do exports nesmí vrátit').not.toContain('.');
    expect(manifest.exports['./patterns/*']).toBe('./src/patterns/*/index.ts');
  });

  it('soubor src/index.ts neexistuje', async () => {
    const entries = await readdir(SRC_ROOT);
    expect(entries, 'barrel src/index.ts se vědomě nezakládá').not.toContain('index.ts');
  });

  it('žádná komponenta nepoužívá barvu mimo tokeny', async () => {
    const files = (await allFiles(SRC_ROOT)).filter(
      (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const matches = source.match(
        /\b(bg|text|border)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
      );
      if (matches) offenders.push(`${file}: ${matches.join(', ')}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('žádná komponenta nenese uživatelský text natvrdo', async () => {
    // Texty patří do katalogů. Komponenta je dostane přes props.
    const files = (await allFiles(PATTERNS_ROOT)).filter(
      (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      // Diakritika v JSX textu je spolehlivý příznak natvrdo psané češtiny.
      const jsxText = source.match(/>\s*[^<>{}\n]*[áčďéěíňóřšťúůýž][^<>{}\n]*\s*</gi);
      if (jsxText) offenders.push(`${file}: ${jsxText.join(' | ')}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('nikde se nepoužívá dlouhá pomlčka', async () => {
    const files = await allFiles(SRC_ROOT);
    const offenders: string[] = [];
    for (const file of files.filter((item) => /\.(ts|tsx|css|md)$/.test(item))) {
      const source = await readFile(file, 'utf8');
      if (source.includes(String.fromCharCode(0x2014))) offenders.push(file);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('allowlist výjimek ze zákazu disabled je prázdný nebo odůvodněný', async () => {
    const raw = await readFile(
      fileURLToPath(new URL('../../eslint-rules/allowlist.json', import.meta.url)),
      'utf8',
    );
    const parsed = JSON.parse(raw) as {
      exceptions: Array<{ reason?: string; approvedBy?: string }>;
    };
    for (const exception of parsed.exceptions) {
      expect(exception.reason, 'výjimka bez důvodu neprojde').toBeTruthy();
      expect(exception.approvedBy, 'výjimka bez schvalovatele neprojde').toBeTruthy();
    }
  });
});
