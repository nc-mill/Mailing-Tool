import { describe, expect, it } from 'vitest';
import { describeContactState, type ContactStateInput } from './contact-state';

function contact(overrides: Partial<ContactStateInput> = {}): ContactStateInput {
  return {
    status: 'active',
    processing_restricted: false,
    snooze_until: null,
    anonymized_at: null,
    status_changed_at: '2026-07-03T10:00:00.000Z',
    restriction_requested_at: null,
    ...overrides,
  };
}

describe('describeContactState, devět podob z 8.8.1 části 6', () => {
  it('aktivní kontakt nemá doplňující větu a má plnou sadu akcí', () => {
    const view = describeContactState(contact());
    expect(view.badges.map((badge) => badge.labelKey)).toEqual(['status.active']);
    expect(view.notes).toEqual([]);
    expect(view.actions).toEqual(['edit', 'unsubscribe', 'delete', 'export']);
    expect(view.readOnly).toBe(false);
  });

  it('nepotvrzený vysvětlí, proč mu kampaně nechodí, a nabídne poslat potvrzení znovu', () => {
    const view = describeContactState(contact({ status: 'unconfirmed' }));
    expect(view.badges[0]).toEqual({ labelKey: 'status.unconfirmed', tone: 'warning' });
    expect(view.notes[0]!.textKey).toBe('statusNote.unconfirmed');
    expect(view.actions).toContain('resendConfirmation');
  });

  it('odhlášenému zmizí odhlášení a přibude přihlášení zpět', () => {
    const view = describeContactState(contact({ status: 'unsubscribed' }));
    expect(view.actions).not.toContain('unsubscribe');
    expect(view.actions).toContain('resubscribe');
  });

  it('nedoručitelný odkáže na blokované adresy', () => {
    const view = describeContactState(contact({ status: 'bounced' }));
    expect(view.badges[0]!.tone).toBe('danger');
    expect(view.actions).toContain('openSuppressions');
  });

  it('u nahlášeného spamu není žádná akce, která by ho vrátila', () => {
    const view = describeContactState(contact({ status: 'complained' }));
    expect(view.actions).not.toContain('resubscribe');
    expect(view.actions).not.toContain('resendConfirmation');
    expect(view.notes[0]!.textKey).toBe('statusNote.complained');
  });

  it('smazaný kontakt je celý jen pro čtení', () => {
    const view = describeContactState(contact({ status: 'deleted' }));
    expect(view.readOnly).toBe(true);
    expect(view.actions).toEqual(['export']);
  });

  it('omezené zpracování je odznak navíc ke stavu, ne místo něj', () => {
    const view = describeContactState(contact({ processing_restricted: true }));
    expect(view.badges.map((badge) => badge.labelKey)).toEqual([
      'status.active',
      'flag.processingRestricted',
    ]);
    expect(view.restricted).toBe(true);
    expect(view.actions).toContain('showRestriction');
  });

  it('omezené zpracování nebrání opravě údajů, jen rozesílce', () => {
    const view = describeContactState(contact({ processing_restricted: true }));
    expect(view.actions).toContain('edit');
    expect(view.actions).toContain('showRestriction');
  });

  it('smazaný kontakt se needituje', () => {
    expect(describeContactState(contact({ status: 'deleted' })).actions).not.toContain('edit');
  });

  it('pozastavení nese datum a nabídne zrušení pauzy', () => {
    const view = describeContactState(contact({ snooze_until: '2026-09-30T00:00:00.000Z' }));
    expect(view.badges[1]).toEqual({
      labelKey: 'flag.snoozed',
      tone: 'neutral',
      values: { date: '2026-09-30T00:00:00.000Z' },
    });
    expect(view.actions).toContain('cancelSnooze');
  });

  it('anonymizovaný kontakt nemá osobní údaje a je jen pro čtení', () => {
    const view = describeContactState(
      contact({ status: 'deleted', anonymized_at: '2026-07-20T09:00:00.000Z' }),
    );
    expect(view.badges.map((badge) => badge.labelKey)).toContain('flag.anonymized');
    expect(view.showsPersonalData).toBe(false);
    expect(view.readOnly).toBe(true);
  });

  it('každý odznak nese slovo, nikdy jen tón', () => {
    for (const input of [
      contact(),
      contact({ status: 'unconfirmed' }),
      contact({ status: 'unsubscribed' }),
      contact({ status: 'bounced' }),
      contact({ status: 'complained' }),
      contact({ status: 'deleted' }),
      contact({ processing_restricted: true }),
      contact({ snooze_until: '2026-09-30T00:00:00.000Z' }),
      contact({ anonymized_at: '2026-07-20T09:00:00.000Z' }),
    ]) {
      for (const badge of describeContactState(input).badges) {
        expect(badge.labelKey.length).toBeGreaterThan(0);
      }
    }
  });
});
