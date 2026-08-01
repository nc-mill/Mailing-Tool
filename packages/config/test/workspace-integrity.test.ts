import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PACKAGE_DIRECTORIES,
  PACKAGE_GRAPH,
  WORKSPACE_APPS,
  WORKSPACE_PACKAGES,
  type WorkspaceName,
} from '../src/package-graph';

const ROOT = path.resolve(import.meta.dirname, '../../..');

function manifest(name: WorkspaceName): Record<string, unknown> {
  const file = path.join(ROOT, PACKAGE_DIRECTORIES[name], 'package.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

describe('integrita workspace', () => {
  it('adresář packages/ obsahuje právě devět balíčků (akceptační kritérium 7d)', () => {
    const dirs = fs
      .readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(dirs).toEqual([
      'config',
      'contracts',
      'core',
      'db',
      'emails',
      'i18n',
      'sdk-node',
      'sdk-web',
      'ui',
    ]);
    expect(dirs).toHaveLength(9);
  });

  it('každý balíček i aplikace má package.json se správným jménem a MIT licencí', () => {
    for (const name of [...WORKSPACE_PACKAGES, ...WORKSPACE_APPS]) {
      const pkg = manifest(name);
      expect(pkg['name'], `${name} má špatné jméno`).toBe(name);
      expect(pkg['license'], `${name} nemá MIT`).toBe('MIT');
      expect(pkg['private'], `${name} není private`).toBe(true);
    }
  });

  // Uzávěr S11 zakazuje barrely proto, že barrel je sdílený soubor s jedním
  // řádkem na doménu, tedy merge konflikt v každém plánu, který doménu přidává.
  // To platí u balíčků, do kterých píše víc plánů, především u @mlain/core.
  //
  // @mlain/db je jiný případ a je z uzávěru vyňatý vědomě: celý balíček vlastní
  // jediný plán P03, jeho vstupní bod neroste s doménami a je kurátorovaný,
  // ne generovaný. P04 a doménové plány z něj importují `@mlain/db`.
  // Výjimka je ale úzká: níž je test, který hlídá, že vstupní bod NEreexportuje
  // schéma ani nebezpečnou továrnu kontextu. Bez toho by z výjimky vznikla
  // druhá rovnocenná cesta k témuž, čemuž se rozhodnutí R37 plánu P03 vyhýbá.
  const BARREL_EXEMPT = new Set(['@mlain/db']);

  it('žádný balíček mimo vyjmenovanou výjimku nemá top level barrel', () => {
    for (const name of WORKSPACE_PACKAGES) {
      if (BARREL_EXEMPT.has(name)) continue;
      for (const candidate of ['index.ts', 'index.tsx', 'src/index.ts', 'src/index.tsx']) {
        const file = path.join(ROOT, PACKAGE_DIRECTORIES[name], candidate);
        expect(fs.existsSync(file), `barrel ${name}/${candidate} nesmí existovat, uzávěr S11`).toBe(
          false,
        );
      }
    }
  });

  it('vstupní bod @mlain/db nereexportuje schéma ani nebezpečnou továrnu kontextu', () => {
    const file = path.join(ROOT, PACKAGE_DIRECTORIES['@mlain/db'], 'src/index.ts');
    // Komentáře se musí odstranit PŘED kontrolou. Vstupní bod v komentáři
    // vysvětluje, proč tam `export * as schema` není, a kontrola nad surovým
    // textem by si to vysvětlení chytila jako porušení.
    const source = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // Rozhodnutí R37 plánu P03: schéma se importuje výhradně podcestou
    // @mlain/db/schema. Dvě rovnocenné cesty k témuž znamenají, že si každý
    // plán vybere jinou, což je přesně ten stav, kterému se výjimka vyhýbá.
    expect(source, 'schéma patří výhradně na podcestu @mlain/db/schema').not.toMatch(
      /export\s+\*\s+as\s+schema|from\s+['"]\.\/schema/,
    );
    // unsafeWorkspaceContext obchází izolaci projektů. Musí se importovat
    // vědomě podcestou, ne z našeptávače nad kořenem balíčku.
    expect(source, 'unsafeWorkspaceContext patří na podcestu, ne do kořene').not.toMatch(
      /unsafeWorkspaceContext/,
    );
  });

  it('@mlain/core nemá kořenový export, ale má zástupné znaky na podcesty', () => {
    const exportsMap = manifest('@mlain/core')['exports'] as Record<string, string>;
    expect(exportsMap['.'], 'kořenový export by obešel uzávěr S11').toBeUndefined();
    // Bez těchhle dvou pravidel si musí každý doménový plán přidat řádek do
    // package.json cizího balíčku a codegen workeru vyrobí neimportovatelný soubor.
    expect(exportsMap['./*'], 'chybí zástupný export podcesty domény').toBe('./src/*/index.ts');
    expect(exportsMap['./*/jobs'], 'chybí zástupný export handlerů front').toBe(
      './src/*/jobs/queue-handlers.ts',
    );
  });

  it('adresáře, na které míří Dockerfile, existují', () => {
    // COPY na neexistující cestu build image tvrdě zabije chybou
    // `lstat ...: no such file or directory`. Wildcard to NEOBEJDE, ověřeno
    // spuštěním docker buildu. Proto tyhle dva adresáře zakládá P01, i když
    // jejich obsah patří jiným plánům.
    for (const dir of ['apps/web/public', 'packages/db/migrations']) {
      expect(fs.existsSync(path.join(ROOT, dir)), `${dir} musí existovat kvůli COPY`).toBe(true);
    }
  });

  it('deklarované workspace závislosti nepřekračují graf', () => {
    for (const name of [...WORKSPACE_PACKAGES, ...WORKSPACE_APPS]) {
      const pkg = manifest(name);
      // @mlain/config je build nástroj, ne hrana grafu: každý balíček ho má
      // v devDependencies jen proto, aby `extends: "@mlain/config/tsconfig/..."`
      // šlo napsat jménem balíčku a ne relativní cestou. V PACKAGE_GRAPH proto
      // nefiguruje a import ze zdrojáků mu ESLint hranice pořád zakazují.
      const declared = [
        ...Object.keys((pkg['dependencies'] as Record<string, string>) ?? {}),
        ...Object.keys((pkg['devDependencies'] as Record<string, string>) ?? {}),
      ].filter((dep) => dep.startsWith('@mlain/') && dep !== '@mlain/config');
      for (const dep of declared) {
        expect(
          PACKAGE_GRAPH[name].includes(dep as WorkspaceName),
          `${name} deklaruje ${dep}, což graf nepovoluje`,
        ).toBe(true);
      }
    }
  });

  it('apps/sender není členem pnpm workspace', () => {
    const workspace = fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).not.toContain('apps/*');
    expect(fs.existsSync(path.join(ROOT, 'apps/sender/package.json'))).toBe(false);
  });
});
