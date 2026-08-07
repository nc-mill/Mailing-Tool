import { PgBoss } from 'pg-boss';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  migratorClient,
  seedCampaign,
  seedOutbox,
  seedProvider,
  withTestWorkspace,
  type TestWorkspace,
} from '../../test/harness';
import { buildPauseReason } from '../../pause-reason';
import { rawSql } from '../../repo/raw-sql';
import { startMaterialization } from '../../repo/audience-progress';
import { withWorkspace } from '../../../tx';
import { resumeOnQuotaHandler } from '../resume-on-quota';
import { schedulerHandler } from '../scheduler';
import { watchdogHandler } from '../watchdog';
import { systemResumeOnQuotaDeps, systemSchedulerDeps, systemWatchdogDeps } from '../system-deps';

/**
 * Systémové úlohy domény kampaní se skutečnými závislostmi.
 *
 * Handlery samotné mají jednotkové testy s podvrženými `deps`; ty ale ověřují
 * ROZHODOVÁNÍ, ne to, že se závislosti dají složit. Přesně tam byla díra:
 * `listWorkspaces` v provozu vracel prázdný seznam, cyklus se nerozběhl, úloha
 * skončila úspěchem a naplánovaná kampaň se nikdy neodeslala.
 *
 * Tenhle soubor proto volá skutečné továrny z `system-deps.ts` proti databázi.
 * Nepotřebuje k tomu rejstřík front ani běžící worker: rejstřík rozhoduje jen
 * o tom, kdo obsluhu zavolá, ne o tom, jestli funguje.
 */

/** Fronty, do kterých tyhle úlohy zařazují. `job.name` má cizí klíč na `queue.name`. */
const QUEUES_USED = ['campaign.materialize', 'platform.webhook_fanout'];

let pgBossReady = false;

async function installPgBoss(): Promise<void> {
  if (pgBossReady) return;
  const migrator = migratorClient();
  const connectionString = (migrator.options as { connectionString?: string }).connectionString;
  if (!connectionString) throw new Error('migrátorský pool nemá connectionString');

  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    supervise: false,
    schedule: false,
  });
  await boss.start();
  for (const name of QUEUES_USED) await boss.createQueue(name);
  await boss.stop({ graceful: false });
  await migrator.query(`GRANT USAGE ON SCHEMA pgboss TO mlain_app`);
  await migrator.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO mlain_app`,
  );
  pgBossReady = true;
}

async function campaignStatus(campaignId: string): Promise<string | null> {
  const { rows } = await migratorClient().query<{ status: string }>(
    `SELECT status FROM campaigns WHERE id = $1`,
    [campaignId],
  );
  return rows[0]?.status ?? null;
}

async function enqueuedFor(queue: string, campaignId: string): Promise<number> {
  const { rows } = await migratorClient().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pgboss.job
      WHERE name = $1 AND data ->> 'campaignId' = $2`,
    [queue, campaignId],
  );
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  await installPgBoss();
}, 300_000);

