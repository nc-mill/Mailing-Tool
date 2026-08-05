/**
 * Kdy se nabízí ruční povýšení na potvrzený a kdy k němu patří potvrzovací okno.
 *
 * Je to VLASTNÍ SOUBOR, ne dvě funkce uvnitř komponenty, protože totéž rozhodnutí dělá
 * tlačítko na detailu, tlačítko v řádku seznamu i hromadná akce. Kdyby si ho každé
 * napsalo samo, rozešly by se po první změně a jedna obrazovka by nabízela akci, kterou
 * druhá schovává.
 */

/**
 * Stavy, u kterých se akce NENABÍZÍ, a proč zrovna tyhle tři:
 *
 *  - `active` je kontakt, který už potvrzený je. Tlačítko „označit jako potvrzený"
 *    u potvrzeného kontaktu nemá co dělat.
 *  - `deleted` není nepotvrzený kontakt, ale SMAZANÝ kontakt. Cesta zpátky je obnova
 *    (`POST /contacts/{id}/restore`), po které skončí ve stavu `unconfirmed` a akce se
 *    nabídne. Server by na smazaný kontakt odpověděl 404, takže tlačítko by tu bylo jen
 *    proto, aby selhalo.
 *  - `unsubscribed` je tu od chvíle, kdy na to upozornil zadavatel, a je to argument
 *    o VÝZNAMU, ne o oprávnění: **kdo se odhlásil, byl nutně potvrzený.** Jinak by mu
 *    nemohlo nic dojít a neměl by se jak odhlásit. „Označit jako potvrzený" u něj tedy
 *    netvrdí nic nového a slovem „potvrzený" zakrývá, co se doopravdy děje, tedy
 *    přepsání rozhodnutí příjemce.
 *
 * Zůstává `unconfirmed` (nikdy nepotvrzený), `bounced` (tvrzení poštovního serveru,
 * ne projev vůle člověka) a `complained`.
 *
 * PROČ `complained` ZŮSTÁVÁ, ačkoli tentýž argument o významu platí i na něj: odhlášený
 * kontakt má poctivější cestu zpátky, totiž „přihlásit zpět" (`resubscribe`, viz
 * `contact-state.ts`). U stížnosti na spam žádná taková akce není, takže vyřadit ji
 * odsud by neznamenalo nabídnout lepší tlačítko, ale nenabídnout žádné. Tím by se
 * vrátil slepý konec, kvůli kterému hláška „tenhle kontakt povýšit nejde" původně padla.
 * Až `complained` dostane vlastní cestu zpět, patří sem taky.
 *
 * DŘÍVE TO BYLO JINAK a stojí za to vědět proč, ať se to nevrátí: zadavatel si původně
 * stěžoval právě na tu mrtvou hlášku a chtěl akci „prostě kdykoli". Tenhle výčet
 * požadavek NERUŠÍ: hláška je pryč a u nepotvrzeného, odraženého i stěžujícího si
 * kontaktu je akce dostupná. Odhlášenému se jen místo povýšení nabízí přihlášení zpět.
 * Nabízet obojí by znamenalo dvě tlačítka pro tutéž věc, z nichž jedno lže.
 */
const NOT_OFFERED: readonly string[] = ['active', 'deleted', 'unsubscribed'];

/** Stavy, které jsou projev vůle příjemce, takže se přepisují přes jedno okno. */
const NEEDS_DIALOG: readonly string[] = ['complained'];

export function offersManualConfirm(status: string): boolean {
  return !NOT_OFFERED.includes(status);
}

/**
 * Odhlášení a stížnost na spam jsou rozhodnutí, které za sebe udělal sám příjemce.
 * Přepsat ho jde, ale ne omylem: jedno okno řekne, co se stane, a tím to končí.
 *
 * Odraz (`bounced`) okno nemá schválně. Není to projev vůle člověka, ale tvrzení jeho
 * poštovního serveru, takže se povyšuje jedním kliknutím. Že adresa zůstává zablokovaná,
 * se uživatel dozví z oznámení po akci, ne z okna před ní.
 */
export function needsConfirmDialog(status: string): boolean {
  return NEEDS_DIALOG.includes(status);
}
