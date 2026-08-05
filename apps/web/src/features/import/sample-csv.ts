/**
 * Vzorový soubor ke stažení.
 *
 * Nejlevnější odpověď na otázku „jak má to CSV vypadat?" je soubor, který si
 * člověk stáhne, přepíše v něm ukázkové řádky a nahraje zpátky. Proto je vzor
 * ke stažení hned v prvním kroku, vedle nápovědy.
 *
 * NÁZVY SLOUPCŮ NEJSOU NÁHODNÉ. Každý z nich je ve slovníku hlaviček
 * (`packages/core/src/contacts/import/mapping.ts`), takže se u staženého vzoru
 * mapování nastaví samo a krok Mapování projde beze změny. Konkrétně:
 * „Titul", ne „Titul před jménem": delší tvar ve slovníku není a nepoznal by se.
 * Hodnoty ve sloupci Pohlaví („muž", „žena") čte `parseGender()` z row-pipeline.
 */

export type SampleCsv = { filename: string; content: string };

const CS: SampleCsv = {
  filename: 'vzor-kontakty.csv',
  content: [
    'E-mail,Jméno,Příjmení,Titul,Pohlaví,Jazyk',
    'jana.novakova@example.cz,Jana,Nováková,Ing.,žena,cs',
    'petr.svoboda@example.cz,Petr,Svoboda,,muž,cs',
    'eva.kralova@example.cz,Eva,Králová,,žena,cs',
    '',
  ].join('\n'),
};

const EN: SampleCsv = {
  filename: 'contacts-sample.csv',
  content: [
    'Email,First name,Last name,Title,Gender,Language',
    'jane.doe@example.com,Jane,Doe,,female,en',
    'john.smith@example.com,John,Smith,,male,en',
    'mary.brown@example.com,Mary,Brown,,female,en',
    '',
  ].join('\n'),
};

export function sampleCsv(locale: string): SampleCsv {
  return locale.startsWith('en') ? EN : CS;
}

/**
 * Odkaz ke stažení jako `data:` URL, ne jako soubor v `public/`.
 *
 * Důvod je jazyk: vzor má mít názvy sloupců v jazyce rozhraní, aby se
 * po nahrání zpátky rozpoznaly samy, a dva statické soubory by se rozešly
 * s katalogem hned, jak do slovníku hlaviček přibude další tvar.
 *
 * BOM na začátku je povinný. Bez něj otevře český Excel CSV v UTF-8 jako
 * Windows-1250 a ze „Nováková" udělá „NovÃ¡kovÃ¡" hned v prvním kroku,
 * tedy přesně tu vadu, na kterou se ptá krok Kontrola souboru.
 */
export function sampleCsvHref(sample: SampleCsv): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${sample.content}`)}`;
}
