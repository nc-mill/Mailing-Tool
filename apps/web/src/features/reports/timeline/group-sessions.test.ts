import { describe, expect, it } from 'vitest';
import { groupWebSeries, iconFor } from './group-sessions';

function item(id: string, type: string, at: string, sessionId?: string) {
  return {
    id,
    type,
    source: type.startsWith('message') ? 'email' : 'web',
    occurred_at: at,
    title: id,
    ...(sessionId === undefined ? {} : { session_id: sessionId }),
  };
}

describe('groupWebSeries', () => {
  it('shlukne webové události jedné session do jedné položky s počtem', () => {
    const grouped = groupWebSeries([
      item('a', 'page_view', '2026-07-31T18:20:00.000Z', 's1'),
      item('b', 'page_view', '2026-07-31T18:19:00.000Z', 's1'),
      item('c', 'page_view', '2026-07-31T18:18:00.000Z', 's1'),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.groupCount).toBe(3);
    expect(grouped[0]?.children).toHaveLength(3);
  });

  it('e-mailové položky nikdy neshlukuje, aby ve webu nezmizely', () => {
    const grouped = groupWebSeries([
      item('a', 'page_view', '2026-07-31T18:20:00.000Z', 's1'),
      item('m', 'message_opened', '2026-07-31T18:19:00.000Z'),
      item('b', 'page_view', '2026-07-31T18:18:00.000Z', 's1'),
    ]);
    expect(grouped.map((g) => g.id)).toEqual(['a', 'm', 'b']);
  });

  it('dvě různé session zůstanou dvě položky', () => {
    const grouped = groupWebSeries([
      item('a', 'page_view', '2026-07-31T18:20:00.000Z', 's1'),
      item('b', 'page_view', '2026-07-31T18:19:00.000Z', 's2'),
    ]);
    expect(grouped).toHaveLength(2);
  });

  it('položka bez session se neshlukuje', () => {
    const grouped = groupWebSeries([
      item('a', 'page_view', '2026-07-31T18:20:00.000Z'),
      item('b', 'page_view', '2026-07-31T18:19:00.000Z'),
    ]);
    expect(grouped).toHaveLength(2);
  });
});

describe('iconFor', () => {
  it('neznámý typ dostane obecnou ikonu, ne výjimku', () => {
    expect(iconFor('automation_entered', 'automation')).toBe('generic');
    expect(iconFor('message_clicked', 'email')).toBe('click');
  });
});
