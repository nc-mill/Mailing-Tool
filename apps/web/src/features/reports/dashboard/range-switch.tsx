'use client';

import { SegmentedControl } from '@mlain/ui/components/segmented-control';
import type { DashboardPeriod } from './dashboard-slots';

/**
 * Přepínač období na Přehledu.
 *
 * Vzhled i chování drží `SegmentedControl` z `@mlain/ui`. Tenhle soubor
 * zůstává jen jako zúžení na typ `DashboardPeriod`, aby si obrazovky
 * nemohly předat období, které Přehled nezná.
 *
 * OBCHŮZKA OBRYSU FOCUSU JE PRYČ. Stála tu poznámka, že se obrys kreslí
 * v barvě textu, a řešil to prstenec ze `shadow`. Nebyla to vada základu,
 * ale MĚŘENÍ V NULE: `transition-colors` zahrnuje i `outline-color`, takže
 * se obrys do správné barvy 120 ms přebarvoval z předchozí hodnoty, a tou
 * je `currentColor`. Naměřeno 0 ms `#F5EFDF`, 60 ms `#4E4A41`, 150 ms
 * `#26221A`. Základ teď nastavuje výchozí `outline-color` z tokenu, takže
 * přechod nemá odkud kam jít a obrys je správný od prvního snímku.
 */
export function RangeSwitch({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: DashboardPeriod; label: string }>;
  value: DashboardPeriod;
  onChange: (value: DashboardPeriod) => void;
}) {
  return (
    <SegmentedControl<DashboardPeriod>
      label={label}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}
