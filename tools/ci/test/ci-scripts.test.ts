import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
let sandbox: string;

function run(
  script: string,
  cwd: string,
  env: Record<string, string> = {},
): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools/ci', script)], {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, out: `${failure.stdout}${failure.stderr}` };
  }
}

/** Podstrčí na PATH falešné `pnpm`, které zapíše svoje argumenty a vrátí dané JSON. */
function fakePnpm(sandbox: string, inventory: Record<string, { licenses: string }>): string {
  const bin = path.join(sandbox, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const trace = path.join(sandbox, 'pnpm-args.log');
  const json = JSON.stringify(inventory).replaceAll("'", '\\u0027');
  fs.writeFileSync(
    path.join(bin, 'pnpm'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(trace)}\n` +
      `case "$*" in\n  *--json*) printf '%s' '${json}' ;;\n  *) echo "summary" ;;\nesac\nexit 0\n`,
  );
  fs.chmodSync(path.join(bin, 'pnpm'), 0o755);
  return trace;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-ci-'));
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('i18n-check', () => {
  it('bez katalogů hlásí SKIP a vrací 0', () => {
    const result = run('i18n-check.mjs', sandbox);
    expect(result.code).toBe(0);
    expect(result.out).toContain('SKIP');
  });

  it('spadne, když klíč v en chybí v cs (kritérium 51)', () => {
    const dir = path.join(sandbox, 'packages/i18n/messages');
    fs.mkdirSync(path.join(dir, 'en'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'cs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'en/common.json'), '{"save":"Save","cancel":"Cancel"}');
    fs.writeFileSync(path.join(dir, 'cs/common.json'), '{"save":"Uložit"}');
    const result = run('i18n-check.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('common.cancel');
  });

  it('spadne na neplatném ICU výrazu', () => {
    const dir = path.join(sandbox, 'packages/i18n/messages');
    fs.mkdirSync(path.join(dir, 'en'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'cs'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'en/common.json'),
      '{"n":"{count, plural, one {#} other {#}}"}',
    );
    fs.writeFileSync(path.join(dir, 'cs/common.json'), '{"n":"{count, plural, one {#"}');
    const result = run('i18n-check.mjs', sandbox);
    expect(result.code).not.toBe(0);
  });
});

describe('openapi-drift', () => {
  it('bez packages/contracts hlásí SKIP a vrací 0', () => {
    expect(run('openapi-drift.mjs', sandbox).code).toBe(0);
  });

  it('spadne, když se commitnutý soubor liší od vygenerovaného', () => {
    const dir = path.join(sandbox, 'packages/contracts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'openapi.json'), '{"openapi":"3.1.0"}');
    fs.writeFileSync(path.join(dir, 'openapi.generated.json'), '{"openapi":"3.1.0","paths":{}}');
    const result = run('openapi-drift.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('contracts:generate');
  });
});

describe('migration-lint', () => {
  it('bez migrací hlásí SKIP a vrací 0', () => {
    expect(run('migration-lint.mjs', sandbox).code).toBe(0);
  });

  it('spadne na CREATE INDEX CONCURRENTLY bez mlain:no-transaction', () => {
    const dir = path.join(sandbox, 'packages/db/migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '0001_x.sql'), 'CREATE INDEX CONCURRENTLY idx ON t (a);\n');
    const result = run('migration-lint.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('no-transaction');
  });

  it('spadne na neidempotentním příkazu v no-transaction migraci', () => {
    const dir = path.join(sandbox, 'packages/db/migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '0002_y.sql'),
      '-- mlain:no-transaction\nCREATE INDEX CONCURRENTLY idx ON t (a);\n',
    );
    const result = run('migration-lint.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('IF NOT EXISTS');
  });

  it('spadne na now() v kompilovaném SQL (konvence 2.4)', () => {
    const dir = path.join(sandbox, 'packages/db/migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '0003_z.sql'),
      '-- mlain:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON t (a) WHERE created_at > now();\n',
    );
    const result = run('migration-lint.mjs', sandbox);
    expect(result.code).not.toBe(0);
  });

  it('projde na správně napsané migraci', () => {
    const dir = path.join(sandbox, 'packages/db/migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '0004_ok.sql'),
      '-- mlain:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON t (a);\n',
    );
    expect(run('migration-lint.mjs', sandbox).code).toBe(0);
  });
});

describe('licenses-node', () => {
  it('spadne na výjimce bez expires_at', () => {
    fs.writeFileSync(
      path.join(sandbox, 'licenses.allow.json'),
      JSON.stringify({
        exceptions: [
          { package: 'x', version: '1.0.0', license: 'GPL-3.0', reason: 'r', approved_by: 'p' },
        ],
      }),
    );
    const result = run('licenses-node.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('expires_at');
  });

  it('spadne na prošlé výjimce', () => {
    fs.writeFileSync(
      path.join(sandbox, 'licenses.allow.json'),
      JSON.stringify({
        exceptions: [
          {
            package: 'x',
            version: '1.0.0',
            license: 'GPL-3.0',
            reason: 'r',
            approved_by: 'p',
            expires_at: '2020-01-01',
          },
        ],
      }),
    );
    const result = run('licenses-node.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('vypršela');
  });

  // Tenhle test je hlavní pojistka nálezu, že se licenses.allow.json jen
  // VALIDOVAL a do samotné kontroly se nikdy nedostal. Výjimka tím fakticky
  // nic neodblokovala a licenční brána byla červená bez ohledu na rozhodnutí
  // zadavatele. Test se neptá zdrojáku skriptu, ale sleduje, s jakými
  // argumenty skript license-checker doopravdy zavolal.
  it('rozvine výjimku na název@verze a předá ji do kontroly', () => {
    fs.mkdirSync(path.join(sandbox, 'node_modules'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'licenses.allow.json'),
      JSON.stringify({
        exceptions: [
          {
            package: '@img/sharp-libvips-*',
            license: 'LGPL-3.0-or-later',
            reason: 'rozhodnutí zadavatele',
            approved_by: 'zadavatel',
            expires_at: '2099-01-01',
          },
        ],
      }),
    );
    const trace = fakePnpm(sandbox, {
      '@img/sharp-libvips-linux-x64@1.3.2': { licenses: 'LGPL-3.0-or-later' },
      'react@19.2.0': { licenses: 'MIT' },
    });
    const result = run('licenses-node.mjs', sandbox, {
      PATH: `${path.join(sandbox, 'bin')}:${process.env['PATH'] ?? ''}`,
    });
    expect(result.code).toBe(0);
    const calls = fs.readFileSync(trace, 'utf8');
    expect(calls, 'skript nikdy nepředal --excludePackages').toContain('--excludePackages');
    expect(calls).toContain('@img/sharp-libvips-linux-x64@1.3.2');
    // react se do výjimek dostat nesmí, jinak by vzor bral víc, než má.
    expect(calls).not.toContain('react@19.2.0');
  });

  it('spadne, když se balíček pod existující výjimkou přelicencuje', () => {
    fs.mkdirSync(path.join(sandbox, 'node_modules'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'licenses.allow.json'),
      JSON.stringify({
        exceptions: [
          {
            package: '@img/sharp-libvips-*',
            license: 'LGPL-3.0-or-later',
            reason: 'rozhodnutí zadavatele',
            approved_by: 'zadavatel',
            expires_at: '2099-01-01',
          },
        ],
      }),
    );
    fakePnpm(sandbox, { '@img/sharp-libvips-linux-x64@2.0.0': { licenses: 'AGPL-3.0-only' } });
    const result = run('licenses-node.mjs', sandbox, {
      PATH: `${path.join(sandbox, 'bin')}:${process.env['PATH'] ?? ''}`,
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('AGPL-3.0-only');
  });
});

describe('contracts joby', () => {
  it('všechny tři bez packages/contracts hlásí SKIP a vracejí 0', () => {
    for (const script of [
      'contracts-golden.mjs',
      'contracts-fixtures-schema.mjs',
      'contracts-schema.mjs',
    ]) {
      const result = run(script, sandbox);
      expect(result.code, script).toBe(0);
      expect(result.out, script).toContain('SKIP');
    }
  });

  // Pojistka proti nálezu, že brána existuje, vypadá funkčně a nespustí nic.
  // Test se neptá zdrojáku skriptu, ale ověřuje chování na podstrčeném stromu:
  // balíček je na místě, ale příkaz vlastníka chybí, tedy není co spustit.
  function contractsPackage(scripts: Record<string, string> = {}): void {
    fs.mkdirSync(path.join(sandbox, 'packages/contracts'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'packages/contracts/package.json'),
      JSON.stringify({ name: '@mlain/contracts', scripts }),
    );
  }

  it('contracts-golden spadne, když chybí Go strana a nemá co s čím porovnávat', () => {
    contractsPackage({ 'test:golden': 'true', 'test:parity': 'true' });
    const result = run('contracts-golden.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('internal/contracts');
  });

  it('contracts-golden spadne, když packages/contracts nemá skript test:golden', () => {
    contractsPackage();
    fs.mkdirSync(path.join(sandbox, 'apps/sender/internal/contracts'), { recursive: true });
    const result = run('contracts-golden.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('test:golden');
    expect(result.out).toContain('P02');
  });

  it('contracts-fixtures-schema spadne, když chybí skript test:fixtures-schema', () => {
    contractsPackage();
    const result = run('contracts-fixtures-schema.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('test:fixtures-schema');
    expect(result.out).toContain('P02');
  });
});

describe('migrations-check', () => {
  it('bez migračního runneru hlásí SKIP a vrací 0', () => {
    const result = run('migrations-check.mjs', sandbox, { DATABASE_URL_MIGRATOR: '' });
    expect(result.code).toBe(0);
    expect(result.out).toContain('SKIP');
  });

  it('spadne, když runner existuje a chybí DATABASE_URL_MIGRATOR', () => {
    fs.mkdirSync(path.join(sandbox, 'packages/db/src'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'packages/db/src/migrate.ts'), 'export {};\n');
    const result = run('migrations-check.mjs', sandbox, { DATABASE_URL_MIGRATOR: '' });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('DATABASE_URL_MIGRATOR');
  });

  // Tenhle test hlídá, že se skript nevrátí k bezpodmínečnému fail(). Ten by
  // po mergnutí P03 zůstal červený navždy a blokující job by zastavil merge
  // všech dalších plánů, aniž by to šlo odkudkoliv opravit.
  it('spadne s odkazem na test:migrations, ne na sebe sama', () => {
    fs.mkdirSync(path.join(sandbox, 'packages/db/src'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'packages/db/src/migrate.ts'), 'export {};\n');
    fs.writeFileSync(
      path.join(sandbox, 'packages/db/package.json'),
      JSON.stringify({ name: '@mlain/db', scripts: {} }),
    );
    const result = run('migrations-check.mjs', sandbox, {
      DATABASE_URL_MIGRATOR: 'postgres://u:p@127.0.0.1:5432/x',
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('test:migrations');
    expect(result.out).toContain('P03');
    expect(result.out, 'skript nesmí žádat zásah do tools/ci').not.toContain('tools/ci');
  });
});
