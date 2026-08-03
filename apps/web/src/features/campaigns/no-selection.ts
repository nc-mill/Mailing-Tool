/**
 * Volba „nevybráno" v rozbalovacím seznamu nastavení kampaně.
 *
 * Radix `Select` nepřipouští položku s prázdnou hodnotou, takže prázdno musí
 * nést zástupná hodnota. Kdyby se posílala doslova, uložilo by se
 * `template_id: "__none__"` a API by vrátilo 422 o neplatném UUID.
 *
 * Konstanta bydlí ve vlastním souboru schválně: modul se směrnicí `'use server'`
 * smí exportovat jedině asynchronní funkce, takže v `actions.ts` být nemůže.
 */
export const NO_SELECTION = '__none__';
