import { describe, expect, it } from 'vitest';
import { resolveUndoWindow, computeReleaseAt, undoState } from '../undo';

describe('okno na zruseni odeslani', () => {
  it('vychozi delka je 60 sekund', () => {
    expect(resolveUndoWindow({}, { CAMPAIGN_UNDO_WINDOW_SECONDS: 60 })).toBe(60);
  });

  it('projekt smi okno zkratit', () => {
    expect(
      resolveUndoWindow({ undo_window_seconds: 20 }, { CAMPAIGN_UNDO_WINDOW_SECONDS: 60 }),
    ).toBe(20);
  });

  it('projekt nesmi okno prodlouzit, hodnota se orizne na strop instalace', () => {
    expect(
      resolveUndoWindow({ undo_window_seconds: 300 }, { CAMPAIGN_UNDO_WINDOW_SECONDS: 60 }),
    ).toBe(60);
  });

  it('nula okno vypina a odesila se okamzite', () => {
    expect(
      resolveUndoWindow({ undo_window_seconds: 0 }, { CAMPAIGN_UNDO_WINDOW_SECONDS: 60 }),
    ).toBe(0);
    expect(computeReleaseAt(new Date('2026-08-01T10:00:00.000Z'), 0)).toBeNull();
  });

  it('release_at je audience_built_at plus okno', () => {
    expect(computeReleaseAt(new Date('2026-08-01T10:00:00.000Z'), 60)!.toISOString()).toBe(
      '2026-08-01T10:01:00.000Z',
    );
  });

  it('behem okna a bez odeslane zpravy jde vzit zpet', () => {
    expect(
      undoState({
        sentCount: 0,
        releaseAt: new Date('2026-08-01T10:01:00.000Z'),
        now: new Date('2026-08-01T10:00:30.000Z'),
      }),
    ).toEqual({ canUndo: true, remainingSeconds: 30 });
  });

  it('po vyprseni okna vraci campaign_undo_window_expired', () => {
    expect(
      undoState({
        sentCount: 0,
        releaseAt: new Date('2026-08-01T10:01:00.000Z'),
        now: new Date('2026-08-01T10:02:00.000Z'),
      }),
    ).toEqual({ canUndo: false, reason: 'campaign_undo_window_expired', remainingSeconds: 0 });
  });

  it('kdyz uz neco odeslo, undo nejde ani uvnitr okna', () => {
    expect(
      undoState({
        sentCount: 1,
        releaseAt: new Date('2026-08-01T10:01:00.000Z'),
        now: new Date('2026-08-01T10:00:10.000Z'),
      }).canUndo,
    ).toBe(false);
  });
});
