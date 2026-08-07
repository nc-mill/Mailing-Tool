import { once } from '../../queues';
import { cleanupConversationsJob } from './system-deps';

/**
 * Vstupní bod, který hledá codegen workeru (P01, rozhodnutí D4). Fronty samotné
 * zakládá P01 dopředu; tady se k nim jen připojují handlery.
 *
 * Jméno `handlers` je závazné: codegen generuje
 * `import { handlers as hN } from '@mlain/core/<domena>/jobs'`. Pod jiným
 * jménem se soubor přeloží a testy projdou, ale bundle workeru spadne až při
 * buildu image.
 *
 * Adresář se odvozuje z PREFIXU JMÉNA FRONTY, ne z domény: `handlerModulePath`
 * dělá `entry.name.split('.')[0]`. Fronta `content.brand_extract` proto patří
 * do `src/content/jobs/queue-handlers.ts`, i když logika extrakce bydlí
 * v `src/brand` (rozhodnutí D15).
 */
export const handlers = {
  /*
   * RETENCE KONVERZACÍ.
   *
   * Dřív tu stálo `needsDependencies('ai.cleanup_conversations', 'CleanupDeps')`,
   * protože továrnu závislostí nikdo nenapsal. Úloha proto každou noc spadla se
   * stejnou hláškou a konverzace se nesmazaly nikdy, tedy ani po lhůtě, kterou
   * si provozovatel nastavil v `AI_CONVERSATION_RETENTION_DAYS`. Továrna je
   * v `system-deps.ts`.
   *
   * `once`, ne `perJob`: cron posílá tik s prázdným nákladem, takže víc úloh
   * v dávce znamená víc tiků, ne víc práce. `perJob` by úklid pustil tolikrát,
   * kolik se tiků nakupilo, a druhý průchod by nenašel nic.
   */
  'ai.cleanup_conversations': once(() => cleanupConversationsJob()),
} as const;
