export type SubjectExportFile = {
  name: string;
  /** Která doména data dodává. Chybějící dodavatel neznamená pád exportu. */
  owner: 'contacts' | 'campaigns' | 'tracking';
  description: string;
};

/**
 * Deset souborů exportu dat subjektu podle tabulky ve 4.14.2 části 2.
 * JSON i CSV splňují požadavek článku 20 na strukturovaný, běžně používaný
 * a strojově čitelný formát.
 */
export const SUBJECT_EXPORT_FILES: readonly SubjectExportFile[] = [
  {
    name: 'contact.json',
    owner: 'contacts',
    description: 'všechna pole kontaktu včetně vlastních',
  },
  {
    name: 'consents.csv',
    owner: 'contacts',
    description: 'historie souhlasů včetně znění a důkazů',
  },
  { name: 'subscriptions.csv', owner: 'contacts', description: 'seznamy, stavy, data' },
  { name: 'tags.csv', owner: 'contacts', description: 'štítky' },
  { name: 'messages.csv', owner: 'campaigns', description: 'odeslané zprávy' },
  { name: 'message_events.csv', owner: 'tracking', description: 'otevření a kliknutí' },
  { name: 'web_events.ndjson', owner: 'tracking', description: 'chování na webu' },
  { name: 'form_submissions.csv', owner: 'contacts', description: 'odeslané formuláře' },
  { name: 'imports.csv', owner: 'contacts', description: 'ze kterých importů kontakt pochází' },
  { name: 'README.txt', owner: 'contacts', description: 'vysvětlení sloupců česky a anglicky' },
];

/** Znaky, po kterých tabulkový procesor začne buňku vyhodnocovat jako vzorec. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Ochrana proti CSV injection. Buňka, která začíná na některý z rizikových znaků,
 * dostane prefix apostrofu.
 *
 * Bez toho by kontakt se jménem =HYPERLINK("http://zlo.cz","klikni") znamenal spuštění
 * kódu v tabulkovém procesoru toho, kdo export otevře. Platí pro každý CSV výstup
 * produktu, tedy i pro errors.csv a pro export kontaktů.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`;
  }
  if (text.includes('"') || text.includes(';') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** CSV s oddělovačem středníkem a konci řádků CRLF, tedy tvar, který otevře Excel. */
export function toCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): string {
  const lines = [columns.join(';')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvCell(row[column])).join(';'));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Průvodní text archivu. Dvojjazyčně, protože ho čte subjekt údajů, ne správce. */
export function buildReadme(): string {
  return [
    'Kopie údajů, které o vás vedeme',
    '',
    'Tento archiv obsahuje deset souborů. Formát CSV otevřete v tabulkovém procesoru,',
    'formát JSON a NDJSON v textovém editoru.',
    '',
    ...SUBJECT_EXPORT_FILES.map((file) => `${file.name}: ${file.description}`),
    '',
    'Odkaz ke stažení platí sedm dní od vystavení. Potom se soubor smaže.',
    '',
    '---',
    '',
    'A copy of the data we hold about you',
    '',
    'This archive contains ten files. Open the CSV files in a spreadsheet application,',
    'the JSON and NDJSON files in a text editor.',
    '',
    'The download link is valid for seven days. After that the file is deleted.',
  ].join('\n');
}
