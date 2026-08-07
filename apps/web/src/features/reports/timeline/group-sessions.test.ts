import { describe, expect, it } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
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

  /**
   * BRÁNA PROTI TICHÉMU PROPADNUTÍ DO NEUTRÁLNÍ IKONY.
   *
   * `iconFor` je otevřený výčet, takže typ, na který se zapomene, nespadne:
   * dostane obecnou ikonu a vypadá to jako táž vada, kvůli které se ikony
   * zapojovaly (u všeho totéž). Naměřeno 7. 8. 2026 na TŘECH typech naráz,
   * všech třech prokliků systémových odkazů z patičky.
   *
   * Seznam typů se sem NEOPISUJE. Bere se z katalogu vět `reports.timeline.item`,
   * který vzniká z týchž typů (`TITLE_KEYS` v
   * `packages/core/src/reports/timeline/titles.ts`): každá událost, kterou API
   * umí pojmenovat, tam má klíč. Klíč je camelCase téhož jména, takže se převádí
   * mechanicky; kdyby se ta shoda někdy porušila, spadne tenhle test, a to je
   * správně, protože právě tím se dvě jména pro jednu událost rozejdou.
   */
  it('každý typ události, který API umí pojmenovat, má vlastní ikonu', () => {
    const types = Object.keys(csReports.timeline.item)
      .filter((key) => key !== 'generic')
      .map((key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));

    // Kontrola, že se převod nerozešel: `message_sent` v katalogu být musí.
    expect(types).toContain('message_sent');

    const withoutIcon = types.filter((type) => iconFor(type, 'email') === 'generic');
    expect(withoutIcon, `typy bez vlastní ikony: ${withoutIcon.join(', ')}`).toEqual([]);
  });
});
