import { beforeEach, describe, expect, it } from 'vitest';
import {
  withTestWorkspace,
  migratorClient,
  seedCampaign,
  seedContacts,
  seedList,
  type TestWorkspace,
} from '../../test/harness';
import { withWorkspace } from '../../../tx';
import { ZERO_UUID } from '../../materialize/plan-constants';
import { runMaterializeLoop } from '../../materialize/loop';
import { resolveTrialSettings } from '../../../providers/trial-mode';
import { setTrialMode } from '../../../providers/api/trial-service';
import { writeWorkspaceSettingsKey } from '../../api/service';
import { startMaterialization, advanceCursor, finishMaterialization } from '../audience-progress';
import { materializeBatch, type RenderPlan } from '../outbox';
import { rawSql } from '../raw-sql';

const EMPTY_RENDER_PLAN: RenderPlan = {
  usedPaths: [],
  preparedSchema: { fields: [], presence: [] },
};

/**
 * DOSLOVNÝ dotaz, kterým si sender bere zprávy k odeslání.
 *
 * Je zkopírovaný z `apps/sender/internal/outbox/statements.go`, konstanta
 * `StmtClaimBatch`, a je to ZÁMĚR, ne duplicita z lenosti. Test nesmí měřit
 * počet řádků ve stavu `skipped`: to je jen tvrzení o sloupci. Měří se, kolik
 * zpráv si sender doopravdy vezme, protože právě to je „odešle se".
 *
 * `FOR UPDATE OF m SKIP LOCKED` a `RETURNING` jsou vynechané jen proto, že test
 * neběží souběžně a nepotřebuje náklad zprávy; podmínky výběru jsou totožné.
 */
const SENDER_CLAIM_SQL = `
  SELECT m.id, m.email
    FROM messages m
    JOIN campaigns c ON c.id = m.campaign_id
    JOIN workspaces w ON w.id = m.workspace_id
   WHERE m.campaign_id = $1
     AND m.campaign_id IS NOT NULL
     AND m.status = 'pending'
     AND m.next_attempt_at <= now()
     AND m.kind = 'campaign'
     AND c.status IN ('queueing','sending')
     AND c.deleted_at IS NULL
     AND w.deleted_at IS NULL
   ORDER BY m.next_attempt_at, m.id`;

/** Co si sender vezme k odeslání. Čte se pod migrátorem, aby to neovlivnila RLS testu. */
async function claimableEmails(campaignId: string): Promise<string[]> {
  const { rows } = await migratorClient().query<{ email: string }>(SENDER_CLAIM_SQL, [campaignId]);
  return rows.map((r) => r.email).sort();
}

async function outboxRows(
  ctx: TestWorkspace,
  campaignId: string,
): Promise<Array<{ email: string; status: string; error_code: string | null }>> {
  const r = await withWorkspace(ctx.workspace, (tx) =>
    tx.execute<{ email: string; status: string; error_code: string | null }>(
      rawSql(
        `SELECT email, status, error_code FROM messages WHERE campaign_id = $1 ORDER BY email`,
        [campaignId],
      ),
    ),
  );
  return r.rows;
}

/**
 * Brána zkušebního režimu.
 *
 * Funkce `canSendInTrial` byla napsaná, otestovaná a NIKDO ji nevolal. Zapnutý
 * zkušební režim proto kampaň nezastavil a rozeslal ji všem, zatímco obrazovka
 * publika slibovala, že se odešle jen ověřeným adresám. Testy níž měří odeslání,
 * ne stav sloupce: bez brány v `materializeBatch` vyjde `claimableEmails` na tři
 * adresy místo jedné a padnou.
 */
