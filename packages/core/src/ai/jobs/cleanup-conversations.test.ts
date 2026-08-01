import { describe, expect, it, vi } from 'vitest';
import { cleanupConversations } from './cleanup-conversations';

describe('job ai.cleanup_conversations', () => {
  it('při retenci 0 nemaže nic a řekne proč', async () => {
    const deleteOlderThan = vi.fn(async () => 0);
    const result = await cleanupConversations(
      { retentionDays: 0, now: new Date('2026-07-31T03:40:00.000Z') },
      { deleteConversationsOlderThan: deleteOlderThan },
    );
    expect(deleteOlderThan).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, skipped: true, reason: 'retention_unlimited' });
  });

  it('při retenci 90 dnů maže konverzace starší než hranice', async () => {
    const deleteOlderThan = vi.fn(async () => 12);
    const result = await cleanupConversations(
      { retentionDays: 90, now: new Date('2026-07-31T03:40:00.000Z') },
      { deleteConversationsOlderThan: deleteOlderThan },
    );
    expect(deleteOlderThan).toHaveBeenCalledWith(new Date('2026-05-02T03:40:00.000Z'));
    expect(result).toEqual({ deleted: 12, skipped: false });
  });

  it('záporná retence je chyba konfigurace, ne tiché smazání všeho', async () => {
    await expect(
      cleanupConversations(
        { retentionDays: -1, now: new Date() },
        { deleteConversationsOlderThan: vi.fn() },
      ),
    ).rejects.toThrow(/retenc/i);
  });
});
