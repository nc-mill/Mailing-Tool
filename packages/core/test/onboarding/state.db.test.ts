import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { hideOnboardingPanel, loadOnboardingState } from '../../src/onboarding/state';

let pg: TestPostgres;
let workspaceId: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  workspaceId = (await pg.seedMinimalInstallation({ contacts: 0 })).workspaceId;
}, 240_000);

beforeEach(async () => {
  await pg.sql('DELETE FROM messages WHERE workspace_id = $1', [workspaceId]);
  await pg.sql('DELETE FROM campaign_stats WHERE workspace_id = $1', [workspaceId]);
  await pg.sql('DELETE FROM contacts WHERE workspace_id = $1', [workspaceId]);
  await pg.sql('DELETE FROM campaigns WHERE workspace_id = $1', [workspaceId]);
  await pg.sql('DELETE FROM templates WHERE workspace_id = $1', [workspaceId]);
  await pg.sql('DELETE FROM sending_providers WHERE workspace_id = $1', [workspaceId]);
  await pg.sql(`UPDATE workspaces SET settings = '{}'::jsonb WHERE id = $1`, [workspaceId]);
});

afterAll(async () => {
  await pg?.stop();
});

// Všechno běží pod APLIKAČNÍ rolí s nastaveným kontextem projektu, tedy
// přesně tak, jak to za běhu dělá `withWorkspace`. Pod migrátorem by testy
// prošly i tehdy, kdyby produkční kód kontext vůbec nenastavoval.
const state = (ws = workspaceId) => pg.inWorkspace(ws, (tx) => loadOnboardingState(tx, ws));

describe('loadOnboardingState', () => {
  it('na čerstvém projektu je pět kroků a žádný hotový', async () => {
    const s = await state();
    expect(s!.steps).toHaveLength(5);
    expect(s!.doneCount).toBe(0);
    expect(s!.finished).toBe(false);
    expect(s!.hidden).toBe(false);
  });

  it('kroky jsou v pořadí ze specifikace 8.1.3', async () => {
    expect((await state())!.steps.map((x) => x.id)).toEqual([
      'sending',
      'contacts',
      'template',
      'testSend',
      'firstCampaign',
    ]);
  });

  it('kontakt v projektu odškrtne krok contacts a ostatní nechá', async () => {
    await pg.sql(
      `INSERT INTO contacts (workspace_id, email, status, source, locale, timezone)
       VALUES ($1, 'kdo@example.com', 'active', 'manual', 'cs', 'Europe/Prague')`,
      [workspaceId],
    );
    const s = await state();
    expect(s!.steps.find((x) => x.id === 'contacts')?.done).toBe(true);
    expect(s!.doneCount).toBe(1);
  });

  it('ukázkový kontakt krok contacts NEodškrtne', async () => {
    await pg.sql(
      `INSERT INTO contacts (workspace_id, email, status, source, source_ref, locale, timezone)
       VALUES ($1, 'jana@example.com', 'active', 'manual', 'demo-data:v1', 'cs', 'Europe/Prague')`,
      [workspaceId],
    );
    expect((await state())!.steps.find((x) => x.id === 'contacts')?.done).toBe(false);
  });

  it('odeslaná kampaň znamená finished', async () => {
    await pg.seedSentCampaign({ workspaceId });
    const s = await state();
    expect(s!.finished).toBe(true);
  });

  it('zkušební odeslání se pozná podle messages.kind, ne podle sloupce na kampani', async () => {
    // `campaigns.last_test_sent_at` ve schématu NEEXISTUJE. Kdyby se na něj
    // dotaz vrátil, spadl by na `column ... does not exist` a shodil by
    // celý panel, ne jen jeden krok.
    const { campaignId } = await pg.seedSentCampaign({ workspaceId });
    // INVARIANT I1 vyžaduje messages.created_at = campaigns.audience_built_at,
    // takže se kampani nejdřív nastaví okamžik zmrazení publika.
    await pg.sql('UPDATE campaigns SET audience_built_at = now() WHERE id = $1', [campaignId]);
    const [contact] = await pg.sql<{ id: string }>(
      `INSERT INTO contacts (workspace_id, email, status, source, locale, timezone)
       VALUES ($1, 'test@example.com', 'active', 'manual', 'cs', 'Europe/Prague')
       RETURNING id`,
      [workspaceId],
    );
    await pg.sql(
      `INSERT INTO messages (workspace_id, campaign_id, kind, contact_id, email, status,
                             sent_at, created_at)
       SELECT $1, c.id, 'test', $3, 'test@example.com', 'sent', now(), c.audience_built_at
         FROM campaigns c WHERE c.id = $2`,
      [workspaceId, campaignId, contact!.id],
    );
    expect((await state())!.steps.find((x) => x.id === 'testSend')?.done).toBe(true);
  });

  it('krok jde přeskočit, stav se drží a po návratu je tam pořád', async () => {
    // Na ČERSTVÉM projektu, tedy když settings je prázdný objekt. Přesně tam
    // selhává naivní jsonb_set(settings, '{onboarding,hidden}', ..., true):
    // vrátí vstup beze změny, protože create_missing vytvoří jen poslední klíč
    // cesty, ne mezilehlý objekt `onboarding`.
    const before = await pg.sql<{ settings: Record<string, unknown> }>(
      'SELECT settings FROM workspaces WHERE id = $1',
      [workspaceId],
    );
    expect(before[0]!.settings).toEqual({});

    await pg.inWorkspace(workspaceId, (tx) => hideOnboardingPanel(tx, workspaceId, true));
    const s = await state();
    expect(s!.hidden).toBe(true);
    expect(s!.steps).toHaveLength(5);
  });

  it('skrytí panelu nesmaže manifest ukázkových dat ani gratulaci', async () => {
    // Druhá past téhož sloupce: přepsat celý `onboarding` místo sloučení
    // by zahodilo `finishedDismissed`, a přepsat celý `settings` by zahodilo
    // `demoData`, tedy jediný způsob, jak ukázková data najít a smazat.
    await pg.sql(
      `UPDATE workspaces
          SET settings = '{"demoData":{"version":1,"contactIds":["a"]},
                           "onboarding":{"finishedDismissed":true}}'::jsonb
        WHERE id = $1`,
      [workspaceId],
    );
    await pg.inWorkspace(workspaceId, (tx) => hideOnboardingPanel(tx, workspaceId, true));
    const rows = await pg.sql<{ settings: Record<string, Record<string, unknown>> }>(
      'SELECT settings FROM workspaces WHERE id = $1',
      [workspaceId],
    );
    expect(rows[0]!.settings['demoData']!['contactIds']).toEqual(['a']);
    expect(rows[0]!.settings['onboarding']).toEqual({ finishedDismissed: true, hidden: true });
  });

  it('u neznámého projektu vrací null, ne prázdný stav', async () => {
    const unknown = '00000000-0000-7000-8000-000000000000';
    expect(await pg.inWorkspace(unknown, (tx) => loadOnboardingState(tx, unknown))).toBeNull();
  });
});
