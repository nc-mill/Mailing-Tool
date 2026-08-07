/**
 * PRŮMĚRNÁ PERIODA CRONOVÉHO VÝRAZU, tedy „jak často se do fronty tiká".
 *
 * K čemu to je: hlídač ticha ve workeru (`apps/worker/src/cron-watch.ts`)
 * potřebuje vědět, po jaké době je mlčení fronty podezřelé. Bez periody by
 * musel mít jeden práh pro plánovač kampaní (tiká po patnácti sekundách)
 * i pro týdenní ověření zálohy, a jeden práh pro obojí neexistuje: buď by
 * u toho rychlého mlčel dva dny, nebo by u toho týdenního hlásil poruchu
 * každý den.
 *
 * PROČ NE `cron-parser`, kterou by stačilo importovat. Je v `node_modules`
 * jedině jako tranzitivní závislost pg-bossu, takže v pnpm workspace není
 * z našeho balíčku dosažitelná a musela by se přidat jako vlastní závislost.
 * Přidávat závislost kvůli jednomu číslu je nepoměr, a hlavně: knihovna
 * vrací PŘÍŠTÍ okamžiky, ne periodu, takže by se z nich stejně musela
 * počítat. Tenhle výpočet je čistá funkce nad textem výrazu, takže se dá
 * testovat bez času a bez databáze.
 *
 * JE TO ODHAD, NE PŘESNÉ ČÍSLO, a je to schválně. Výraz `0 4 1,15 * *` má
 * ve skutečnosti nestejné rozestupy (14 a 16 nebo 17 dní); tahle funkce
 * vrátí průměr. Hlídači to stačí, protože práh je stejně násobek periody.
 * Kde se odhaduje, odhaduje se VŽDY SMĚREM K DELŠÍ PERIODĚ, protože delší
 * perioda znamená delší toleranci, a planý poplach je horší než pozdní.
 *
 * Nepodporované tvary (jména měsíců a dnů, `L`, `W`, `#`) vracejí
 * `undefined` místo hádání. Hlídač takovou frontu vynechá a je to lepší
 * než hlásit ticho podle periody, kterou si někdo domyslel. Že se to
 * netýká žádné fronty v registru, hlídá test.
 */

/** Průměrná délka měsíce v dnech (365,2425 / 12), gregoriánský rok. */
const AVERAGE_MONTH_DAYS = 30.436875;
const DAY_SECONDS = 24 * 60 * 60;

type FieldRange = { min: number; max: number };

const SECOND: FieldRange = { min: 0, max: 59 };
const MINUTE: FieldRange = { min: 0, max: 59 };
const HOUR: FieldRange = { min: 0, max: 23 };
const DOM: FieldRange = { min: 1, max: 31 };
const MONTH: FieldRange = { min: 1, max: 12 };
const DOW: FieldRange = { min: 0, max: 7 };

/**
 * Kolik hodnot pole odpovídá, nebo `undefined` u tvaru, kterému nerozumíme.
 *
 * Hvězdička se vrací zvlášť (`wildcard`), protože u dne v měsíci a dne
 * v týdnu na ní záleží: cron ta dvě pole spojuje SJEDNOCENÍM právě jen
 * tehdy, když ani jedno není hvězdička.
 */
function countValues(
  field: string,
  range: FieldRange,
  /**
   * Převod hodnoty na její kanonický tvar. Slouží dni v týdnu, kde `0` i `7`
   * je táž neděle: bez toho by `0,7` vyšlo na dva dny v týdnu a perioda by
   * vyšla poloviční, tedy tolerance hlídače poloviční a poplach planý.
   */
  canonical: (value: number) => number = (value) => value,
): { count: number; wildcard: boolean } | undefined {
  const trimmed = field.trim();
  if (trimmed === '') return undefined;
  // `?` znamená v některých dialektech „na tomhle poli nezáleží", tedy totéž
  // co hvězdička. pg-boss ho přes cron-parser bere, takže ho bere i tenhle
  // výpočet; jinak by fronta s ním vypadla z hlídání.
  if (trimmed === '*' || trimmed === '?') {
    const all = new Set<number>();
    for (let value = range.min; value <= range.max; value += 1) all.add(canonical(value));
    return { count: all.size, wildcard: true };
  }

  const matched = new Set<number>();
  for (const part of trimmed.split(',')) {
    const values = expandPart(part, range);
    if (values === undefined) return undefined;
    for (const value of values) matched.add(canonical(value));
  }
  if (matched.size === 0) return undefined;
  return { count: matched.size, wildcard: false };
}

