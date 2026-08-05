import {
  PRICING_SOURCES,
  PRICING_UPDATED_AT,
  estimateCostBreakdown,
  longContextThresholdFor,
  providerReportsCost,
  reportedCostUnitFor,
} from './catalog';
import type { ProviderId } from './providers';

// Re-export ceníkového data drží UI a sestavu v jednom místě.
export { PRICING_UPDATED_AT, PRICING_SOURCES };

/**
 * Co o jednom volání hlásí sám poskytovatel. Všechno je nepovinné, protože
 * většina poskytovatelů nehlásí nic a `null` tu znamená „nevíme", nikdy nulu.
 */
export type ProviderReportedUsage = {
  /** SKUTEČNÁ účtovaná částka. Bez jednotky níž je bezcenná. */
  cost?: number | null;
  /** Vstupní tokeny přečtené z mezipaměti. */
  cacheReadTokens?: number | null;
  /** Vstupní tokeny zapsané do mezipaměti. */
  cacheWriteTokens?: number | null;
};

export type UsageRow = {
  day: string;
  provider: ProviderId;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  /** Skutečná účtovaná částka za ten den. `null` = poskytovatel ji nehlásí. */
  reportedCost?: number | null;
  /** Jednotka částky výš, například `openrouter_credit`. NIKDY měna. */
  reportedCostUnit?: string | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
};

export type UsageUpsert = {
  workspaceId: string;
  day: string;
  provider: ProviderId;
  model: string;
  requestsDelta: number;
  inputTokensDelta: number;
  outputTokensDelta: number;
  errorsDelta: number;
  /**
   * Přírůstek skutečné částky. `null` znamená „poskytovatel nic nehlásil",
   * a tehdy se sloupec NESMÍ dotknout: nula by z „nevíme" udělala „bylo to
   * zadarmo" a už by to nikdo nerozeznal.
   */
  reportedCostDelta: number | null;
  /** Jednotka částky. Bez ní se částka neukládá, hlídá to i omezení v databázi. */
  reportedCostUnit: string | null;
  cacheReadTokensDelta: number | null;
  cacheWriteTokensDelta: number | null;
};

export type UsageDeps = { upsertDailyUsage: (input: UsageUpsert) => Promise<void> };

const nonNegative = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * Nezáporné číslo, nebo `null`. Rozdíl proti `nonNegative` je celý smysl téhle
 * funkce: tam, kde `null` znamená „nevíme", se nesmí dosadit nula.
 */
const optionalNonNegative = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export async function recordUsage(
  params: {
    workspaceId: string;
    provider: ProviderId;
    model: string;
    inputTokens: number;
    outputTokens: number;
    failed: boolean;
    day: string;
    /**
     * Co hlásí poskytovatel. Nevyplněné znamená „nehlásil nic" a je to běžný
     * stav: cenu dnes vrací jediný poskytovatel z pěti.
     */
    reported?: ProviderReportedUsage | undefined;
  },
  deps: UsageDeps,
): Promise<void> {
  const cost = optionalNonNegative(params.reported?.cost);
  /*
   * Jednotku určuje POSKYTOVATEL, ne volající. Kdyby si ji dosazoval volající,
   * stačila by jedna nepozornost v Route Handleru a v databázi by ležely
   * kredity označené za dolary; takhle je zdroj pravdy jediný a je jím katalog.
   */
  const unit = cost === null ? null : reportedCostUnitFor(params.provider);

  await deps.upsertDailyUsage({
    workspaceId: params.workspaceId,
    day: params.day,
    provider: params.provider,
    model: params.model,
    requestsDelta: 1,
    inputTokensDelta: nonNegative(params.inputTokens),
    outputTokensDelta: nonNegative(params.outputTokens),
    errorsDelta: params.failed ? 1 : 0,
    // Částka bez známé jednotky se zahazuje celá. Uložit ji „prozatím bez
    // jednotky" by znamenalo nechat v databázi číslo, ke kterému si měnu
    // dosadí až ten, kdo ho bude číst.
    reportedCostDelta: unit === null ? null : cost,
    reportedCostUnit: unit,
    cacheReadTokensDelta: optionalNonNegative(params.reported?.cacheReadTokens),
    cacheWriteTokensDelta: optionalNonNegative(params.reported?.cacheWriteTokens),
  });
}

