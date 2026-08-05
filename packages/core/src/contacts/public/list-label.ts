/**
 * Jméno seznamu tak, jak ho smí vidět PŘÍJEMCE.
 *
 * PROČ TO NENÍ JEDNO POLE. `lists.name` je pracovní poznámka správce („Novinky od
 * 4. srpna 2026", „VIP", „Zákazníci"). Příjemci to nic neříká a někdy je to rovnou
 * interní informace. Veřejné texty proto mají vlastní sloupce `public_name`
 * a `public_description` (migrace 0014) a tahle funkce je jediné místo, které
 * rozhoduje, co se ukáže.
 *
 * KDYŽ VEŘEJNÝ NÁZEV CHYBÍ, ukáže se `name`. Je to vědomá volba mezi dvěma
 * nedokonalostmi: prázdné zaškrtávátko nebo bezejmenná věta „odhlásili jste se
 * z odběru" jsou pro příjemce horší než pracovní název, protože z nich nepozná,
 * čeho se rozhodnutí týká. Správci, kterému na interním jménu záleží, nabízí
 * nastavení seznamu veřejný název k vyplnění a upozorní ho, že se jinak ukáže
 * ten pracovní.
 */
export function publicListLabel(row: { name: string; publicName?: string | null }): string {
  const custom = row.publicName?.trim() ?? '';
  return custom === '' ? row.name : custom;
}
