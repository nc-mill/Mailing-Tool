import { describe, expect, it } from 'vitest';
import { RawSlotSink } from '../../src/normalize/slots';
import { applyFilterSlots, applyRawSlots } from '../../src/compile/apply-slots';

describe('applyRawSlots', () => {
  it('replaces every marker with its raw html', () => {
    const sink = new RawSlotSink('ab12cd34ef');
    const a = sink.add('<!--[if mso]><table><![endif]-->');
    const b = sink.add('<!--ML_OPEN_PIXEL-->');
    expect(applyRawSlots(`x${a}y${b}z`, sink)).toBe(
      'x<!--[if mso]><table><![endif]-->y<!--ML_OPEN_PIXEL-->z',
    );
  });

  it('replaces a marker used twice', () => {
    const sink = new RawSlotSink('ab12cd34ef');
    const marker = sink.add('<br>');
    expect(applyRawSlots(`${marker}|${marker}`, sink)).toBe('<br>|<br>');
  });

  it('leaves text alone when there is nothing to replace', () => {
    expect(applyRawSlots('plain', new RawSlotSink('ab12cd34ef'))).toBe('plain');
  });
});

describe('applyFilterSlots', () => {
  const slots = [
    { slot: 1, blockId: 'b_1', filter: 'default' as const, value: 'kolego' },
    { slot: 2, blockId: 'b_2', filter: 'default' as const, value: 'zákazníku' },
    { slot: 3, blockId: 'b_3', filter: 'date' as const, value: '%d.%m.%Y' },
  ];

  it('inserts the value in quotes at every occurrence', () => {
    const result = applyFilterSlots(
      '{{ a | default:ML_ARG_0001 }} {{ b | default:ML_ARG_0002 }}',
      slots,
    );
    expect(result.output).toBe('{{ a | default:"kolego" }} {{ b | default:"zákazníku" }}');
    expect(result.used).toEqual(new Set([1, 2]));
  });

  it('resolves the same slot at two places with the same value', () => {
    const result = applyFilterSlots('ML_ARG_0001 and ML_ARG_0001', slots);
    expect(result.output).toBe('"kolego" and "kolego"');
  });

  it('reports an unknown slot number instead of silently dropping it', () => {
    const result = applyFilterSlots('ML_ARG_0099', slots);
    expect(result.unknown).toEqual([99]);
  });

  it('leaves no marker behind', () => {
    expect(applyFilterSlots('ML_ARG_0003', slots).output).toBe('"%d.%m.%Y"');
  });
});