/**
 * Odkud se částka bere. Čtyři stavy, protože „poskytovatel nám naúčtoval
 * tolik", „z ceníku nám vyšlo tolik", „cenu zná poskytovatel, ale my ji tenkrát
 * neukládali" a „cenu neznáme" jsou pro uživatele čtyři různé věci a UI je musí
 * říct různě. Splynout smí nejmíň ty dvě první: jedna je faktura, druhá dopočet.
 */
export type PriceStatus =
  /**
   * Máme SKUTEČNOU částku od poskytovatele, ne odhad. Nejspolehlivější stav
   * a UI ho musí od odhadu odlišit: je to rozdíl mezi „tohle nám naúčtovali"
   * a „tolik nám vyšlo z ceníku".
   */
  | 'reported'
  /** Máme sazbu v ceníku, částka je odhad podle ní. */
  | 'estimated'
  /**
   * Poskytovatel skutečnou částku vrací, ale u těchhle řádků žádná uložená
   * není. Zůstává kvůli řádkům z doby před migrací 0012, kdy se cena
   * nezapisovala; nová volání sem už nespadnou.
   */
  | 'provider_reports'
  /** Model v ceníku není, částku neuvádíme vůbec. */
  | 'unknown';

export type UsageByModel = {
  provider: ProviderId;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  /** `null` znamená "cenu neznáme". UI pak ukáže jen tokeny, ne peníze. */
  estimatedCostUsd: number | null;
  /** Rozpad téže částky, ať je vidět, za co se platí nejvíc. */
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  /**
   * SKUTEČNÁ účtovaná částka od poskytovatele. Je to jiná veličina než
   * `estimatedCostUsd`, ne jeho přesnější verze, a proto má vlastní pole
   * i vlastní jednotku. `null` = poskytovatel nám ji nehlásí.
   */
  reportedCost: number | null;
  /** Jednotka částky výš, například `openrouter_credit`. NIKDY měna. */
  reportedCostUnit: string | null;
  /** Vstupní tokeny z mezipaměti. `null` = poskytovatel je nehlásí. */
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  priceStatus: PriceStatus;
  /** Nad tímhle prahem je odhad podstřelený. `null` = jedna sazba na všechno. */
  longContextThresholdTokens: number | null;
};

export type UsageDay = {
  day: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  /** `null`, jakmile je ten den aspoň jeden model bez ceny. */
  estimatedCostUsd: number | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  /** Skutečně naúčtováno za ten den, součet přes modely téže jednotky. */
  reportedCost: number | null;
  reportedCostUnit: string | null;
};

export type UsageReport = {
  totals: { requests: number; inputTokens: number; outputTokens: number; errors: number };
  byModel: UsageByModel[];
  byDay: UsageDay[];
  estimatedCostUsd: number | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  /**
   * Součet skutečně naúčtovaných částek za celé období. `null`, když žádná
   * uložená není NEBO když se v období potkaly dvě různé jednotky: sečíst
   * kredity jednoho poskytovatele s kredity druhého by dalo číslo, které
   * neznamená nic.
   */
  reportedCost: number | null;
  reportedCostUnit: string | null;
  /** Aspoň jeden použitý model má dražší tarif pro dlouhé prompty. */
  hasLongContextCaveat: boolean;
  pricingUpdatedAt: string;
};

/**
 * Sčítačka částek, která hlídá jednotku. Sečíst dvě čísla v různých jednotkách
 * je snadné a výsledek vypadá stejně důvěryhodně jako správný, takže se tomu
 * musí bránit typ, ne pozornost.
 */
type ReportedCostSum = { amount: number | null; unit: string | null; mixedUnits: boolean };

function emptyReportedCost(): ReportedCostSum {
  return { amount: null, unit: null, mixedUnits: false };
}

function addReportedCost(
  sum: ReportedCostSum,
  cost: number | null | undefined,
  unit: string | null | undefined,
): void {
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return;
  // Částka bez jednotky se ignoruje. Databáze ji tam nepustí (omezení
  // `ck_ai_usage_daily__reported_cost`), tohle je pojistka pro data zvenčí.
  if (typeof unit !== 'string' || unit === '') return;
  if (sum.unit !== null && sum.unit !== unit) {
    sum.mixedUnits = true;
    return;
  }
  sum.unit = unit;
  sum.amount = (sum.amount ?? 0) + cost;
}

