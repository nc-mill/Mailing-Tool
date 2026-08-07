import { beforeEach, describe, expect, it } from 'vitest';
// ODCHYLKA OD PLÁNU, JEN V CESTÁCH. Harness leží v `campaigns/test/harness`, ne
// v `src/testing/harness`, a `getCampaign` v `campaigns/repo/campaign`.
import {
  withTestWorkspace,
  seedProvider,
  seedCampaign,
  migratorClient,
  type TestWorkspace,
} from '../../../campaigns/test/harness';
import {
  createProvider,
  setDefaultProvider,
  updateAccountSnapshot,
  listStaleQuota,
  getProviderById,
} from '../provider';

describe('repository provideru', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('prave jeden vychozi provider na projekt', async () => {
    const a = await seedProvider(ctx, { isDefault: true });
    const b = await seedProvider(ctx, { isDefault: false });
    await setDefaultProvider(ctx.workspace, b);
    expect((await getProviderById(ctx.workspace, a))!.is_default).toBe(false);
    expect((await getProviderById(ctx.workspace, b))!.is_default).toBe(true);
  });

  it('API nikdy nevraci tajemstvi, jen maskovany klic', async () => {
    const id = await seedProvider(ctx, {});
    const p = await getProviderById(ctx.workspace, id);
    expect(JSON.stringify(p!.config_public)).toMatch(/\*\*\*\*/);
    expect(p).not.toHaveProperty('config_encrypted');
  });

  it('snapshot uctu se propise do sloupcu a nastavi quota_checked_at', async () => {
    const id = await seedProvider(ctx, {});
    await updateAccountSnapshot(ctx.workspace, id, {
      quota_max_24h: 50_000,
      quota_max_send_rate: 14,
      quota_sent_24h: 100,
      production_access: true,
      enforcement_status: 'HEALTHY',
      sending_enabled: true,
      review_status: null,
    });
    const p = await getProviderById(ctx.workspace, id);
    expect(p!.quota_max_24h).toBe(50_000);
    expect(p!.quota_checked_at).not.toBeNull();
  });

  /**
   * Stav zadosti o produkcni pristup se cetl z Amazonu a zahazoval: sloupec
   * `review_status` nebyl v zadne migraci a zapis se ho za behu ptal
   * `information_schema`, pri neexistenci ho z UPDATE vynechal a hodnota tise
   * zmizela. Sloupec zavadi migrace 0025, obchazeni je pryc.
   *
   * Pta se OBOU stran, a to schvalne. Zapis kontroluje primo v databazi pod
   * migratorskou roli, cteni pres `getProviderById`. Chvili totiz platilo, ze se
   * hodnota ulozi a nikdo ji neprecte, protoze `PUBLIC_COLUMNS` ji nevracely:
   * kontrola jen jedne strany by tenhle stav prohlasila za v poradku.
   */
  it('stav zadosti o produkcni pristup se ULOZI, ne zahodi', async () => {
    const id = await seedProvider(ctx, {});
    // Hodnota z vyctu ReviewStatus v AWS SDK: PENDING, GRANTED, DENIED, FAILED.
    await updateAccountSnapshot(ctx.workspace, id, {
      quota_max_24h: 200,
      quota_max_send_rate: 1,
      quota_sent_24h: 0,
      production_access: false,
      enforcement_status: 'HEALTHY',
      sending_enabled: true,
      review_status: 'PENDING',
    });
    const { rows } = await migratorClient().query<{ review_status: string | null }>(
      `SELECT review_status FROM sending_providers WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.review_status).toBe('PENDING');

    // A ted druha strana: hodnota musi projit i ven, ne jen do tabulky.
    expect((await getProviderById(ctx.workspace, id))!.review_status).toBe('PENDING');

    // Zamitnuta zadost prepise bezici. Bez toho by preflight nemel podle ceho
    // rozlisit „ceka se" od „Amazon odmitl".
    await updateAccountSnapshot(ctx.workspace, id, {
      quota_max_24h: 200,
      quota_max_send_rate: 1,
      quota_sent_24h: 0,
      production_access: false,
      enforcement_status: 'HEALTHY',
      sending_enabled: true,
      review_status: 'DENIED',
    });
    const after = await migratorClient().query<{ review_status: string | null }>(
      `SELECT review_status FROM sending_providers WHERE id = $1`,
      [id],
    );
    expect(after.rows[0]!.review_status).toBe('DENIED');
  });

  it('job vybira providery s nejstarsi kontrolou kvoty', async () => {
    const old = await seedProvider(ctx, { status: 'ready', quotaCheckedMinutesAgo: 120 });
    await seedProvider(ctx, { status: 'ready', quotaCheckedMinutesAgo: 1 });
    const stale = await listStaleQuota(ctx.workspace, { limit: 1 });
    expect(stale[0]!.id).toBe(old);
  });

  it('provider s bezici kampani nejde smazat', async () => {
    const id = await seedProvider(ctx, {});
    await seedCampaign(ctx, { status: 'sending', providerId: id });
    expect(createProvider).toBeDefined();
    const { deleteProvider } = await import('../provider');
    await expect(deleteProvider(ctx.workspace, id)).rejects.toThrowError(/conflict/);
  });
});
