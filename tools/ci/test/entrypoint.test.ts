import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ENTRYPOINT = path.join(ROOT, 'docker/entrypoint.sh');

let sandbox: string;
let fakeBin: string;
let log: string;

// `execFileSync` zahazuje stderr, když proces skončí nulou: vrací jen stdout
// a chybu vyhodí jedině při nenulovém exit kódu, takže stderr z ÚSPĚŠNÉHO běhu
// (třeba varování o toleranci exit 69) by nebylo možné vůbec zkontrolovat.
// `spawnSync` vrací stdout, stderr i status vždy, bez ohledu na exit kód.
function run(env: Record<string, string>, args: string[] = []): { code: number; stderr: string } {
  const result = spawnSync('sh', [ENTRYPOINT, ...args], {
    env: { PATH: `${fakeBin}:/usr/bin:/bin`, MLAIN_TRACE: log, ...env },
    encoding: 'utf8',
  });
  return { code: result.status ?? 0, stderr: result.stderr ?? '' };
}

function trace(): string {
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
}

/** Skript bez komentářů. Testy zákazů mají hlídat kód, ne vysvětlivky v něm. */
function executableLines(): string {
  return fs
    .readFileSync(ENTRYPOINT, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

function fake(name: string, exitCode = 0): void {
  const file = path.join(fakeBin, name);
  fs.writeFileSync(
    file,
    `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "$MLAIN_TRACE"\nexit ${exitCode}\n`,
  );
  fs.chmodSync(file, 0o755);
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-entry-'));
  fakeBin = path.join(sandbox, 'bin');
  fs.mkdirSync(fakeBin);
  log = path.join(sandbox, 'trace.log');
  fs.writeFileSync(log, '');
  fake('node');
  fake('ml-sender');
  fake('mlain');
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('entrypoint.sh', () => {
  it('je platný POSIX shell', () => {
    execFileSync('sh', ['-n', ENTRYPOINT]);
  });

  it('nejdřív ověří konfiguraci a při chybě skončí 78 (kritéria 2 a 3)', () => {
    fs.writeFileSync(
      path.join(fakeBin, 'mlain'),
      '#!/bin/sh\nprintf \'mlain %s\\n\' "$*" >> "$MLAIN_TRACE"\necho "SECRET_KEY: je povinná (required) a chybí" >&2\nexit 78\n',
    );
    fs.chmodSync(path.join(fakeBin, 'mlain'), 0o755);
    const result = run({ MODE: 'web' });
    expect(result.code).toBe(78);
    expect(result.stderr).toContain('SECRET_KEY');
    expect(trace()).toContain('mlain config check');
  });

  it('vymaže klíče AI providerů podle vzoru i podle výčtu (kritérium 7b)', () => {
    fs.writeFileSync(
      path.join(fakeBin, 'node'),
      '#!/bin/sh\nprintf \'node %s\\n\' "$*" >> "$MLAIN_TRACE"\nprintf \'ANTHROPIC=[%s] OPENAI=[%s] HF=[%s] OLLAMA=[%s] SECRET=[%s] S3ID=[%s]\\n\' "$ANTHROPIC_API_KEY" "$OPENAI_API_KEY" "$HF_TOKEN" "$OLLAMA_HOST" "$SECRET_KEY" "$S3_ACCESS_KEY_ID" >> "$MLAIN_TRACE"\n',
    );
    fs.chmodSync(path.join(fakeBin, 'node'), 0o755);
    run({
      MODE: 'web',
      MIGRATE_ON_START: 'false',
      ANTHROPIC_API_KEY: 'sk-a',
      OPENAI_API_KEY: 'sk-o',
      HF_TOKEN: 'hf',
      OLLAMA_HOST: 'http://x',
      SECRET_KEY: 'keep-me',
      S3_ACCESS_KEY_ID: 'keep-me-too',
    });
    expect(trace()).toContain(
      'ANTHROPIC=[] OPENAI=[] HF=[] OLLAMA=[] SECRET=[keep-me] S3ID=[keep-me-too]',
    );
  });

  it('při MODE=web a MIGRATE_ON_START=true spustí migrace', () => {
    run({ MODE: 'web', MIGRATE_ON_START: 'true' });
    expect(trace()).toContain('mlain migrate');
  });

  it('při MODE=worker migrace nespouští', () => {
    run({ MODE: 'worker', MIGRATE_ON_START: 'true' });
    expect(trace()).not.toContain('mlain migrate');
  });

  it('MODE=web spustí server.js', () => {
    run({ MODE: 'web', MIGRATE_ON_START: 'false' });
    expect(trace()).toContain('node apps/web/server.js');
  });

  it('MODE=worker spustí dist/main.js workeru', () => {
    run({ MODE: 'worker', MIGRATE_ON_START: 'false' });
    expect(trace()).toContain('node apps/worker/dist/main.js');
  });

  it('MODE=sender spustí ml-sender', () => {
    run({ MODE: 'sender', MIGRATE_ON_START: 'false' });
    expect(trace()).toContain('ml-sender');
  });

  it('MODE=all spustí všechny tři procesy', () => {
    run({ MODE: 'all', MIGRATE_ON_START: 'false' });
    const text = trace();
    expect(text).toContain('apps/web/server.js');
    expect(text).toContain('apps/worker/dist/main.js');
    expect(text).toContain('ml-sender');
  });

  it('neznámý MODE skončí 78', () => {
    expect(run({ MODE: 'vsechno', MIGRATE_ON_START: 'false' }).code).toBe(78);
  });

  it('pád potomka při MODE=all ukončí celý kontejner jeho exit kódem', () => {
    fake('ml-sender', 17);
    const result = run({ MODE: 'all', MIGRATE_ON_START: 'false' });
    expect(result.code).toBe(17);
  });

  it('pád nodu při MODE=all propíše jeho kód, ne kód senderu', () => {
    fake('node', 9);
    expect(run({ MODE: 'all', MIGRATE_ON_START: 'false' }).code).toBe(9);
  });

  it('čistý konec všech tří potomků vrátí nulu', () => {
    expect(run({ MODE: 'all', MIGRATE_ON_START: 'false' }).code).toBe(0);
  });

  // Tenhle test je pojistka proti `wait -n`. Kdyby se do skriptu vrátil, spadne
  // rovnou na `Illegal option -n` pod dashem, respektive `invalid option` pod
  // bashem 3.2, a nikdy se nedostane k výběru exit kódu.
  //
  // Komentáře se odfiltrují: skript o `wait -n` mluví ve vysvětlivce a test má
  // hlídat kód, ne prózu. Bez toho by padal sám na sobě.
  it('nepoužívá wait -n, protože POSIX shell ho nemá', () => {
    expect(executableLines()).not.toMatch(/\bwait\s+-n\b/);
  });

  // Sender se volá jménem, aby ho šlo podstrčit přes PATH. Absolutní cesta by
  // znamenala, že test spouští jinou binárku než produkce.
  it('spouští sender přes PATH, ne absolutní cestou', () => {
    expect(executableLines()).not.toContain('/usr/local/bin/ml-sender');
  });

  it('neimplementovaná migrace (exit 69) kontejner nezastaví', () => {
    fs.writeFileSync(
      path.join(fakeBin, 'mlain'),
      '#!/bin/sh\nprintf \'mlain %s\\n\' "$*" >> "$MLAIN_TRACE"\nif [ "$1" = "migrate" ]; then exit 69; fi\nexit 0\n',
    );
    fs.chmodSync(path.join(fakeBin, 'mlain'), 0o755);
    const result = run({ MODE: 'web', MIGRATE_ON_START: 'true' });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('69');
    expect(trace()).toContain('node apps/web/server.js');
  });

  it('selhaná migrace (exit 3) kontejner zastaví se stejným kódem', () => {
    fs.writeFileSync(
      path.join(fakeBin, 'mlain'),
      '#!/bin/sh\nprintf \'mlain %s\\n\' "$*" >> "$MLAIN_TRACE"\nif [ "$1" = "migrate" ]; then exit 3; fi\nexit 0\n',
    );
    fs.chmodSync(path.join(fakeBin, 'mlain'), 0o755);
    const result = run({ MODE: 'web', MIGRATE_ON_START: 'true' });
    expect(result.code).toBe(3);
    expect(trace()).not.toContain('node apps/web/server.js');
  });
});
