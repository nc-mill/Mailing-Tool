import { describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign, type TestWorkspace } from '../../test/harness';
import { runMaterializeLoop } from '../../materialize/loop';
import { ZERO_UUID } from '../../materialize/plan-constants';
import { materializeBatch, cancelPendingBatch, type RenderPlan } from '../outbox';
import { startMaterialization } from '../audience-progress';
import { cancelCampaign } from '../../control/cancel';
import { readCampaignStatus } from '../campaign';
import { withWorkspace } from '../../../tx';
import { rawSql } from '../raw-sql';
import type { KnownCampaignStatus } from '../../types';

const EMPTY_RENDER_PLAN: RenderPlan = {
  usedPaths: [],
  preparedSchema: { fields: [], presence: [] },
};

/**
 * Kontakty se zakládají HROMADNĚ, ne po řádcích.
 *
 * `seedContacts` z harnessu vkládá jeden `INSERT` na kontakt. Tenhle scénář jich
 * potřebuje 20 000 na běh a běhů je pětadvacet, tedy půl milionu round tripů;
 * po řádcích by test běžel hodiny a nikdo by ho nespustil. Publikum je tady
 * `WHERE true`, takže členství v seznamu není potřeba a stačí samotné kontakty.
 *
 * `email_fingerprints` se nechává prázdné ze stejného důvodu jako v `seedOutbox`:
 * otisk čte jen shoda se suppression, kterou tenhle scénář nezkouší, a GIN index
 * nad půl milionem otisků by tvořil podstatnou část doby běhu.
 */
async function seedContactsBulk(ctx: TestWorkspace, count: number): Promise<void> {
  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(
        `WITH src AS (
           SELECT 'r-' || gen_random_uuid()::text || '@example.com' AS email
             FROM generate_series(1, $2)
         )
         INSERT INTO contacts (workspace_id, email, first_name, status)
         SELECT $1, email, 'Jméno', 'active'
           FROM src`,
        [ctx.workspaceId, count],
      ),
    ),
  );
}

/**
 * Jeden běh závodu.
 *
 * ODCHYLKA OD PLÁNU, A JE TO PODSTATA ÚKOLU. Plán volal `cancelCampaign` s `await`
 * uvnitř callbacku dávky, tedy AŽ POTOM, co materializace svou transakci potvrdila.
 * To žádný závod není: obě strany se v čase nepotkají a scénář by prošel i nad
 * implementací, která souběh neřeší vůbec.
 *
 * Tady se zrušení pouští BEZ `await` v okamžiku, kdy dávka ještě běží. Úklid zrušení
 * (`UPDATE ... status = 'skipped'`) a `INSERT` dávky tak leží ve dvou souběžných
 * transakcích na dvou spojeních. Úklid nevidí řádky, které dávka ještě nepotvrdila,
 * projde je tedy jako by tam nebyly a dávka je vloží až po něm. Přesně tyhle řádky
 * jsou ty osiřelé, které nikdo neclaimne a které navěky brání odpojení oddílu.
 * Jediná obrana je kontrola stavu po dávce, kterou tenhle test zapíná a vypíná.
 */
/**
 * DRUHÁ ODCHYLKA OD PLÁNU, VYNUCENÁ MĚŘENÍM. Plán psal 20 000 kontaktů a dávku 1 000
 * na každý z pětadvaceti běhů. Naměřeno: první běh trvá minuty, jedenáctý čtvrthodinu,
 * celý scénář by neskončil. Příčina není v testovaném kódu: harness dává všem běhům
 * JEDNU databázi, `cancelPendingBatch` čte podle `campaign_id` sekvenčním průchodem
 * oddílu (viz jeho plán) a ten oddíl s každým během roste. Po jedenácti bězích v něm
 * bylo 115 000 zpráv a každá dávka je znovu přečetla celé. Je to vlastnost scénáře,
 * ne vada úklidu: v provozu leží v oddílu jeden měsíc jednoho projektu.
 *
 * Objem se proto snižuje a POMĚR se zachovává: 4 000 kontaktů a dávka 200 dávají
 * dvacet dávek, tedy přesně tolik, kolik jich plán potřebuje pro zrušení po 3. až 14.
 * dávce. Závod se tím nemění ani o kus, mění se jen počet řádků, které se u něj vozí.
 * Objem sám o sobě zkouší úkol 23 na padesáti tisících zprávách.
 */
