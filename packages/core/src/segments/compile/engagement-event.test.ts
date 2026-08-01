import { describe, expect, it } from 'vitest';
import { ParamBag } from './params';
import { compileEngagementCondition, compileEventCondition } from './engagement-event';

function bag(): ParamBag {
  const b = new ParamBag(0);
  b.add('ws');
  b.add(new Date());
  b.add('Europe/Prague');
  return b;
}

const CAMPAIGN = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60aa';

describe('engagement and event', () => {
  it('uses the rollup for opened with since_days 90 and adds no warning', () => {
    const out = compileEngagementCondition(
      'a',
      { metric: 'opened', scope: { since_days: 90 } },
      'did',
      {},
      bag(),
    );
    expect(out.sql).toContain('contact_engagement');
    expect(out.sql).toContain('ce.last_open_at >= $2::timestamptz - make_interval(days => $4)');
    expect(out.warnings).toEqual([]);
  });

  it('scopes every contact_engagement subquery by workspace_id, not only by contact_id', () => {
    const out = compileEngagementCondition(
      'a',
      { metric: 'opened', scope: { since_days: 30 } },
      'did',
      {},
      bag(),
    );
    expect(out.sql).toContain('ce.workspace_id = a.workspace_id');
  });

  it('falls back to message_events for an arbitrary window and warns', () => {
    const out = compileEngagementCondition(
      'a',
      { metric: 'opened', scope: { since_days: 45 } },
      'did',
      {},
      bag(),
    );
    expect(out.sql).toContain('message_events');
    expect(out.warnings).toEqual(['segment_slow_engagement']);
  });

  it('uses the rollup column names from the schema, never the invented ones', () => {
    const out = compileEngagementCondition(
      'a',
      { metric: 'opened', scope: {} },
      'count_gte',
      { value: 3 },
      bag(),
    );
    expect(out.sql).toContain('ce.opens_total');
    expect(out.sql).not.toContain('opened_count');
  });

  it('reads a precomputed window instead of scanning when since_days is 7, 30 or 90', () => {
    const out = compileEngagementCondition(
      'a',
      { metric: 'clicked', scope: { since_days: 30 } },
      'count_gte',
      { value: 2 },
      bag(),
    );
    expect(out.sql).toContain('ce.clicks30d');
    expect(out.warnings).toEqual([]);
  });

  it('has no precomputed window for delivered and bounced, so those take the slow branch', () => {
    for (const metric of ['delivered', 'bounced'] as const) {
      const out = compileEngagementCondition(
        'a',
        { metric, scope: { since_days: 30 } },
        'count_gte',
        { value: 1 },
        bag(),
      );
      expect(out.sql, metric).toContain('message_events');
      expect(out.warnings, metric).toEqual(['segment_slow_engagement']);
    }
  });

  it('counts sent from messages, not from message_events, once the scope forces the slow branch', () => {
    const out = compileEngagementCondition(
      'a',
      { metric: 'sent', scope: { campaign_id: CAMPAIGN } },
      'count_gte',
      { value: 3 },
      bag(),
    );
    expect(out.sql).toContain('FROM messages m');
    expect(out.sql).not.toContain('message_events');
  });

  it('bounds every partitioned table by its OWN partition key', () => {
    // messages podle created_at
    const sent = compileEngagementCondition(
      'a',
      { metric: 'sent', scope: { since_days: 45 } },
      'did',
      {},
      bag(),
    );
    expect(sent.sql).toContain('m.created_at >=');
    // message_events podle received_at, ne podle ts: ts je čas od providera
    const opened = compileEngagementCondition(
      'a',
      { metric: 'opened', scope: { since_days: 45 } },
      'did',
      {},
      bag(),
    );
    expect(opened.sql).toContain('me.received_at >=');
    expect(opened.sql).toContain('me.received_at <=');
    expect(opened.sql).toContain('me.ts >=');
    // web_events podle received_at, s horní i dolní mezí i bez zadaného okna
    const event = compileEventCondition('a', { name: 'purchase' }, 'did', {}, bag());
    expect(event.sql).toContain('we.received_at >=');
    expect(event.sql).toContain('we.received_at <=');
    expect(event.sql).toContain('web_event_months');
  });

  it('treats a soft bounce as a bounce, so preview and rollup cannot disagree', () => {
    const b = bag();
    const out = compileEngagementCondition(
      'a',
      { metric: 'bounced', scope: { since_days: 45 } },
      'did',
      {},
      b,
    );
    expect(out.sql).toContain('me.type = ANY(');
    expect(b.values).toContainEqual(['bounced_hard', 'bounced_soft']);
  });

  it('selects recent campaigns by status and finished_at, because campaigns.sent_at does not exist', () => {
    const b = bag();
    const out = compileEngagementCondition(
      'a',
      { metric: 'opened', scope: { last_n_campaigns: 5 } },
      'did',
      {},
      b,
    );
    expect(out.sql).not.toContain('sent_at');
    expect(out.sql).toContain('finished_at IS NOT NULL ORDER BY finished_at DESC');
    expect(b.values).toContainEqual(['sent', 'partially_sent']);
  });

  it('did_not is the negation of did, never a separate query shape', () => {
    const did = compileEngagementCondition(
      'a',
      { metric: 'opened', scope: { since_days: 30 } },
      'did',
      {},
      bag(),
    );
    const not = compileEngagementCondition(
      'a',
      { metric: 'opened', scope: { since_days: 30 } },
      'did_not',
      {},
      bag(),
    );
    expect(not.sql).toBe(`(NOT ${did.sql})`);
  });

  it('compiles an event condition against web_events with a parameterised name', () => {
    const b = bag();
    const out = compileEventCondition('a', { name: 'purchase' }, 'did', {}, b);
    expect(out.sql).toContain('web_events');
    expect(out.sql).not.toContain("'purchase'");
    expect(b.values).toContain('purchase');
  });

  it('never emits now() anywhere', () => {
    for (const days of [7, 30, 90, 45]) {
      const out = compileEngagementCondition(
        'a',
        { metric: 'clicked', scope: { since_days: days } },
        'did',
        {},
        bag(),
      );
      expect(out.sql.toLowerCase()).not.toMatch(
        /now\(|current_timestamp|localtimestamp|current_date/,
      );
    }
    const event = compileEventCondition('a', { name: 'purchase' }, 'did', {}, bag());
    expect(event.sql.toLowerCase()).not.toMatch(
      /now\(|current_timestamp|localtimestamp|current_date/,
    );
  });
});
