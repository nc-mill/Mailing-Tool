/**
 * Role sloupce na úzkém displeji, kde se řádek kreslí jako KARTA.
 *
 * - `primary` je údaj, podle kterého člověk řádek pozná. Stojí na prvním
 *   řádku karty tučně a nikdy se neskrývá.
 * - `secondary` je doplňkový údaj. Na kartě má vlastní řádek a před hodnotou
 *   stojí název sloupce, protože bez hlavičky tabulky by nebylo poznat, co je co.
 * - `actions` je nabídka řádku. Zůstává na prvním řádku vpravo vedle hlavního
 *   údaje, protože je to jediná cesta k akcím a nesmí se schovat.
 * - `hidden` se na kartě nekreslí. Na 390 px se do karty nevejde deset údajů
 *   a nacpat je tam znamená, že se nepřečte ani jeden.
 */
export type DataTableMobileRole = 'primary' | 'secondary' | 'actions' | 'hidden';

/** Kolik doplňkových údajů karta unese, než se z ní stane nečitelný odstavec. */
const SECONDARY_LIMIT = 3;

/** `id` sloupce s nabídkou řádku. Obě podoby jsou v repozitáři zavedené. */
const ACTION_IDS = ['actions', 'action'];

/**
 * Rozdělení sloupců do rolí pro kartu.
 *
 * ROZHODUJE SE TO NA JEDNOM MÍSTĚ a pro všechny tabulky, protože jinak by to
 * musela vyřešit každá ze sedmi obrazovek zvlášť a jedna by se spletla.
 * Obrazovka smí rozhodnutí přebít vlastní hodnotou `mobile` u sloupce; tenhle
 * výpočet je výchozí stav, ne závazný.
 *
 * VÝCHOZÍ PRAVIDLO: první sloupec je hlavní údaj (tak jsou tabulky v projektu
 * bez výjimky psané, první je e-mail nebo název), sloupec s nabídkou se pozná
 * podle `id` a další nejvýše tři jsou doplňkové. Zbytek se na kartě nekreslí.
 *
 * `columns` je pořadí VIDITELNÝCH sloupců, tedy až po uživatelském nastavení
 * viditelnosti. Sloupec, který si uživatel schoval, se na kartě neobjeví ani
 * jako hlavní údaj.
 */
export function mobileRoles(
  columns: { id: string; mobile?: DataTableMobileRole | undefined }[],
): Record<string, DataTableMobileRole> {
  const roles: Record<string, DataTableMobileRole> = {};

  // Napřed to, co si obrazovka určila sama. Musí to být PŘED výpočtem, jinak by
  // se počet doplňkových údajů spočítal z jiných sloupců, než jaké nakonec budou.
  const undecided: string[] = [];
  for (const column of columns) {
    if (column.mobile === undefined) undecided.push(column.id);
    else roles[column.id] = column.mobile;
  }

  const hasPrimary = Object.values(roles).includes('primary');
  let secondaries = Object.values(roles).filter((role) => role === 'secondary').length;
  let primaryTaken = hasPrimary;

  for (const id of undecided) {
    if (ACTION_IDS.includes(id)) {
      roles[id] = 'actions';
      continue;
    }
    if (!primaryTaken) {
      roles[id] = 'primary';
      primaryTaken = true;
      continue;
    }
    if (secondaries < SECONDARY_LIMIT) {
      roles[id] = 'secondary';
      secondaries += 1;
      continue;
    }
    roles[id] = 'hidden';
  }

  return roles;
}
