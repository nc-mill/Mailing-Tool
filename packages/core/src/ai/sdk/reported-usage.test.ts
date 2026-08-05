import { describe, expect, it } from 'vitest';
import { reportedUsageOf } from './index';

/**
 * Vytažení SKUTEČNÉ ceny z odpovědi poskytovatele.
 *
 * Tvary vstupů nejsou vymyšlené: jsou opsané z nainstalovaného
 * `@openrouter/ai-sdk-provider` 3.0.0, kde `doGenerate` i `doStream` skládají
 * `providerMetadata.openrouter.usage` a do něj kopírují `cost` přímo
 * z `response.usage.cost`. Kdyby se ten tvar v nové verze balíčku změnil,
 * musí spadnout tenhle test, ne až přehled spotřeby u zákazníka.
 */
const step = (cost: number | undefined) => ({
  providerMetadata: {
    openrouter: {
      provider: 'anthropic',
      usage: {
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
        ...(cost === undefined ? {} : { cost }),
      },
    },
  },
});

const usage = (cacheRead?: number, cacheWrite?: number) => ({
  inputTokens: 100,
  outputTokens: 10,
  inputTokenDetails: {
    noCacheTokens: 100,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  },
});

describe('skutečná cena z providerMetadata', () => {
  it('sečte cenu přes VŠECHNY kroky agentní smyčky, ne jen poslední', () => {
    /*
     * Tohle je ta chyba, kvůli které test existuje. Konverzace s nástroji je
     * několik samostatných volání chat completions a poskytovatel účtuje
     * každé zvlášť. `event.providerMetadata` na události konce nese metadata
     * POSLEDNÍHO kroku, takže kdo si vezme jen je, zapíše z pěti účtovaných
     * volání jedno a uživateli ukáže zlomek toho, co zaplatil.
     */
    const result = reportedUsageOf({
      steps: [step(0.001), step(0.002), step(0.0005)],
      usage: usage(),
    });
    expect(result.cost).toBeCloseTo(0.0035, 12);
  });

  it('poskytovatel bez hlášené ceny nedostane nulu, ale null', () => {
    // Anthropic přes vlastní klíč: v metadatech není žádný `openrouter`.
    const result = reportedUsageOf({
      steps: [{ providerMetadata: { anthropic: { cacheCreationInputTokens: 5 } } }],
      usage: usage(),
    });
    expect(result.cost).toBeNull();
  });

  it('krok bez ceny se přeskočí, ostatní se přesto sečtou', () => {
    const result = reportedUsageOf({ steps: [step(0.001), step(undefined)], usage: usage() });
    expect(result.cost).toBeCloseTo(0.001, 12);
  });

  it('žádné kroky ani metadata neznamenají nulu', () => {
    expect(reportedUsageOf({ steps: undefined, usage: undefined }).cost).toBeNull();
    expect(reportedUsageOf({ steps: [], usage: {} }).cost).toBeNull();
    expect(reportedUsageOf({ steps: [{}, null], usage: null }).cost).toBeNull();
  });

  it('tokeny mezipaměti se berou z agregované spotřeby SDK, nula je měření', () => {
    const result = reportedUsageOf({ steps: [step(0.001)], usage: usage(64, 0) });
    expect(result.cacheReadTokens).toBe(64);
    // Nula od poskytovatele znamená „nic se nezapsalo", což je údaj, ne jeho
    // absence, a musí se dostat do databáze.
    expect(result.cacheWriteTokens).toBe(0);
  });

  it('chybějící rozpad vstupních tokenů dá null, ne nulu', () => {
    const result = reportedUsageOf({ steps: [step(0.001)], usage: usage() });
    expect(result.cacheReadTokens).toBeNull();
    expect(result.cacheWriteTokens).toBeNull();
  });
});
