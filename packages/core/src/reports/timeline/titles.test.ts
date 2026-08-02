import { describe, expect, it } from 'vitest';
import { composeTitle, titleKey } from './titles';
import type { TimelineRow } from './types';

const translate = (key: string, values: Record<string, unknown>) =>
  `${key}|${JSON.stringify(values)}`;

function row(type: string, slots: Record<string, string | number> = {}): TimelineRow {
  return { id: 'x', occurredAt: new Date(), source: 'email', type, slots };
}

describe('titleKey', () => {
  it('mapuje známé typy na klíče katalogu', () => {
    expect(titleKey('message_opened')).toBe('timeline.item.messageOpened');
    expect(titleKey('page_view')).toBe('timeline.item.pageView');
  });

  it('neznámý typ dostane obecný klíč, ne výjimku', () => {
    expect(titleKey('automation_entered')).toBe('timeline.item.generic');
  });
});

describe('composeTitle', () => {
  it('předá rod jako slot, aby se věta složila v katalogu, ne v kódu', () => {
    const title = composeTitle(
      translate,
      row('message_opened', { campaign: 'Letní výprodej' }),
      'female',
    );
    expect(title).toContain('timeline.item.messageOpened');
    expect(title).toContain('"gender":"female"');
    expect(title).toContain('"campaign":"Letní výprodej"');
  });

  it('u neznámého rodu předá other, ne mužský tvar', () => {
    const title = composeTitle(translate, row('message_opened'), 'unknown');
    expect(title).toContain('"gender":"other"');
  });

  it('u neznámého typu předá jeho název jako slot', () => {
    const title = composeTitle(
      translate,
      row('product_viewed', { name: 'product_viewed' }),
      'male',
    );
    expect(title).toContain('timeline.item.generic');
    expect(title).toContain('"name":"product_viewed"');
  });
});
