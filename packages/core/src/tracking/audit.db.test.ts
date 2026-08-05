import { describe, expect, it } from 'vitest';
import { createWorkspaceContext } from '../identity/context';
import { ensurePublicTrackingKey } from './ingest/settings-service';
import { asMigrator, seedWorkspace } from './test/support/db';

/**
 * VZNIK VEŘEJNÉHO KLÍČE MUSÍ BÝT V AUDITU.
 *
 * Klíč `ml_pub_` je údaj, kterým se do projektu ZAPISUJÍ DATA, a vzniká sám
 * při prvním otevření obrazovky Nastavení → Měření webu, tedy bez jediného
 * kliknutí. Bez záznamu by po něm nezůstala žádná stopa, přestože vznik klíče
 * k API (`api_key.created`) se auditoval od začátku.
 */
describe('audit vzniku veřejného měřicího klíče', () => {
  const auditRows = async (workspaceId: string) => {
    const { rows } = await asMigrator().query<{
      action: string;
      target_type: string | null;
      target_id: string | null;
      metadata: Record<string, unknown>;
    }>(
      `SELECT action, target_type, target_id, metadata FROM audit_log
        WHERE workspace_id = $1 AND action = 'tracking_key.created'`,
      [workspaceId],
    );
    return rows;
  };

  it('založení klíče zapíše záznam, opakované otevření obrazovky ne', async () => {
    const workspaceId = await seedWorkspace();
    const ctx = await createWorkspaceContext({
      kind: 'system',
      workspaceId,
      job: 'test.tracking_audit',
    });

    const created = await ensurePublicTrackingKey(ctx, null);
    const first = await auditRows(workspaceId);
    expect(first).toHaveLength(1);
    expect(first[0]!.target_type).toBe('api_key');
    expect(first[0]!.target_id).toBe(created.apiKeyId);

    // Klíč se podruhé nezakládá, takže se ani neauditue.
    await ensurePublicTrackingKey(ctx, null);
    expect(await auditRows(workspaceId)).toHaveLength(1);
  }, 300_000);

  it('metadata nesou, co je potřeba k dohledání, a NIKDY samotný klíč', async () => {
    const workspaceId = await seedWorkspace();
    const ctx = await createWorkspaceContext({
      kind: 'system',
      workspaceId,
      job: 'test.tracking_audit',
    });

    const created = await ensurePublicTrackingKey(ctx, null);
    const [row] = await auditRows(workspaceId);

    expect(row!.metadata).toMatchObject({
      key_id: created.apiKeyId,
      name: 'Měřicí kód na web',
      kind: 'public',
      scopes: ['events:write'],
    });

    // Klíč sám v auditu být nesmí, ani jeho prefix: `ml_pub_` a prefix je celá
    // jeho hodnota, takže zapsat prefix znamená zapsat klíč.
    const serialized = JSON.stringify(row!.metadata);
    expect(serialized).not.toContain(created.key);
    expect(serialized).not.toContain(created.key.replace('ml_pub_', ''));

    /**
     * Past, kvůli které se pole jmenuje `key_id`: redakce v `audit/redact.ts`
     * zakrývá každý klíč, jehož jméno OBSAHUJE `api_key`. Kdyby se pole
     * jmenovalo `api_key_id`, byla by v auditu hodnota `[redacted]` a záznam
     * by ztratil právě to, kvůli čemu vzniká.
     */
    expect(serialized).not.toContain('[redacted]');
  }, 300_000);
});
