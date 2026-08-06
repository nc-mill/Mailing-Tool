import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Kořen repozitáře se hledá vystoupáním od pracovního adresáře, ne z
 * `import.meta.url`. Plán tu má `new URL('../../../../', import.meta.url)`,
 * jenže `apps/web` má vitest v prostředí jsdom, kde `import.meta.url` NENÍ
 * adresa se schématem `file:` a `readFile` na ní skončí na
 * „TypeError: The URL must be of scheme file". Ověřeno spuštěním.
 */
function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Kořen repozitáře se nenašel.');
    dir = parent;
  }
}

const root = repoRoot();
const dockerfilePath = join(root, 'docker', 'Dockerfile');
const docPath = join(root, 'docs', 'operations', 'third-party-licenses.md');

/**
 * Řádky jedné fáze Dockerfilu, tedy od jejího `FROM` po `FROM` následující.
 *
 * Test se ptá na SKUTEČNOST, ne na výskyt textu kdekoli v souboru: u
 * `SHARP_FORCE_GLOBAL_LIBVIPS` záleží na tom, ve které fázi a na kterém řádku
 * ta deklarace stojí. Proměnnou čte instalační skript balíčku sharp, takže musí
 * platit ve chvíli `pnpm install`. Kdyby stála o fázi vedle nebo o dva řádky
 * níž, build proběhne, nic nespadne a knihovna se přesto NEVYMĚNÍ.
 */
function stageLines(dockerfile: string, stage: string): string[] {
  const lines = dockerfile.split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^FROM\\s.*\\sAS\\s+${stage}\\s*$`).test(line),
  );
  expect(start, `fáze ${stage} v Dockerfilu není`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^FROM\s/.test(line));
  const body = end === -1 ? rest : rest.slice(0, end);
  // Komentáře pryč. Jinak by test měřil pořadí proti VĚTĚ o `pnpm install`
  // v komentáři, ne proti instrukci, tedy zase proti textu místo skutečnosti.
  return body.filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
}

/** Index prvního řádku fáze, který vyhoví; -1 když takový není. */
function indexOf(lines: readonly string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line));
}

describe('licenční povinnosti z licenses.allow.json', () => {
  it('výjimky s popsanou povinností v seznamu jsou', async () => {
    const allow = JSON.parse(await readFile(join(root, 'licenses.allow.json'), 'utf8')) as {
      exceptions: { package: string; obligations?: string }[];
    };
    expect(allow.exceptions.filter((e) => e.obligations).length).toBeGreaterThan(0);
  });

  it('plný text LGPL je v repozitáři a je to opravdu on, ne zástupný soubor', async () => {
    const lgpl = await readFile(join(root, 'LICENSES', 'LGPL-3.0.txt'), 'utf8');
    expect(lgpl).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
    expect(lgpl.length).toBeGreaterThan(5000);
  });

  it('Dockerfile kopíruje text licence do image', async () => {
    expect(await readFile(dockerfilePath, 'utf8')).toContain('LICENSES');
  });

  it('dokumentace pojmenuje komponentu i cestu k textu licence', async () => {
    const doc = await readFile(docPath, 'utf8');
    expect(doc).toContain('@img/sharp-libvips');
    expect(doc).toContain('LICENSES/LGPL-3.0.txt');
  });
});

/**
 * Druhá povinnost LGPL: umožnit příjemci nahradit knihovnu vlastním sestavením.
 *
 * Tenhle blok NEHLÍDÁ TEXT DOKUMENTACE, hlídá stavbu. Předchozí znění testu
 * ověřovalo, že v `docs/operations/third-party-licenses.md` stojí řetězec
 * `SHARP_FORCE_GLOBAL_LIBVIPS`, a proto svítilo zeleně nad postupem, který
 * `docker/Dockerfile` vůbec nečetl: žádný takový `ARG` v něm nebyl a Docker
 * nepřevzatý `--build-arg` jen odvaruje na stderr. Zelený test tedy tvrdil
 * splněnou licenční povinnost, která splněná nebyla.
 */
describe('výměna libvips za vlastní sestavení je ve stavbě opravdu možná', () => {
  it('fáze node-deps deklaruje ARG SHARP_FORCE_GLOBAL_LIBVIPS', async () => {
    const lines = stageLines(await readFile(dockerfilePath, 'utf8'), 'node-deps');
    expect(indexOf(lines, /^ARG\s+SHARP_FORCE_GLOBAL_LIBVIPS(=|\s*$)/)).toBeGreaterThanOrEqual(0);
  });

  it('a předává ho do prostředí, jinak by ho instalační skript sharpu nepřečetl', async () => {
    const lines = stageLines(await readFile(dockerfilePath, 'utf8'), 'node-deps');
    expect(
      indexOf(lines, /^ENV\s+SHARP_FORCE_GLOBAL_LIBVIPS=\$\{?SHARP_FORCE_GLOBAL_LIBVIPS\}?/),
    ).toBeGreaterThanOrEqual(0);
  });

  it('obojí stojí PŘED instalací závislostí, jinak se výměna nestihne projevit', async () => {
    const lines = stageLines(await readFile(dockerfilePath, 'utf8'), 'node-deps');
    const arg = indexOf(lines, /^ARG\s+SHARP_FORCE_GLOBAL_LIBVIPS(=|\s*$)/);
    const env = indexOf(lines, /^ENV\s+SHARP_FORCE_GLOBAL_LIBVIPS=/);
    const install = indexOf(lines, /pnpm install/);
    expect(install, 've fázi node-deps chybí pnpm install').toBeGreaterThanOrEqual(0);
    expect(arg).toBeGreaterThanOrEqual(0);
    expect(env).toBeGreaterThanOrEqual(0);
    expect(arg).toBeLessThan(install);
    expect(env).toBeLessThan(install);
  });

  it('výchozí hodnota nechává chování beze změny, tedy přibalenou knihovnu', async () => {
    const lines = stageLines(await readFile(dockerfilePath, 'utf8'), 'node-deps');
    const declaration = lines.find((line) => /^ARG\s+SHARP_FORCE_GLOBAL_LIBVIPS/.test(line));
    expect(declaration).toMatch(/^ARG\s+SHARP_FORCE_GLOBAL_LIBVIPS=0\s*$/);
  });

  it('dokumentovaný příkaz předává právě tenhle build-arg a pojmenovanou image', async () => {
    // Shoda dokumentace se stavbou, ne pouhá přítomnost řetězce: jméno
    // v `--build-arg` musí sedět s `ARG` výš a `-t` musí být na místě, jinak
    // třetí krok postupu skončí na „unable to find image".
    const doc = await readFile(docPath, 'utf8');
    const build = doc.split('\n').find((line) => line.startsWith('docker build'));
    expect(build, 'v dokumentaci chybí příkaz docker build').toBeDefined();
    expect(build).toContain('--build-arg SHARP_FORCE_GLOBAL_LIBVIPS=1');
    expect(build).toMatch(/\s-t\s+\S+/);
  });
});