const RACE_AUDIENCE_SIZE = 4_000;
const RACE_BATCH_SIZE = 200;

async function runOnce(
  checkStatusAfterBatch: boolean,
  cancelAfterBatches: number,
): Promise<number> {
  const ctx = await withTestWorkspace();
  await seedContactsBulk(ctx, RACE_AUDIENCE_SIZE);
  const id = await seedCampaign(ctx, { status: 'draft' });
  const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

  let batches = 0;
  let cancelInFlight: Promise<unknown> | null = null;

  await runMaterializeLoop(
    {
      batch: async (i) => {
        const running = materializeBatch(ctx.workspace, { ...i, statementTimeoutMs: 30_000 });
        batches += 1;
        const triggering = batches === cancelAfterBatches;
        // ZÁMĚRNĚ BEZ await: úklid zrušení běží proti nedokončené dávce, obojí ve
        // vlastní transakci na vlastním spojení. Tohle je ten závod.
        if (triggering) cancelInFlight = cancelCampaign(ctx.workspace, id, { reason: 'test' });
        const r = await running;
        // Ale NEŽ se pustí další dávka, úklid musí doběhnout. Bez toho by smyčka
        // `cancelCampaign` mopovala i všechny pozdější dávky a záporná kontrola
        // by vycházela nula i nad implementací, která závod neošetřuje. Překryv
        // s dávkou, kvůli kterému scénář existuje, zůstává: úklid běžel celou dobu,
        // co běžel `INSERT`.
        if (triggering) await cancelInFlight;
        return r;
      },
      advanceCursor: async () => {},
      // Vypnuta kontrola je presne ta implementace, ktera zavod NEOSETRUJE.
      readStatus: async () =>
        checkStatusAfterBatch
          ? ((await readCampaignStatus(ctx.workspace, id)) as KnownCampaignStatus)
          : ('queueing' as KnownCampaignStatus),
      cleanupCancelled: async () =>
        cancelPendingBatch(ctx.workspace, { campaignId: id, audienceBuiltAt: audienceBuiltAt! }),
      now: () => new Date(),
      log: () => {},
    },
    {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      startCursor: ZERO_UUID,
      batchSize: RACE_BATCH_SIZE,
      maxMinutes: 60,
      where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [],
      releaseAt: null,
    },
  );

  // Souběžné zrušení musí doběhnout dřív, než se počítá; jinak by se měřil
  // mezistav a výsledek by kolísal z jiného důvodu, než jaký se zkoumá.
  if (cancelInFlight) await cancelInFlight;

  const r = await withWorkspace(ctx.workspace, (tx) =>
    tx.execute<{ n: number }>(
      rawSql(
        `SELECT count(*)::int AS n FROM messages
                              WHERE campaign_id = $1 AND status = 'pending'`,
        [id],
      ),
    ),
  );
  return r.rows[0]!.n;
}

describe('zavod zruseni s materializaci', () => {
  it('se zapnutou kontrolou stavu nezustane ani jedna pending zprava, 20 opakovani', async () => {
    for (let i = 0; i < 20; i++) {
      const at = 3 + (i % 12);
      expect(await runOnce(true, at)).toBe(0);
    }
  }, 900_000);

  it('s vypnutou kontrolou stavu test MUSI selhat, jinak nedokazuje nic', async () => {
    const leftovers: number[] = [];
    for (let i = 0; i < 5; i++) leftovers.push(await runOnce(false, 3 + i));
    expect(Math.max(...leftovers)).toBeGreaterThan(0);
  }, 600_000);
});
