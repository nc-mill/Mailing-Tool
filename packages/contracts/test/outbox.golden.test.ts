/**
 * Runner tabulky přechodů z `fixtures/outbox/scenarios.json` na TypeScript straně.
 *
 * ODCHYLKA OD PLÁNU P02, a je vědomá. Plán tabulku pouští v `test/outbox.test.ts`,
 * tedy v projektu `unit`, a report sekce `outbox` nepíše nikde. Jenže
 * `scripts/check-parity.ts` sekci `outbox` mezi ostatními má a čeká reporty OBOU
 * stran, a job `contracts-golden` (tools/ci/contracts-golden.mjs) pouští před
 * paritou jen `test:golden` a `go test -run TestGolden`. Bez tohohle souboru by
 * `ts-golden-outbox.json` v tom pořadí nikdy nevznikl a parita by hlásila
 * „chybí report ts-golden-outbox.json" i po zeleném běhu obou jazyků.
 *
 * Go protějšek je `RunOutboxTransitions` v `apps/sender/internal/contracts/golden.go`:
 * čte TÝŽ soubor, volá `outbox.CanTransition` a otisk počítá nad tím jedním
 * souborem. Tady je to totéž nad `canTransition` z `src/outbox.ts`, aby obě
 * strany hlásily paritu nad stejnými daty, ne nad dvěma opisy tabulky.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { canTransition, type MessageStatus, type TransitionActor } from '../src/outbox';
import { writeGoldenReport } from './golden-report';

const scenariosFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'outbox',
  'scenarios.json',
);

type TransitionCase = {
  id: string;
  from: MessageStatus;
  to: MessageStatus;
  actor: TransitionActor;
  error_code: string | null;
  allowed: boolean;
};

const registry = JSON.parse(await readFile(scenariosFile, 'utf8')) as {
  transitions: TransitionCase[];
};
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'outbox',
    total: registry.transitions.length,
    ids: executed,
    files: [scenariosFile],
  });
});

describe('kontrakt 1: tabulka přechodů', () => {
  it('má čtrnáct případů a žádné id se neopakuje', () => {
    expect(registry.transitions).toHaveLength(14);
    expect(new Set(registry.transitions.map((testCase) => testCase.id)).size).toBe(14);
  });

  it.each(registry.transitions)(
    '$id: $from -> $to ($actor, error_code $error_code) je allowed=$allowed',
    (testCase) => {
      expect(
        canTransition({
          from: testCase.from,
          to: testCase.to,
          actor: testCase.actor,
          errorCode: testCase.error_code ?? undefined,
        }),
      ).toBe(testCase.allowed);
      // Až ZA tvrzením. Id přidané dopředu by se do reportu dostalo i u případu,
      // který spadl, a parita by nad ním byla zelená.
      executed.push(testCase.id);
    },
  );
});
