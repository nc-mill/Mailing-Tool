/**
 * Co se smí připsat kampani a co ne.
 *
 * Tenhle soubor existuje proto, aby se pravidlo připsání dalo přečíst na jednom
 * místě a nedalo se ho nevědomky obejít v dotazu.
 *
 * CO V DATECH JE. Proklik v e-mailu má v `web_events` řádek `email_clicked`
 * se zdrojem `email`, v `properties` nese `campaign_id`, `link_id`
 * a `click_class`. Zapisuje ho job `tracking.process_engagement`. Návštěva webu
 * má řádek se zdrojem `web` a `contact_id`, které tam doplní buď měřicí značka
 * po propojení identity, nebo dodatečně slučování anonymní historie.
 *
 * CO V DATECH NENÍ. Řádek návštěvy NENESE `campaign_id` a nikdy nést nebude:
 * měřicí značka na cizím webu o kampani nic neví. Vazba „tahle návštěva vznikla
 * z tohohle e-mailu" tedy v tabulce fyzicky neexistuje.
 *
 * PRAVIDLO, KTERÉ POUŽÍVÁME. Návštěva se připíše kampani, když ji udělal
 * člověk, který v té kampani klikl, a stala se do {@link ATTRIBUTION_WINDOW_HOURS}
 * hodin po jeho PRVNÍM prokliku v ní. Obě poloviny jsou naměřené údaje, spojuje
 * je jen čas, a přesně tak se to musí uživateli i napsat.
 *
 * CO SE NEPOČÍTÁ, ačkoliv by to čísla nafouklo:
 *  - návštěvy lidí, kteří v kampani neklikli (příjemce si mohl adresu opsat,
 *    ale doložit se to nedá),
 *  - návštěvy mimo okno (po dvou dnech už je za nimi cokoliv jiného),
 *  - prokliky robotů a skenerů (`click_class <> 'human'`), za těmi na web
 *    nikdo nepřišel,
 *  - anonymní návštěvy, u kterých se identita nikdy nepropojila; ty do
 *    kampaně přiřadit nejde, i kdyby z ní vzešly.
 *
 * ČÍSLA JSOU PROTO SPODNÍ ODHAD. Kdo si zprávu přeposlal, kdo klikl v prohlížeči
 * bez měřicí značky nebo kdo měření odmítl, v součtu chybí. Obrazovka to říká
 * nahlas; tiché dopočítávání by z reportu udělalo dohad.
 */

/**
 * Jak dlouho po prokliku se návštěva ještě považuje za návštěvu z kampaně.
 *
 * Den, ne hodina a ne týden. Kratší okno by zahodilo běžné chování „kliknu
 * ráno v mobilu, koupím večer na počítači"; delší by kampani připisovalo
 * návštěvy, za kterými už stojí něco úplně jiného. Hodnota je součástí
 * vysvětlení na obrazovce, takže se nemění bez změny textu.
 */
export const ATTRIBUTION_WINDOW_HOURS = 24;

/** Kolik položek se vejde do žebříčku stránek a událostí. */
export const TOP_ITEMS_LIMIT = 10;

/** Kolik lidí se vypíše jmenovitě pod souhrnem kampaně. */
export const VISITOR_SAMPLE_LIMIT = 20;
