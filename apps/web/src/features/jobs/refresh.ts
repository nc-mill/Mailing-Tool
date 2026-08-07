/**
 * ROZHODNUTÍ O PRŮBĚŽNÉM OBNOVOVÁNÍ (oddíl 2.2c, čtvrtá položka).
 *
 * ZNĚNÍ: seznam ani odznak se neobnovují pořád. Obnovují se **jen dokud něco
 * běží**, a i tehdy pomalu. Když neběží nic, netiká žádný časovač a jediné
 * obnovení dělá tlačítko, na které uživatel klikne sám.
 *
 * PROČ NE „každých pár vteřin, ať je to živé":
 *
 *  1. Jedno vykreslení stránky v téhle aplikaci stojí šest volání na vlastní
 *     API (změřeno 7. 8., medián stránky 245 až 282 ms). Obnovování přes
 *     `router.refresh()` by tedy nebylo jedno volání, ale šest, a to každých
 *     pár vteřin na každé otevřené záložce. Proto se obnovuje jen `/api/v1/jobs`
 *     přímo z prohlížeče: jedno volání, které nesahá na zbytek stránky.
 *  2. Úlohy tady trvají MINUTY, ne vteřiny. Import půlmilionového souboru se
 *     mezi dvěma vteřinami nepohne o nic, co by šlo na pruhu poznat. Interval
 *     kratší než postup samotné práce jen vyrábí požadavky.
 *  3. `runningJobCount` na serveru pokaždé slije až 200 úloh ze všech zdrojů,
 *     takže i „levný" dotaz na počet je pro databázi práce. Trvale běžící
 *     dotazování z každé otevřené záložky by ji platilo bez užitku.
 *
 * PROČ TEDY VŮBEC OBNOVOVAT: dokud něco běží, člověk se na pruh dívá a čeká.
 * Ukazatel, který stojí, vypadá jako zaseknutá úloha, a to je přesně ten omyl,
 * kvůli kterému Centrum úloh vzniklo. Jakmile poslední úloha doběhne, časovač
 * se sám zastaví a obrazovka je zase statická.
 *
 * SKRYTÁ ZÁLOŽKA NEOBNOVUJE. Kontrola `document.hidden` je uvnitř tiknutí,
 * takže záložka odložená na pozadí neposílá nic; po návratu na ni se stav
 * dorovná při nejbližším tiknutí.
 */

/** Seznam úloh: uživatel se dívá na pruh, takže častěji. */
export const JOBS_LIST_REFRESH_MS = 10_000;

/** Odznak v hlavičce: jen počet, a ten se nikam nespěchá. */
export const JOBS_BADGE_REFRESH_MS = 30_000;

/** Kolik úloh seznam ukáže na jednu stránku. Strop API je 100. */
export const JOBS_PAGE_LIMIT = 50;

/**
 * STAV WORKERU SE OBNOVUJE JINAK NEŽ SEZNAM, a je to celý důvod, proč je to
 * druhá konstanta a druhá cesta v API.
 *
 * Pravidlo nad tímhle souborem („obnovuj, jen dokud něco běží") je u seznamu
 * správné a u stavu workeru by bylo PŘESNĚ NAOPAK. Zaseknutý worker se pozná
 * v okamžiku, kdy neběží nic: úloha se zařadila, nikdo si ji nevzal, seznam
 * tedy nemá co obnovovat a časovač by stál. Panel by v tu chvíli zamrzl na
 * hodnotě, se kterou se na stránku přišlo, a to je ta jediná chvíle, kdy ho
 * někdo čte.
 *
 * Panel se proto ptá POŘÁD, dokud je záložka vidět. Může si to dovolit,
 * protože jeho dotaz je jiného řádu než seznam: čte 96 řádků `pgboss.queue`
 * a jeden řádek `pgboss.version`, tedy jednotky milisekund, zatímco seznam
 * jde do doménových tabulek každého zdroje zvlášť.
 *
 * Perioda je 30 s, ne 10 s jako u seznamu. Nejpomalejší značka, ze které se
 * stav počítá, je `queue.monitor_on` a tu posouvá pg-boss po minutě; ptát se
 * častěji, než se měřená hodnota mění, znamená pokaždé dostat totéž číslo.
 * Skrytá záložka se neptá, stejně jako u seznamu.
 */
export const WORKER_STATUS_REFRESH_MS = 30_000;
