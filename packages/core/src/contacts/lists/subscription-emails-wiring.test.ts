import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Hlídač zapojení, ne hlídač chování. Stejný tvar jako `system-mail-wiring.test.ts`
 * a ze stejného důvodu.
 *
 * `SubscriptionEmailPort` byl přesně ten případ, na který ten test vznikl: modul
 * existoval, měl porty, jednotkové testy byly zelené, a nikdo ho nezaregistroval.
 * Volání `emails?.sendConfirmation(...)` bylo no-op, takže potvrzovací e-mail
 * neodešel z veřejného formuláře, z potvrzovací stránky, z centra předvoleb ani
 * z tlačítka „Poslat potvrzení znovu", a uživatel pokaždé viděl úspěch.
 *
 * Kdo ten řádek smaže, dozví se to tady, ne až tím, že se někdo nepřihlásí k odběru.
 */
const ROOT = resolve(import.meta.dirname, '../../../../..');

const ENTRYPOINTS = [
  // Web: veřejný formulář, potvrzovací stránka, centrum předvoleb, ruční přidání kontaktu.
  'apps/web/src/instrumentation.ts',
  // Worker: přihlášení, která vznikají z úloh (import, zpracování příchozí pošty).
  'apps/worker/src/main.ts',
];

describe('zapojení e-mailů seznamu', () => {
  it.each(ENTRYPOINTS)('%s zapojuje odesílání při startu procesu', (relative) => {
    const source = readFileSync(resolve(ROOT, relative), 'utf8');
    expect(
      source.includes('installSubscriptionEmails'),
      `${relative} nevolá installSubscriptionEmails, potvrzovací e-mail z tohohle procesu nikam nepůjde`,
    ).toBe(true);
  });
});
