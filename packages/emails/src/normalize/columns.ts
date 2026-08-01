import type { ColumnsLayout } from '../document/types';

export const COLUMN_RATIOS: Record<ColumnsLayout, number[]> = {
  '1-1': [1, 1],
  '1-2': [1, 2],
  '2-1': [2, 1],
  '1-1-1': [1, 1, 1],
  '2-1-1': [2, 1, 1],
  '1-1-2': [1, 1, 2],
};

/**
 * Pixelové šířky sloupců. `innerWidth` je šířka obsahové oblasti sekce,
 * tedy contentWidth minus vodorovné odsazení sekce.
 * Zaokrouhlovací zbytek dostane poslední sloupec, aby součet seděl na pixel:
 * Outlook s procenty a max-width nepracuje a rozdíl jednoho pixelu mu rozhodí řádek.
 */
export function columnWidths(layout: ColumnsLayout, gap: number, innerWidth: number): number[] {
  const ratios = COLUMN_RATIOS[layout];
  const available = Math.max(ratios.length, innerWidth - gap * (ratios.length - 1));
  const total = ratios.reduce((a, b) => a + b, 0);
  const widths = ratios.map((ratio) => Math.max(1, Math.floor((available * ratio) / total)));
  const used = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] = Math.max(1, widths[widths.length - 1]! + (available - used));
  return widths;
}

export function columnCount(layout: ColumnsLayout): number {
  return COLUMN_RATIOS[layout].length;
}
