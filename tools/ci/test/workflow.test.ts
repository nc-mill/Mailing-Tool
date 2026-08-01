import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const workflow = (): string => fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');

/** Šestnáct blokujících jobů z části 1, kapitoly 3.15. Jediný autoritativní seznam. */
const BLOCKING_JOBS = [
  'lint',
  'typecheck',
  'test-unit',
  'test-db',
  'test-go',
  'test-go-integration',
  'contracts-golden',
  'contracts-fixtures-schema',
  'contracts-schema',
  'openapi-drift',
  'i18n-check',
  'licenses-node',
  'licenses-go',
  'migrations-check',
  'build-image',
  'e2e',
];

const TIMEOUTS: Record<string, number> = {
  lint: 5,
  typecheck: 8,
  'test-unit': 8,
  'test-db': 15,
  'test-go': 8,
  'test-go-integration': 12,
  'contracts-golden': 6,
  'contracts-fixtures-schema': 4,
  'contracts-schema': 5,
  'openapi-drift': 3,
  'i18n-check': 2,
  'licenses-node': 4,
  'licenses-go': 4,
  'migrations-check': 10,
  'build-image': 15,
  e2e: 20,
};

/** Vrátí blok jednoho jobu, tedy text od jeho hlavičky po hlavičku dalšího. */
function jobBlock(name: string): string {
  const text = workflow();
  const after = text.split(new RegExp(`^  ${name}:$`, 'm'))[1] ?? '';
  return after.split(/^ {2}[a-z][a-z0-9-]*:$/m)[0] ?? '';
}

describe('.github/workflows/ci.yml', () => {
  it('obsahuje všech šestnáct blokujících jobů (kapitola 3.15)', () => {
    const text = workflow();
    for (const job of BLOCKING_JOBS) {
      expect(text, `chybí job ${job}`).toMatch(new RegExp(`^  ${job}:$`, 'm'));
    }
  });

  it('má sedmnáctý, neblokující job security-audit', () => {
    expect(workflow()).toMatch(/^ {2}security-audit:$/m);
  });

  it('nezavádí job image-size, kontrolu velikosti dělá build-image', () => {
    expect(workflow()).not.toMatch(/^ {2}image-size:$/m);
  });

  it('každý blokující job má timeout podle tabulky 3.15', () => {
    for (const [job, minutes] of Object.entries(TIMEOUTS)) {
      const declared = jobBlock(job).match(/timeout-minutes:\s*(\d+)/);
      expect(declared, `job ${job} nemá timeout-minutes`).not.toBeNull();
      expect(Number(declared?.[1]), `job ${job}`).toBe(minutes);
    }
  });

  it('žádný blokující job nemá continue-on-error (rozhodnutí D8)', () => {
    for (const job of BLOCKING_JOBS) {
      expect(jobBlock(job), `job ${job} má continue-on-error`).not.toContain('continue-on-error');
    }
  });

  it('security-audit je označený jako neblokující', () => {
    expect(jobBlock('security-audit')).toContain('continue-on-error: true');
  });

  it('e2e a build-image běží až po rychlých jobech', () => {
    for (const job of ['build-image', 'e2e']) {
      const block = jobBlock(job);
      expect(block, `${job} nemá needs`).toContain('needs:');
      expect(block).toContain('lint');
      expect(block).toContain('typecheck');
    }
  });

  it('joby s databází používají postgres:18-alpine ze services', () => {
    for (const job of ['test-db', 'test-go-integration', 'contracts-schema', 'migrations-check']) {
      const block = jobBlock(job);
      expect(block, `${job} nemá services`).toContain('services:');
      expect(block, `${job} nemá postgres 18`).toContain('postgres:18-alpine');
    }
  });

  it('contracts-golden nemá databázi, a mít nemá (kapitola 3.15)', () => {
    expect(jobBlock('contracts-golden')).not.toContain('services:');
  });

  it('contracts-golden má setup obou stran, Node i Go', () => {
    const block = jobBlock('contracts-golden');
    expect(block).toContain('pnpm/action-setup');
    expect(block).toContain('actions/setup-go');
  });

  it('pinuje verze nástrojů shodně se specifikací', () => {
    const text = workflow();
    expect(text).toContain('24.18.1');
    expect(text).toContain('11.18.0');
    // Dvojité uvozovky, ne jednoduché. Prettier má pro *.yml override
    // singleQuote: false, takže `go-version: '1.26'` přepíše na dvojité
    // a krok `prettier --check .` v jobu lint by neprošel. Ověřeno spuštěním
    // prettieru 3.9.6 nad workflow souborem.
    expect(text).toContain('go-version: "1.26"');
  });

  it('nepoužívá jednoduché uvozovky, prettier je v yml přepisuje', () => {
    const offenders = workflow()
      .split('\n')
      .filter((line) => /:\s*'[^']*'\s*$/.test(line));
    expect(offenders, 'jednoduché uvozovky shodí prettier --check v jobu lint').toEqual([]);
  });

  it('každý job, který deleguje na pnpm skript, má pnpm i instalaci', () => {
    // Job, který volá `pnpm --filter ... run <skript>` bez nainstalovaného pnpm
    // a bez závislostí, spadne na `pnpm: command not found`, tedy na chybě,
    // která s kontrolovanými daty nemá nic společného.
    for (const job of [
      'contracts-golden',
      'contracts-fixtures-schema',
      'contracts-schema',
      'migrations-check',
    ]) {
      const block = jobBlock(job);
      expect(block, `${job} nemá pnpm/action-setup`).toContain('pnpm/action-setup');
      expect(block, `${job} neinstaluje závislosti`).toContain('pnpm install --frozen-lockfile');
    }
  });
});
