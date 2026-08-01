import type { FilterSlot } from '../normalize/slots';
import { RAW_SLOT_PREFIX, type RawSlotSink } from '../normalize/slots';

/**
 * Jeden lineární průchod, ne cyklus přes sloty s replaceAll: při dvaceti slotech
 * by to znamenalo dvacet průchodů stokilobajtovým dokumentem.
 */
export function applyRawSlots(input: string, sink: RawSlotSink): string {
  if (sink.size === 0) return input;
  const table = new Map(sink.entries());
  const pattern = new RegExp(`${RAW_SLOT_PREFIX}${sink.nonce}_(\\d{4})`, 'g');
  return input.replace(pattern, (marker) => table.get(marker) ?? marker);
}

export type FilterSlotApplication = {
  output: string;
  used: Set<number>;
  unknown: number[];
};

/**
 * Dosadí argumenty filtrů. Až tady, po renderu Reactem, protože uvozovka vložená
 * dřív by se změnila na &quot; a Liquid by přestal být platný (3.3.5).
 */
export function applyFilterSlots(input: string, slots: FilterSlot[]): FilterSlotApplication {
  const table = new Map(slots.map((slot) => [slot.slot, slot]));
  const used = new Set<number>();
  const unknown: number[] = [];
  const output = input.replace(/ML_ARG_(\d{4})/g, (marker, digits: string) => {
    const number = Number(digits);
    const slot = table.get(number);
    if (!slot) {
      unknown.push(number);
      return marker;
    }
    used.add(number);
    return `"${slot.value}"`;
  });
  return { output, used, unknown };
}