describe('campaign.scheduler se skutečnými závislostmi', () => {
  let ctx: TestWorkspace;

  beforeAll(async () => {
    ctx = await withTestWorkspace();
  }, 300_000);

  /**
   * Jádro nálezu I82. Kampaň leží v projektu, který plánovač předem nezná;
   * musí ho najít skenem napříč instalací. Před zapojením role
   * `mlain_maintenance` vrátil ten sken prázdno a tenhle test by skončil na
   * `expected 0 to be 1`, aniž by cokoli selhalo v aplikaci.
   */
  it('najde kampaň naplánovanou do minulosti a zařadí její materializaci', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 10 });
    expect(await enqueuedFor('campaign.materialize', id)).toBe(0);

    await schedulerHandler(systemSchedulerDeps());

    expect(await enqueuedFor('campaign.materialize', id)).toBe(1);
  });

  /**
   * Zpoždění nad SCHEDULE_DELAY_NOTIFY_SECONDS (5 minut) je pro uživatele
   * viditelná změna, takže se hlásí událostí i auditem. Test se ptá na obojí,
   * protože obojí jde jinou cestou: audit pod aplikační rolí v kontextu
   * projektu, událost přes `webhook_events` plus zařazený fan-out.
   */
  it('zpoždění nad pět minut zapíše audit i odchozí událost', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 30 });

    await schedulerHandler(systemSchedulerDeps());

    const audit = await migratorClient().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'campaign.schedule_delayed' AND target_id = $1`,
      [id],
    );
    expect(audit.rows[0]!.n).toBe('1');

    const event = await migratorClient().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM webhook_events
        WHERE type = 'campaign.schedule_delayed' AND payload ->> 'campaign_id' = $1`,
      [id],
    );
    expect(event.rows[0]!.n).toBe('1');
  });

  /**
   * Změna stavu přímo v tabulce `campaigns`. Kampaň starší než catch-up okno
   * (výchozích 6 hodin) se NEODESLE a čeká na rozhodnutí člověka.
   */
  it('kampaň za catch-up oknem převede na schedule_missed', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 10 * 60 });

    await schedulerHandler(systemSchedulerDeps());

    expect(await campaignStatus(id)).toBe('schedule_missed');
    expect(await enqueuedFor('campaign.materialize', id)).toBe(0);
  });

  /**
   * Předání dál. Plánovač kampaň sám nepřepíná, přepne ji až materializace,
   * a právě proto se to testuje: kdyby náklad úlohy nesl špatný projekt nebo
   * špatné ID, převzetí by neproběhlo a kampaň by zůstala ve `scheduled`
   * navždy, protože další tik by ji zařadil znovu pod týmž singleton klíčem.
   */
  it('zařazená úloha kampaň skutečně rozjede: scheduled → queueing', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 3 });

    await schedulerHandler(systemSchedulerDeps());
    expect(await campaignStatus(id)).toBe('scheduled');

    const payload = await migratorClient().query<{ workspace_id: string; campaign_id: string }>(
      `SELECT data ->> 'workspaceId' AS workspace_id, data ->> 'campaignId' AS campaign_id
         FROM pgboss.job WHERE name = 'campaign.materialize' AND data ->> 'campaignId' = $1`,
      [id],
    );
    expect(payload.rows[0]!.workspace_id).toBe(ctx.workspaceId);

    // První krok obsluhy `campaign.materialize`, spuštěný z nákladu té úlohy.
    const claim = await startMaterialization(ctx.workspace, payload.rows[0]!.campaign_id, 0);
    expect(claim.claimed).toBe(true);
    expect(await campaignStatus(id)).toBe('queueing');
  });

  /**
   * TA SPRÁVNÁ CHVÍLE NASTALA 7. 8. Předchozí znění tohohle testu bylo NÁLEZ,
   * ne popis žádaného stavu, a jeho komentář končil slovy: „kdyby někdo politiku
   * fronty doplnit, test spadne a bude to ta správná chvíle tenhle komentář
   * smazat". Spadl přesně na tom.
   *
   * Co se změnilo: testovací prostředí zakládalo fronty BEZ politiky slučování,
   * kdežto provoz je zakládá s politikou z registru. Obě strany se srovnaly
   * (`queueCreatePlan`), takže `campaign.materialize` má i v testu `exclusive`
   * a druhý tik plánovače se sloučí s prvním.
   *
   * Tvrzení se proto OTOČILO a je ostřejší než dřív. Nestačí, že je úloha jen
   * jedna: druhá polovina původního testu se drží celá, protože chrání jinou
   * vlastnost. Převzetí kampaně je jediný `UPDATE` s podmínkou na výchozí stav,
   * takže i kdyby se slučování zase rozbilo, druhá úloha nic nepřevezme.
   * Dvě nezávislé pojistky nad týmž rizikem, každá měřená zvlášť.
   */
  it('druhý tik plánovače se sloučí s prvním a převzít kampaň jde stejně jen jednou', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 2 });

    await schedulerHandler(systemSchedulerDeps());
    await schedulerHandler(systemSchedulerDeps());

    // Plánovač tiká každých 30 sekund a kampaň zůstává ve `scheduled`, dokud ji
    // nepřevezme materializace, takže ji každý další tik najde znovu. Bez
    // slučování by se za minutu sešly dvě materializace nad týmž outboxem.
    expect(await enqueuedFor('campaign.materialize', id)).toBe(1);

    expect((await startMaterialization(ctx.workspace, id, 0)).claimed).toBe(true);
    expect((await startMaterialization(ctx.workspace, id, 0)).claimed).toBe(false);
  });
});

describe('campaign.watchdog se skutečnými závislostmi', () => {
  it('uzavře doposlanou kampaň napříč projekty: sending → sent', async () => {
    const ctx = await withTestWorkspace();
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 3 });
    // Klidové okno hlídače je 10 sekund od poslední změny ZPRÁV. Bez posunu
    // by test měřil rychlost stroje, ne chování úlohy.
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(
          `UPDATE messages SET updated_at = now() - interval '1 hour' WHERE campaign_id = $1`,
          [id],
        ),
      ),
    );

    await watchdogHandler(systemWatchdogDeps());

    expect(await campaignStatus(id)).toBe('sent');
  });
});

describe('campaign.resume_on_quota se skutečnými závislostmi', () => {
  it('rozjede kampaň pozastavenou vyčerpanou kvótou, když je kvóta volná', async () => {
    const ctx = await withTestWorkspace();
    const providerId = await seedProvider(ctx, { status: 'ready' });
    const id = await seedCampaign(ctx, { status: 'sending', providerId });

    // Pauza v tom tvaru, v jakém ji zapisuje SENDER. Dřívější znění úlohy
    // hledalo `pause_reason = 'quota'`, takže tuhle kampaň nenašlo nikdy.
    const reason = buildPauseReason('provider_quota_exhausted', 'sender', {
      senderId: 'sender-test',
    });
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(
          `UPDATE campaigns SET status = 'paused', paused_at = now(), pause_reason = $2::jsonb
            WHERE id = $1`,
          [id, JSON.stringify(reason)],
        ),
      ),
    );

    await resumeOnQuotaHandler(systemResumeOnQuotaDeps());

    expect(await campaignStatus(id)).toBe('sending');
  });
});
