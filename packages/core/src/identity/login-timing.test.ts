import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as schema from '@mlain/db/schema';
import { closePools, withoutContext } from '../tx';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { hashPassword } from './password';
import { login } from './login';
import { requestPasswordReset } from './password-reset';

/**
 * Kritérium 16. Měří se skutečná doba běhu, ne teorie: dummy hash sám o sobě
 * nestačí, protože existující účet má navíc dotaz na členství, zápis čítače
 * a případný rehash. Srovnává je časová podlaha `AUTH_MIN_RESPONSE_MS`.
 */
let harness: PgHarness;

const PASSWORD = 'dostatecne-dlouhe-heslo';
const SAMPLES = 100;
let existingEmail = '';
const missingEmail = () => `nikdo-${Math.random().toString(36).slice(2)}@example.cz`;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

async function measure(fn: () => Promise<unknown>): Promise<number> {
  const started = process.hrtime.bigint();
  await fn().catch(() => undefined);
  return Number(process.hrtime.bigint() - started) / 1e6;
}

beforeAll(async () => {
  harness = await startPgHarness();
  existingEmail = `timing-${Date.now()}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      email: existingEmail,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Petr',
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
  // Zahřátí: první volání platí za načtení blocklistu, JIT a pool spojení.
  for (let i = 0; i < 5; i += 1) {
    await login({
      email: existingEmail,
      password: 'spatne',
      ip: '10.0.0.1',
      userAgent: 'v',
      requestId: 'w',
    }).catch(() => undefined);
    await login({
      email: missingEmail(),
      password: 'spatne',
      ip: '10.0.0.2',
      userAgent: 'v',
      requestId: 'w',
    }).catch(() => undefined);
  }
}, 300_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
});

describe('kritérium 16: enumerace účtů', () => {
  it('medián odpovědi na přihlášení se pro existující a neexistující účet neliší o víc než 20 %', async () => {
    const existing: number[] = [];
    const missing: number[] = [];

    // Střídavě, aby se do výsledku nepromítl postupný ohřev nebo zpomalení stroje.
    for (let i = 0; i < SAMPLES; i += 1) {
      existing.push(
        await measure(() =>
          login({
            email: existingEmail,
            password: 'spatne-heslo-dostatecne-dlouhe',
            ip: `10.1.${Math.floor(i / 250)}.${i % 250}`,
            userAgent: 'timing',
            requestId: `e${i}`,
          }),
        ),
      );
      missing.push(
        await measure(() =>
          login({
            email: missingEmail(),
            password: 'spatne-heslo-dostatecne-dlouhe',
            ip: `10.2.${Math.floor(i / 250)}.${i % 250}`,
            userAgent: 'timing',
            requestId: `m${i}`,
          }),
        ),
      );
    }

    const a = median(existing);
    const b = median(missing);
    const relativeDifference = Math.abs(a - b) / Math.max(a, b);

    // Diagnostika do výstupu testu, aby při pádu bylo hned vidět o kolik.
    process.stdout.write(
      `[kriterium 16] prihlaseni: existujici ${Math.round(a)} ms, neexistujici ${Math.round(b)} ms, rozdil ${(relativeDifference * 100).toFixed(2)} %\n`,
    );
    expect(relativeDifference).toBeLessThan(0.2);
  }, 300_000);

  it('totéž platí pro reset hesla, který vždy vrací 202', async () => {
    const existing: number[] = [];
    const missing: number[] = [];

    for (let i = 0; i < SAMPLES; i += 1) {
      existing.push(
        await measure(() =>
          requestPasswordReset({
            email: existingEmail,
            ip: '10.3.0.1',
            userAgent: 'timing',
            requestId: `re${i}`,
          }),
        ),
      );
      missing.push(
        await measure(() =>
          requestPasswordReset({
            email: missingEmail(),
            ip: '10.3.0.2',
            userAgent: 'timing',
            requestId: `rm${i}`,
          }),
        ),
      );
    }

    const a = median(existing);
    const b = median(missing);
    const relativeDifference = Math.abs(a - b) / Math.max(a, b);
    process.stdout.write(
      `[kriterium 16] reset hesla: existujici ${Math.round(a)} ms, neexistujici ${Math.round(b)} ms, rozdil ${(relativeDifference * 100).toFixed(2)} %\n`,
    );
    expect(relativeDifference).toBeLessThan(0.2);
  }, 300_000);
});
