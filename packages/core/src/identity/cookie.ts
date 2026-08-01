/**
 * Jméno relační cookie. Jediná definice v celém repozitáři.
 *
 * PROČ SAMOSTATNÝ SOUBOR BEZ JEDINÉHO IMPORTU:
 * jméno potřebuje jak `session.ts` (nastavuje cookie), tak `apps/web/src/proxy.ts`
 * (kontroluje její přítomnost). `session.ts` ale importuje drizzle, schéma
 * databáze a konfiguraci, takže by se jeho importem do proxy vtáhla do bundlu
 * celá datová vrstva. Tuhle chybu už projekt jednou zaplatil u migračního
 * runneru, který se přes vstupní bod `@mlain/db` dostal do bundlu webu
 * a shodil celé `/api/v1/**`.
 *
 * PROČ TENHLE SOUBOR VŮBEC VZNIKL:
 * jméno bylo napsané natvrdo na dvou místech a rozešlo se. Identita nastavovala
 * `ml_session`, proxy hledala `mlain_session`. Přihlášení proto proběhlo,
 * cookie se do prohlížeče správně propsala, a proxy ji přesto neviděla,
 * takže každé další kliknutí vyhodilo uživatele zpátky na přihlašovací stránku.
 * Nespadlo přitom nic: ani jedna strana nemohla poznat, že se ptá na něco jiného,
 * než co ta druhá zapisuje.
 */
export const SESSION_COOKIE_NAME = 'ml_session';