function expandPart(part: string, range: FieldRange): number[] | undefined {
  const [spec, stepText, ...rest] = part.split('/');
  if (rest.length > 0 || spec === undefined) return undefined;

  let step = 1;
  if (stepText !== undefined) {
    step = Number(stepText);
    if (!Number.isInteger(step) || step < 1) return undefined;
  }

  let from: number;
  let to: number;
  if (spec === '*' || spec === '?') {
    from = range.min;
    to = range.max;
  } else if (spec.includes('-')) {
    const [low, high, ...extra] = spec.split('-');
    if (extra.length > 0 || low === undefined || high === undefined) return undefined;
    from = Number(low);
    to = Number(high);
  } else {
    from = Number(spec);
    // Samotné číslo se krokem (`5/10`) čte jako `5-max/10`, stejně jako
    // v cron-parseru. Bez toho by `5/10` vyšlo na jedinou hodnotu.
    to = stepText === undefined ? from : range.max;
  }

  if (!Number.isInteger(from) || !Number.isInteger(to)) return undefined;
  if (from < range.min || to > range.max || from > to) return undefined;

  const values: number[] = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
}

/**
 * Průměrný počet DNÍ mezi dvěma dny, na které výraz padne.
 *
 * Sjednocení dne v měsíci a dne v týdnu (oba nastavené) se schválně NEPOČÍTÁ
 * jako sjednocení, ale bere se ta ŘIDŠÍ z obou možností. Sjednocení by dalo
 * kratší periodu a tím kratší toleranci hlídače, tedy planý poplach. Žádná
 * fronta v registru takový výraz nemá.
 */
function averageDaysBetween(
  dom: { count: number; wildcard: boolean },
  dow: { count: number; wildcard: boolean },
): number {
  if (dom.wildcard && dow.wildcard) return 1;
  const dowDays = dow.count;
  if (dom.wildcard) return 7 / dowDays;
  const domDays = AVERAGE_MONTH_DAYS / dom.count;
  if (dow.wildcard) return domDays;
  return Math.max(domDays, 7 / dowDays);
}

/**
 * Průměrná perioda výrazu v sekundách, nebo `undefined`, když výrazu
 * nerozumíme. Bere pětipolový i šestipolový tvar (šest polí = vteřiny
 * napřed, tak to bere i pg-boss).
 */
export function cronPeriodSeconds(expression: string): number | undefined {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) return undefined;

  const withSeconds = fields.length === 6;
  const second = withSeconds
    ? countValues(fields[0]!, SECOND)
    : ({ count: 1, wildcard: false } as const);
  const offset = withSeconds ? 1 : 0;
  const minute = countValues(fields[offset]!, MINUTE);
  const hour = countValues(fields[offset + 1]!, HOUR);
  const dom = countValues(fields[offset + 2]!, DOM);
  const month = countValues(fields[offset + 3]!, MONTH);
  const dow = countValues(fields[offset + 4]!, DOW, (value) => value % 7);
  if (!second || !minute || !hour || !dom || !month || !dow) return undefined;

  const perDay = second.count * minute.count * hour.count;
  const monthFactor = month.wildcard ? 1 : 12 / month.count;
  const seconds = (DAY_SECONDS / perDay) * averageDaysBetween(dom, dow) * monthFactor;
  return Math.round(seconds);
}