describe('zkušební režim zastaví odeslání', () => {
  let ctx: TestWorkspace;
  let list: string;

  beforeEach(async () => {
    ctx = await withTestWorkspace();
    list = await seedList(ctx);
  });

  async function seedThree(): Promise<void> {
    await seedContacts(ctx, { count: 1, list, email: 'overena@firma.cz' });
    await seedContacts(ctx, { count: 1, list, email: 'cizi1@example.cz' });
    await seedContacts(ctx, { count: 1, list, email: 'cizi2@example.cz' });
  }

  it('tři příjemci, jeden ověřený: sender si vezme právě jednu zprávu', async () => {
    await seedThree();
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    const out = await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [],
      releaseAt: null,
      trial: {
        trial_mode: true,
        trial_verified: [
          { email: 'overena@firma.cz', verified_at: '2026-08-01T10:00:00.000Z' },
          // Přidaná, ale NEPOTVRZENÁ adresa. Kdyby brána koukala jen na seznam
          // a ne na `verified_at`, stačilo by si adresu přidat a nic neověřovat.
          { email: 'cizi1@example.cz', verified_at: null },
        ],
      },
    });

    expect(out.skippedTrial).toBe(2);
    expect(await claimableEmails(id)).toEqual(['overena@firma.cz']);

    const rows = await outboxRows(ctx, id);
    expect(rows).toEqual([
      { email: 'cizi1@example.cz', status: 'skipped', error_code: 'trial_not_verified' },
      { email: 'cizi2@example.cz', status: 'skipped', error_code: 'trial_not_verified' },
      { email: 'overena@firma.cz', status: 'pending', error_code: null },
    ]);
  });

  it('vypnutý zkušební režim nechá projít všechny tři', async () => {
    await seedThree();
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    const out = await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [],
      releaseAt: null,
      trial: { trial_mode: false },
    });

    expect(out.skippedTrial).toBe(0);
    expect(await claimableEmails(id)).toHaveLength(3);
  });

  /**
   * Past čerstvého projektu. Uložená hodnota `trial_mode` u nového projektu CHYBÍ
   * a `resolveTrialSettings` z ní dělá ZAPNUTO, dokud není ověřená doména. Kdyby
   * se chybějící klíč četl jako „vypnuto", zkušební režim by nechránil právě tam,
   * kde je ho potřeba nejvíc.
   */
  it('projekt bez ověřené domény a bez uloženého přepínače je chráněný', async () => {
    await seedThree();
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [],
      releaseAt: null,
      trial: resolveTrialSettings(
        {
          trial_verified: [{ email: 'overena@firma.cz', verified_at: '2026-08-01T10:00:00.000Z' }],
        },
        { hasVerifiedDomain: false },
      ),
    });

    expect(await claimableEmails(id)).toEqual(['overena@firma.cz']);
  });

  /**
   * Okamžitá cesta. Kampaň už je rozmaterializovaná a teprve pak uživatel zapne
   * zkušební režim. Brána v materializaci na to nedosáhne, protože běh je hotový;
   * bez `revokePendingOutsideTrial` by zprávy odešly a uživatel by viděl, že
   * ochranu zapnul a pošta stejně odchází.
   */
  it('zapnutí režimu po materializaci zruší čekající zprávy', async () => {
    await seedThree();
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [],
      releaseAt: null,
      trial: { trial_mode: false },
    });
    expect(await claimableEmails(id)).toHaveLength(3);

    await writeWorkspaceSettingsKey(ctx.workspace, 'campaigns', {
      trial_verified: [{ email: 'overena@firma.cz', verified_at: '2026-08-01T10:00:00.000Z' }],
    });
    await setTrialMode(ctx.workspace, true);

    expect(await claimableEmails(id)).toEqual(['overena@firma.cz']);
  });

  /**
   * Materializační smyčka nesmí bránu ztratit cestou. Je to táž třída chyby jako
   * ta původní: kdyby `runMaterializeLoop` hodnotu do dávky nepředala, jednotkové
   * testy dávky by zůstaly zelené a produkce by rozeslala všem.
   */
  it('celá smyčka po dávkách po jedné zprávě předá bránu do každé dávky', async () => {
    await seedThree();
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const started = await startMaterialization(ctx.workspace, id, 0);

    const result = await runMaterializeLoop(
      {
        batch: (input) => materializeBatch(ctx.workspace, { ...input, statementTimeoutMs: 30_000 }),
        advanceCursor: (input) =>
          advanceCursor(ctx.workspace, {
            campaignId: input.campaignId,
            cursor: input.cursor,
            inserted: input.inserted,
          }),
        readStatus: async () => 'queueing',
        cleanupCancelled: async () => 0,
        now: () => new Date(),
        log: () => {},
      },
      {
        campaignId: id,
        audienceBuiltAt: started.audienceBuiltAt!,
        startCursor: ZERO_UUID,
        // Jedna zpráva na dávku: brána se musí trefit v každé z nich, ne jen v první.
        batchSize: 1,
        maxMinutes: 60,
        where: { sql: 'true', params: [] },
        renderPlan: EMPTY_RENDER_PLAN,
        sampleContactIds: [],
        releaseAt: null,
        trial: {
          trial_mode: true,
          trial_verified: [{ email: 'overena@firma.cz', verified_at: '2026-08-01T10:00:00.000Z' }],
        },
      },
    );

    expect(result.outcome).toBe('completed');
    await finishMaterialization(ctx.workspace, id, started.audienceBuiltAt!);
    expect(await claimableEmails(id)).toEqual(['overena@firma.cz']);
  });
});