function resolveReportedCost(sum: ReportedCostSum): { cost: number | null; unit: string | null } {
  if (sum.mixedUnits) return { cost: null, unit: null };
  return { cost: sum.amount, unit: sum.unit };
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function buildUsageReport(
  rows: readonly UsageRow[],
  range?: { from: string; to: string },
): UsageReport {
  const totals = rows.reduce(
    (acc, row) => ({
      requests: acc.requests + row.requests,
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      errors: acc.errors + row.errors,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, errors: 0 },
  );

  type ModelAccumulator = UsageByModel & { reportedSum: ReportedCostSum };
  const modelMap = new Map<string, ModelAccumulator>();
  for (const row of rows) {
    const key = `${row.provider}/${row.model}`;
    const current = modelMap.get(key) ?? {
      provider: row.provider,
      model: row.model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      errors: 0,
      estimatedCostUsd: null,
      inputCostUsd: null,
      outputCostUsd: null,
      reportedCost: null,
      reportedCostUnit: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      priceStatus: 'unknown' as PriceStatus,
      longContextThresholdTokens: null,
      reportedSum: emptyReportedCost(),
    };
    current.requests += row.requests;
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    current.errors += row.errors;
    addReportedCost(current.reportedSum, row.reportedCost, row.reportedCostUnit);
    // Tokeny mezipaměti se sčítají jen z řádků, kde nějaké jsou. Den bez nich
    // nesmí přepsat součet nulou, protože „neměřeno" není „nula".
    if (typeof row.cacheReadTokens === 'number') {
      current.cacheReadTokens = (current.cacheReadTokens ?? 0) + row.cacheReadTokens;
    }
    if (typeof row.cacheWriteTokens === 'number') {
      current.cacheWriteTokens = (current.cacheWriteTokens ?? 0) + row.cacheWriteTokens;
    }
    modelMap.set(key, current);
  }

  const byModel = [...modelMap.values()]
    .map((entry): UsageByModel => {
      const { reportedSum, ...rest } = entry;
      const cost = estimateCostBreakdown(
        entry.provider,
        entry.model,
        entry.inputTokens,
        entry.outputTokens,
      );
      const reported = resolveReportedCost(reportedSum);
      /*
       * POŘADÍ TĚCH VĚTVÍ JE CELÉ ROZHODNUTÍ. Skutečná částka od poskytovatele
       * přebíjí odhad z ceníku vždycky, i když bychom uměli spočítat obojí:
       * je to přesně to, co si poskytovatel strhl, kdežto odhad nezná slevu za
       * mezipaměť ani výjimky z ceníku u konkrétního modelu.
       *
       * `provider_reports` zbývá už jen na řádky z doby před migrací 0012,
       * kdy se cena nezapisovala. Ty se od nových liší tím, že u nich
       * `reportedCost` chybí, a uživatel to musí poznat: „zatím neukládáme"
       * je jiná zpráva než „bylo to zadarmo".
       */
      const priceStatus: PriceStatus =
        reported.cost !== null
          ? 'reported'
          : cost !== null
            ? 'estimated'
            : providerReportsCost(entry.provider)
              ? 'provider_reports'
              : 'unknown';
      return {
        ...rest,
        estimatedCostUsd: cost?.totalUsd ?? null,
        inputCostUsd: cost?.inputUsd ?? null,
        outputCostUsd: cost?.outputUsd ?? null,
        reportedCost: reported.cost,
        reportedCostUnit: reported.unit,
        priceStatus,
        longContextThresholdTokens: longContextThresholdFor(entry.provider, entry.model),
      };
    })
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));

  /*
   * Cena po dnech se počítá z jednotlivých řádků, ne až ze součtu za den:
   * jeden den může mít víc modelů s různými sazbami a sečíst tokeny nejdřív
   * by znamenalo použít sazbu jednoho modelu na spotřebu druhého.
   */
  type DayAccumulator = Omit<UsageDay, 'day'> & {
    allPriced: boolean;
    reportedSum: ReportedCostSum;
  };
  const dayMap = new Map<string, DayAccumulator>();
  for (const row of rows) {
    const current = dayMap.get(row.day) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      errors: 0,
      estimatedCostUsd: 0,
      inputCostUsd: 0,
      outputCostUsd: 0,
      reportedCost: null,
      reportedCostUnit: null,
      allPriced: true,
      reportedSum: emptyReportedCost(),
    };
    current.requests += row.requests;
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    current.errors += row.errors;
    addReportedCost(current.reportedSum, row.reportedCost, row.reportedCostUnit);
    const cost = estimateCostBreakdown(row.provider, row.model, row.inputTokens, row.outputTokens);
    if (cost === null) {
      current.allPriced = false;
    } else {
      current.inputCostUsd = (current.inputCostUsd ?? 0) + cost.inputUsd;
      current.outputCostUsd = (current.outputCostUsd ?? 0) + cost.outputUsd;
      current.estimatedCostUsd = (current.estimatedCostUsd ?? 0) + cost.totalUsd;
    }
    dayMap.set(row.day, current);
  }

  const days = range === undefined ? [...dayMap.keys()].sort() : eachDay(range.from, range.to);
  const byDay = days.map((day): UsageDay => {
    const found = dayMap.get(day);
    if (found === undefined) {
      // Den beze spotřeby stál nula, ne "nevíme". Nula tu nelže.
      return {
        day,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        errors: 0,
        estimatedCostUsd: 0,
        inputCostUsd: 0,
        outputCostUsd: 0,
        /*
         * U SKUTEČNÉ ČÁSTKY SE ALE NULA NAPSAT NESMÍ, a je to jediné místo,
         * kde se tenhle den chová jinak než u odhadu. Odhad umíme spočítat
         * i pro nulovou spotřebu, kdežto „poskytovatel nám za tenhle den
         * naúčtoval nula" je tvrzení o jeho faktuře, které jsme nikde nečetli.
         */
        reportedCost: null,
        reportedCostUnit: null,
      };
    }
    const { allPriced, reportedSum, ...rest } = found;
    const reported = resolveReportedCost(reportedSum);
    return {
      day,
      ...rest,
      estimatedCostUsd: allPriced ? rest.estimatedCostUsd : null,
      inputCostUsd: allPriced ? rest.inputCostUsd : null,
      outputCostUsd: allPriced ? rest.outputCostUsd : null,
      reportedCost: reported.cost,
      reportedCostUnit: reported.unit,
    };
  });

  // Celkový odhad dává smysl jen tehdy, když je v ceníku každý použitý model.
  // Součet přes část modelů by uživateli lhal směrem dolů.
  const allPriced = byModel.every((entry) => entry.estimatedCostUsd !== null);
  const sumOf = (pick: (entry: UsageByModel) => number | null): number | null =>
    allPriced ? byModel.reduce((sum, entry) => sum + (pick(entry) ?? 0), 0) : null;

  /*
   * Celková skutečná částka se počítá JINAK než celkový odhad, a schválně.
   *
   * Odhad se sečte jen tehdy, když ho známe u KAŽDÉHO modelu; částečný součet
   * by lhal směrem dolů, protože chybějící model se z něj nedá odečíst. Tady
   * ale nejde o jedno číslo za všechno: skutečná částka existuje jen u těch
   * modelů, kde ji poskytovatel hlásí, a její součet je pravdivá odpověď na
   * otázku „kolik nám bylo doopravdy naúčtováno". UI k ní vedle staví odhad
   * za zbytek, takže se ta dvě čísla nepletou.
   */
  const totalReported = emptyReportedCost();
  for (const entry of byModel)
    addReportedCost(totalReported, entry.reportedCost, entry.reportedCostUnit);
  const reported = resolveReportedCost(totalReported);

  return {
    totals,
    byModel,
    byDay,
    estimatedCostUsd: sumOf((entry) => entry.estimatedCostUsd),
    inputCostUsd: sumOf((entry) => entry.inputCostUsd),
    outputCostUsd: sumOf((entry) => entry.outputCostUsd),
    reportedCost: reported.cost,
    reportedCostUnit: reported.unit,
    hasLongContextCaveat: byModel.some((entry) => entry.longContextThresholdTokens !== null),
    pricingUpdatedAt: PRICING_UPDATED_AT,
  };
}
