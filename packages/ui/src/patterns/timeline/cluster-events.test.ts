import { describe, expect, it } from 'vitest';
import { clusterEvents } from './cluster-events';
import type { TimelineEvent } from './types';

function event(id: string, type: string, minutesAgo: number): TimelineEvent {
  return {
    id,
    type,
    occurredAt: new Date(`2026-07-31T18:${String(59 - minutesAgo).padStart(2, '0')}:00.000Z`),
    payload: {},
  };
}

describe('clusterEvents', () => {
  it('šest zobrazení stránky během čtyř minut je jeden řádek s počtem', () => {
    const events = [0, 1, 2, 3, 3, 4].map((minute, index) =>
      event(`p${index}`, 'page_view', minute),
    );
    const clustered = clusterEvents(events, { windowMs: 5 * 60 * 1000, minSize: 3 });

    expect(clustered).toHaveLength(1);
    expect(clustered[0]?.kind).toBe('cluster');
    const first = clustered[0];
    expect(first?.kind === 'cluster' ? first.events : []).toHaveLength(6);
  });

  it('shlukuje jen události stejného typu', () => {
    const events = [
      event('a', 'page_view', 0),
      event('b', 'page_view', 1),
      event('c', 'email_open', 1),
      event('d', 'page_view', 2),
    ];
    const clustered = clusterEvents(events, { windowMs: 5 * 60 * 1000, minSize: 2 });

    expect(clustered.filter((item) => item.kind === 'cluster')).toHaveLength(1);
    expect(clustered.filter((item) => item.kind === 'single')).toHaveLength(2);
  });

  it('dvě události pod minimální velikostí zůstanou samostatné', () => {
    const events = [event('a', 'page_view', 0), event('b', 'page_view', 1)];
    const clustered = clusterEvents(events, { windowMs: 5 * 60 * 1000, minSize: 3 });
    expect(clustered.every((item) => item.kind === 'single')).toBe(true);
  });

  it('události mimo okno se nespojí', () => {
    const events = [
      event('a', 'page_view', 0),
      event('b', 'page_view', 1),
      event('c', 'page_view', 2),
      event('d', 'page_view', 40),
    ];
    const clustered = clusterEvents(events, { windowMs: 5 * 60 * 1000, minSize: 3 });
    expect(clustered).toHaveLength(2);
    expect(clustered[0]?.kind).toBe('cluster');
    expect(clustered[1]?.kind).toBe('single');
  });

  it('e-mailové události se neshlukují, jinak by v ose zmizely', () => {
    const events = [
      event('a', 'email_open', 0),
      event('b', 'email_open', 1),
      event('c', 'email_open', 2),
    ];
    const clustered = clusterEvents(events, {
      windowMs: 5 * 60 * 1000,
      minSize: 3,
      neverCluster: ['email_open', 'email_click', 'email_delivered'],
    });
    expect(clustered).toHaveLength(3);
  });

  it('shluk si drží čas nejnovější události, aby seděl v pořadí', () => {
    const events = [0, 1, 2].map((minute, index) => event(`p${index}`, 'page_view', minute));
    const [cluster] = clusterEvents(events, { windowMs: 5 * 60 * 1000, minSize: 3 });
    expect(cluster?.occurredAt).toEqual(events[0]?.occurredAt);
  });
});
