import { randomBytes } from 'node:crypto';
import type { Document, VarInline } from '../document/types';
import { richTextFieldsOf, walkBlocks, walkRichText } from '../document/walk';

export type FilterSlot = {
  slot: number;
  blockId: string;
  filter: 'default' | 'date';
  value: string;
};

/** Kontraktní tvar z 3.3.5a. Jen znaky, které žádný React renderer neescapuje. */
export function filterSlotMarker(slot: number): string {
  return `ML_ARG_${String(slot).padStart(4, '0')}`;
}

/**
 * Přidělí sloty uzlům `var`, které nesou argument filtru, v pořadí prvního výskytu
 * v dokumentu. Mutuje předaný dokument, proto se volá výhradně nad klonem
 * uvnitř normalizeDocument.
 */
export function assignFilterSlots(doc: Document): FilterSlot[] {
  const slots: FilterSlot[] = [];
  for (const { block, pointer } of walkBlocks(doc)) {
    for (const field of richTextFieldsOf(block)) {
      for (const { node } of walkRichText(field.rich, `${pointer}/props/${field.key}`)) {
        if (node.t !== 'var') continue;
        const target: VarInline = node;
        const assigned: { default?: number; date?: number } = {};
        if (target.fallback !== undefined) {
          slots.push({
            slot: slots.length + 1,
            blockId: block.id,
            filter: 'default',
            value: target.fallback,
          });
          assigned.default = slots.length;
        }
        if (target.dateFormat !== undefined) {
          slots.push({
            slot: slots.length + 1,
            blockId: block.id,
            filter: 'date',
            value: target.dateFormat,
          });
          assigned.date = slots.length;
        }
        if (assigned.default !== undefined || assigned.date !== undefined) {
          target.slots = assigned;
        }
      }
    }
  }
  return slots;
}

export const RAW_SLOT_PREFIX = 'ML_RAW_';

/**
 * Sběrač syrového HTML (podmíněné komentáře pro Outlook, VML, značka pixelu,
 * sanitizovaný obsah bloku html, obsah <style>). React z JSX HTML komentář
 * ani syrový markup vypustit neumí, takže se do stromu dá textový žeton
 * a kompilace ho po renderu nahradí.
 *
 * Nonce je náhodná na každý render: uživatelský text tak nemůže cizí slot
 * odklonit ani tehdy, když by validátor pravidlo S16 propásl. Determinismus
 * výstupu to neruší, protože se žeton do výstupu nikdy nedostane a hlídá to invariant I12.
 */
export class RawSlotSink {
  readonly nonce: string;
  private readonly values: string[] = [];

  constructor(nonce?: string) {
    this.nonce = nonce ?? randomBytes(8).toString('hex').slice(0, 10);
  }

  add(html: string): string {
    this.values.push(html);
    return `${RAW_SLOT_PREFIX}${this.nonce}_${String(this.values.length).padStart(4, '0')}`;
  }

  entries(): Array<[string, string]> {
    return this.values.map((html, index) => [
      `${RAW_SLOT_PREFIX}${this.nonce}_${String(index + 1).padStart(4, '0')}`,
      html,
    ]);
  }

  get size(): number {
    return this.values.length;
  }
}
