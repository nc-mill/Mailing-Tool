import { describe, expect, it } from 'vitest';
import {
  SUBSCRIPTION_STATES,
  transition,
  type SubscriptionEvent,
  type SubscriptionState,
} from '../../lists/state-machine';

const now = new Date('2026-07-31T10:00:00.000Z');

/** Úplná tabulka přechodů ze 4.8.1 části 2, řádek po řádku. */
const TABLE: {
  label: string;
  from: SubscriptionState;
  event: SubscriptionEvent;
  to: SubscriptionState | 'deleted';
  effects: string[];
}[] = [
  {
    label: 'žádný + subscribe single',
    from: 'none',
    event: { kind: 'subscribe', optIn: 'single', source: 'form', now },
    to: 'confirmed',
    effects: ['grant_consent', 'send_welcome', 'emit_subscribed'],
  },
  {
    label: 'žádný + subscribe double',
    from: 'none',
    event: { kind: 'subscribe', optIn: 'double', source: 'form', now },
    to: 'pending',
    effects: ['issue_token', 'send_confirmation'],
  },
  {
    label: 'pending + confirm platným tokenem',
    from: 'pending',
    event: { kind: 'confirm', token: 'valid', now },
    to: 'confirmed',
    effects: [
      'consume_token',
      'grant_consent',
      'send_welcome',
      'activate_contact',
      'emit_subscribed',
    ],
  },
  {
    label: 'pending + confirm prošlým tokenem',
    from: 'pending',
    event: { kind: 'confirm', token: 'expired', now },
    to: 'pending',
    effects: ['issue_token', 'send_confirmation'],
  },
  {
    label: 'pending + confirm spotřebovaným tokenem',
    from: 'pending',
    event: { kind: 'confirm', token: 'consumed', now },
    to: 'confirmed',
    effects: [],
  },
  {
    label: 'pending + subscribe znovu',
    from: 'pending',
    event: { kind: 'subscribe', optIn: 'double', source: 'form', now },
    to: 'pending',
    effects: ['issue_token', 'send_confirmation'],
  },
  {
    label: 'pending + cleanup po TTL a 30 dnech',
    from: 'pending',
    event: { kind: 'cleanup', now },
    to: 'deleted',
    effects: ['delete_row'],
  },
  {
    label: 'pending + unsubscribe',
    from: 'pending',
    event: { kind: 'unsubscribe', scope: 'list', reason: 'link', now },
    to: 'unsubscribed',
    effects: ['revoke_pending_messages'],
  },
  {
    label: 'confirmed + unsubscribe ze seznamu',
    from: 'confirmed',
    event: { kind: 'unsubscribe', scope: 'list', reason: 'link', now },
    to: 'unsubscribed',
    effects: ['withdraw_consent_list', 'revoke_pending_messages', 'emit_unsubscribed'],
  },
  {
    label: 'confirmed + globální unsubscribe',
    from: 'confirmed',
    event: { kind: 'unsubscribe', scope: 'global', reason: 'one_click', now },
    to: 'unsubscribed',
    effects: [
      'withdraw_consent_global',
      'unsubscribe_all_lists',
      'add_suppression',
      'set_contact_unsubscribed',
      'revoke_pending_messages',
      'emit_unsubscribed',
    ],
  },
  {
    label: 'confirmed + hard bounce',
    from: 'confirmed',
    event: { kind: 'hard_bounce', now },
    to: 'bounced',
    effects: ['add_suppression', 'set_contact_bounced'],
  },
  {
    label: 'confirmed + complaint',
    from: 'confirmed',
    event: { kind: 'complaint', now },
    to: 'complained',
    effects: [
      'add_suppression',
      'complain_all_lists',
      'set_contact_complained',
      'withdraw_consent_global',
      'revoke_pending_messages',
    ],
  },
  {
    label: 'unsubscribed + subscribe single se vrací přes pending',
    from: 'unsubscribed',
    event: { kind: 'subscribe', optIn: 'single', source: 'import', now },
    to: 'pending',
    effects: ['issue_token', 'send_confirmation'],
  },
  {
    label: 'unsubscribed + subscribe double',
    from: 'unsubscribed',
    event: { kind: 'subscribe', optIn: 'double', source: 'form', now },
    to: 'pending',
    effects: ['issue_token', 'send_confirmation'],
  },
  {
    label: 'unsubscribed + confirm',
    from: 'unsubscribed',
    event: { kind: 'confirm', token: 'valid', now },
    to: 'confirmed',
    effects: [
      'consume_token',
      'remove_unsubscribe_suppression',
      'grant_consent',
      'send_welcome',
      'activate_contact',
      'emit_subscribed',
    ],
  },
  {
    label: 'bounced + subscribe s odebranou suppression',
    from: 'bounced',
    event: {
      kind: 'subscribe',
      optIn: 'double',
      source: 'form',
      now,
      suppression: {
        reason: 'hard_bounce',
        removedAt: new Date('2026-07-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    },
    to: 'pending',
    effects: ['issue_token', 'send_confirmation'],
  },
  {
    label: 'bounced + subscribe se suppression starší 30 dní',
    from: 'bounced',
    event: {
      kind: 'subscribe',
      optIn: 'double',
      source: 'form',
      now,
      suppression: {
        reason: 'hard_bounce',
        removedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    },
    to: 'pending',
    effects: ['issue_token', 'send_confirmation'],
  },
];

describe('tabulka přechodů 4.8.1, řádek po řádku', () => {
  it.each(TABLE)('$label', ({ from, event, to, effects }) => {
    const result = transition(from, event);
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.next).toBe(to);
    expect(result.effects).toEqual(effects);
  });
});

describe('zakázané přechody', () => {
  it('complained + subscribe je odmítnuto kódem subscribe_blocked_complaint', () => {
    const result = transition('complained', {
      kind: 'subscribe',
      optIn: 'double',
      source: 'form',
      now,
    });
    expect(result).toEqual({ allowed: false, code: 'subscribe_blocked_complaint' });
  });

  it('bounced + subscribe se suppression mladší 30 dní je odmítnuto', () => {
    const result = transition('bounced', {
      kind: 'subscribe',
      optIn: 'double',
      source: 'form',
      now,
      suppression: {
        reason: 'hard_bounce',
        removedAt: null,
        createdAt: new Date('2026-07-20T00:00:00Z'),
      },
    });
    expect(result).toEqual({ allowed: false, code: 'subscribe_blocked_suppressed' });
  });

  it('confirmed se nikdy nedegraduje na pending, ani opakovaným subscribe', () => {
    for (const optIn of ['single', 'double'] as const) {
      const result = transition('confirmed', { kind: 'subscribe', optIn, source: 'form', now });
      expect(result.allowed).toBe(true);
      if (!result.allowed) continue;
      expect(result.next).toBe('confirmed');
      // Nic se neposílá: kdo je potvrzený, dostane jen to, o co požádal (rozhodnutí zadavatele).
      expect(result.effects).toEqual([]);
    }
  });

  it('complained + confirm bez zásahu správce je odmítnuto', () => {
    expect(transition('complained', { kind: 'confirm', token: 'valid', now })).toEqual({
      allowed: false,
      code: 'subscribe_blocked_complaint',
    });
  });

  it('complained + ruční potvrzení správcem projde a nese příznak auditu', () => {
    const result = transition('complained', { kind: 'admin_force_confirm', now });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.next).toBe('confirmed');
    expect(result.effects).toContain('audit_forced_confirm');
  });

  it('import na double opt-in seznam bez prohlášení nesmí skončit v confirmed', () => {
    const result = transition('none', {
      kind: 'subscribe',
      optIn: 'double',
      source: 'import',
      skipConfirmation: true,
      declaration: false,
      now,
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.next).toBe('pending');
  });

  it('import s doloženým prohlášením smí skončit v confirmed', () => {
    const result = transition('none', {
      kind: 'subscribe',
      optIn: 'double',
      source: 'import',
      skipConfirmation: true,
      declaration: true,
      now,
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.next).toBe('confirmed');
  });

  /**
   * Zkratka se zavírá i tehdy, když řádek v seznamu ještě neexistuje. Globální odhlášení
   * se do stavu KONKRÉTNÍHO seznamu nepromítne, takže bez kontroly suppression by API
   * s prohlášením vyrobilo potvrzené přihlášení a udělený souhlas člověku, který se
   * odhlásil ze všeho. Prohlášení je tvrzení volajícího, ne projev vůle příjemce.
   */
  it('prohlášení neotevře zkratku adrese na živém suppression listu', () => {
    const result = transition('none', {
      kind: 'subscribe',
      optIn: 'double',
      source: 'api',
      skipConfirmation: true,
      declaration: true,
      suppression: { reason: 'global_unsubscribe', createdAt: now, removedAt: null },
      now,
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.next).toBe('pending');
    expect(result.effects).toContain('send_confirmation');
    expect(result.effects).not.toContain('grant_consent');
  });

  it('odebraná blokace zkratku zase otevírá', () => {
    const result = transition('none', {
      kind: 'subscribe',
      optIn: 'double',
      source: 'api',
      skipConfirmation: true,
      declaration: true,
      suppression: { reason: 'manual', createdAt: now, removedAt: now },
      now,
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.next).toBe('confirmed');
  });
});

describe('úplnost automatu', () => {
  it('žádná kombinace stavu a události nespadne nezachyceně', () => {
    const events: SubscriptionEvent[] = [
      { kind: 'subscribe', optIn: 'single', source: 'api', now },
      { kind: 'subscribe', optIn: 'double', source: 'api', now },
      { kind: 'confirm', token: 'valid', now },
      { kind: 'confirm', token: 'expired', now },
      { kind: 'confirm', token: 'consumed', now },
      { kind: 'unsubscribe', scope: 'list', reason: 'api', now },
      { kind: 'unsubscribe', scope: 'global', reason: 'api', now },
      { kind: 'hard_bounce', now },
      { kind: 'complaint', now },
      { kind: 'cleanup', now },
      { kind: 'admin_force_confirm', now },
    ];
    for (const state of [...SUBSCRIPTION_STATES, 'none' as const]) {
      for (const event of events) {
        expect(() => transition(state, event), `${state} + ${event.kind}`).not.toThrow();
      }
    }
  });
});
