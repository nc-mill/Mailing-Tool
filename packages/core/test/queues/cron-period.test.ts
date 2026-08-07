import { describe, expect, it } from 'vitest';
import { cronPeriodSeconds } from '../../src/queues/cron-period';
import { cronQueues } from '../../src/queues/registry';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Průměrná délka měsíce ve dnech, táž hodnota jako v cron-period.ts. */
const AVERAGE_MONTH = 30.436875;

describe('perioda cronového výrazu', () => {
  it('spočítá periodu u každého tvaru, který registr skutečně používá', () => {
    // Čísla jsou opsaná z významu výrazu, ne z návratové hodnoty funkce.
    expect(cronPeriodSeconds('*/15 * * * * *')).toBe(15);
    expect(cronPeriodSeconds('*/30 * * * * *')).toBe(30);
    expect(cronPeriodSeconds('* * * * *')).toBe(MINUTE);
    expect(cronPeriodSeconds('*/10 * * * *')).toBe(10 * MINUTE);
    expect(cronPeriodSeconds('*/15 * * * *')).toBe(15 * MINUTE);
    expect(cronPeriodSeconds('15 * * * *')).toBe(HOUR);
    expect(cronPeriodSeconds('15 2 * * *')).toBe(DAY);
    expect(cronPeriodSeconds('0 4 * * 0')).toBe(7 * DAY);
  });

  /**
   * Jádro celého hlídání ticha: fronta, jejíž periodu nikdo neumí spočítat,
   * z hlídače vypadne, a vypadne TIŠE. Kdyby někdo do registru přidal cron
   * s názvem měsíce nebo s `L`, přestala by být hlídaná a nikde by o tom
   * nebyla řádka. Test to chytí tady, ne v provozu.
   */
  it('každý cron v registru má spočitatelnou periodu', () => {
    const unknown = cronQueues()
      .filter((entry) => cronPeriodSeconds(entry.cron) === undefined)
      .map((entry) => `${entry.name}: ${entry.cron}`);
    expect(unknown).toEqual([]);
  });

  it('perioda registru nikdy nevyjde nula ani záporně', () => {
    for (const entry of cronQueues()) {
      expect(cronPeriodSeconds(entry.cron), entry.name).toBeGreaterThan(0);
    }
  });

  it('rozumí výčtu, rozsahu i kroku uvnitř rozsahu', () => {
    // Dvakrát za hodinu, tedy průměrně po třiceti minutách.
    expect(cronPeriodSeconds('0,30 * * * *')).toBe(30 * MINUTE);
    // Pět hodin v pracovní části dne, tedy pětkrát denně.
    expect(cronPeriodSeconds('0 9-13 * * *')).toBe(Math.round(DAY / 5));
    // 0, 20 a 40, tedy třikrát za hodinu.
    expect(cronPeriodSeconds('0-59/20 * * * *')).toBe(20 * MINUTE);
    // Číslo s krokem se čte jako „od pěti dál", tedy 5, 25 a 45.
    expect(cronPeriodSeconds('5/20 * * * *')).toBe(20 * MINUTE);
  });

  it('den v týdnu 0 i 7 je táž neděle, ne dva dny', () => {
    expect(cronPeriodSeconds('0 4 * * 0,7')).toBe(7 * DAY);
  });

  it('omezený měsíc prodlouží periodu, protože se tiká jen část roku', () => {
    // Jednou denně, ale jen ve dvou měsících z dvanácti.
    expect(cronPeriodSeconds('0 4 * 1,7 *')).toBe(6 * DAY);
  });

  /**
   * Když jsou nastavené oba dny, bere se ta ŘIDŠÍ možnost, ne sjednocení.
   * Sjednocení by dalo kratší periodu, tedy kratší toleranci hlídače a planý
   * poplach. Chyba směrem k delší toleranci je ta bezpečná.
   */
  it('u nastaveného dne v měsíci i v týdnu odhaduje směrem k delší periodě', () => {
    // 1. v měsíci (průměrně po 30,4 dnech) nebo pondělí (po 7 dnech).
    expect(cronPeriodSeconds('0 4 1 * 1')).toBe(Math.round(AVERAGE_MONTH * DAY));
  });

  it('nehádá u tvarů, kterým nerozumí', () => {
    for (const expression of [
      '0 4 * * MON', // jméno dne
      '0 4 L * *', // poslední den měsíce
      '0 4 * * 5#2', // druhý pátek
      '0 4 * *', // čtyři pole
      '0 0 4 * * * *', // sedm polí
      '', // prázdný výraz
      '99 * * * *', // minuta mimo rozsah
      '30-10 * * * *', // obrácený rozsah
      '*/0 * * * *', // nulový krok
    ]) {
      expect(cronPeriodSeconds(expression), expression).toBeUndefined();
    }
  });
});
