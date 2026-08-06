export interface CommandOption {
  /** Přesně tak, jak se píše na příkazové řádce, včetně dvou pomlček. */
  readonly flag: string;
  readonly summary: string;
}

export interface CommandDefinition {
  readonly name: string;
  /** Podpříkazy, například `backup verify`. */
  readonly subcommands?: readonly string[];
  readonly summary: string;
  readonly usage: string;
  /**
   * Přepínače, které příkaz přijímá, i s vysvětlením.
   *
   * Vzniklo po nálezu: `mlain doctor` uměl `--json` a `--strict`, v registru
   * stálo jen `usage: 'mlain doctor'`, a protože `dispatch` zachytí `--help`
   * DŘÍV než příkaz, nevypsala je ani nápověda. Přepínač, o kterém se nedá
   * nikde dočíst, v praxi neexistuje; `--strict` přitom mění exit kód, tedy je
   * to jediná cesta, jak nechat varování shodit hlídač v cronu.
   *
   * Hlídá to test `registration.test.ts`: každý přepínač, který se objeví
   * v `usage`, tady musí mít popis. Čtvrtý nepopsaný přepínač tedy neprojde.
   */
  readonly options?: readonly CommandOption[];
  /** Plán, který příkaz dodá. U implementovaných je to P01. */
  readonly owner: string;
  readonly implemented: boolean;
}

/**
 * Úplný registr podpříkazů `mlain`. Předdeklarovaný stejně jako registry chyb
 * a front: doménový plán příkaz doplní, nezakládá ho.
 *
 * Implementované v P01 jsou jen `config check`, `healthcheck` a `version`,
 * protože je potřebuje entrypoint a direktiva HEALTHCHECK v Dockerfile.
 */
export const COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'version',
    summary: 'Vypíše verzi image.',
    usage: 'mlain version',
    owner: 'P01',
    implemented: true,
  },
  {
    name: 'config',
    subcommands: ['check'],
    summary: 'Ověří konfiguraci a vypíše všechny problémy naráz.',
    usage: 'mlain config check',
    owner: 'P01',
    implemented: true,
  },
  {
    name: 'healthcheck',
    summary: 'Zkontroluje běžící procesy podle MODE. Volá ho HEALTHCHECK v Dockerfile.',
    usage: 'mlain healthcheck',
    owner: 'P01',
    implemented: true,
  },
  {
    name: 'migrate',
    summary: 'Aplikuje migrace pod rolí mlain_migrator s advisory lockem.',
    usage: 'mlain migrate',
    owner: 'P03',
    implemented: true,
  },
  {
    name: 'genkey',
    summary:
      'Vygeneruje nový SECRET_KEY ve tvaru <key_id>:<base64url>. Pokolení odvodí z prostředí, jinak ho vyžádá přes --id.',
    usage: 'mlain genkey [--id <n>]',
    options: [
      {
        flag: '--id',
        summary:
          'Pokolení nového klíče, 1 až 255. Bez něj se odvodí z SECRET_KEY a SECRET_KEY_PREVIOUS v prostředí; když tam žádné není, příkaz číslo vyžádá a nehádá.',
      },
    ],
    owner: 'P16',
    implemented: true,
  },
  {
    name: 'backup',
    subcommands: ['verify', 'list'],
    summary:
      'Vytvoří zálohu databáze a uploadů. Podpříkaz verify ji ověří do dočasné databáze, list vypíše existující zálohy.',
    usage: 'mlain backup [--skip-prune] | mlain backup verify <adresář> | mlain backup list',
    options: [
      { flag: '--skip-prune', summary: 'Nechá staré zálohy na místě, nemaže podle retence.' },
    ],
    owner: 'P16',
    implemented: true,
  },
  {
    name: 'restore',
    summary: 'Obnoví instalaci ze zálohy.',
    usage: 'mlain restore <adresář> [--force] [--skip-uploads] [--i-know-the-key-differs]',
    options: [
      { flag: '--force', summary: 'Vyprázdní cílovou databázi před obnovou.' },
      { flag: '--skip-uploads', summary: 'Obnoví jen databázi, nahrané soubory nechá být.' },
      {
        flag: '--i-know-the-key-differs',
        summary:
          'Povolí obnovu se SECRET_KEY jiným, než měla záloha. Uložené přístupy k odesílání a AI klíče se pak nepřečtou a musí se zadat znovu.',
      },
    ],
    owner: 'P16',
    implemented: true,
  },
  {
    name: 'doctor',
    summary: 'Prověří instalaci a vypíše nálezy podle závažnosti.',
    usage: 'mlain doctor [--json] [--strict]',
    options: [
      { flag: '--json', summary: 'Vypíše nálezy jako JSON se souhrnem, pro strojové zpracování.' },
      {
        flag: '--strict',
        summary:
          'Nechá i varování skončit nenulově (exit 1). Bez něj vrací nenulu jedině kritický nález (exit 2). Pro hlídač v cronu.',
      },
    ],
    owner: 'P16',
    implemented: true,
  },
  {
    name: 'upgrade',
    summary: 'Opatrný upgrade: zastaví procesy, zazálohuje, migruje, spustí zpět.',
    usage: 'mlain upgrade',
    owner: 'P16',
    implemented: true,
  },
  {
    name: 'rotate-credentials',
    summary: 'Přešifruje všechny obálky na aktuální key_id.',
    usage: 'mlain rotate-credentials',
    owner: 'P16',
    implemented: true,
  },
  // Dva příkazy doplněné po nálezu: P16 je oba implementuje a označuje
  // `implemented: true`, ale v tomhle registru chyběly. Registr je uzavřený
  // výčet, takže by je P16 musel založit sám, což uzávěr S10 zakazuje.
  {
    name: 'reset-password',
    summary:
      'Nastaví uživateli nové heslo. Jediná cesta zpět do instalace, která ještě nemá nastavené odesílání.',
    usage: 'mlain reset-password <e-mail> [--password <heslo>]',
    options: [
      {
        flag: '--password',
        summary:
          'Konkrétní heslo. Bez něj se vygeneruje a vypíše. Relace uživatele se ruší tak jako tak.',
      },
    ],
    owner: 'P16',
    implemented: true,
  },
  // Údržba oddílů. Do registru přibyla proto, že retence odeslané pošty
  // v produktu NEEXISTOVALA: `dropPartitionsBefore()` neměla volajícího,
  // dvě retenční fronty byly bez obsluhy a `MESSAGE_RETENTION_DAYS` nikdo
  // nečetl. Příkaz to dělá pod migrátorskou rolí, protože odpojení oddílu je
  // DDL a worker běží pod rolí, která na schéma práva nemá.
  {
    name: 'partitions',
    summary:
      'Založí oddíly na další měsíce a zahodí ty, které přesáhly retenční lhůtu. Pouští se z plánovače denně.',
    usage: 'mlain partitions [--dry-run] [--months <n>]',
    options: [
      { flag: '--dry-run', summary: 'Jen vypíše, co by založil a co zahodil. Nic nemění.' },
      {
        flag: '--months',
        summary: 'Na kolik měsíců dopředu zakládat oddíly, 1 až 24. Výchozí 4.',
      },
    ],
    owner: 'P13',
    implemented: true,
  },
  {
    name: 'rebuild-engagement',
    summary:
      'Přepočítá tabulku zapojení kontaktů od nuly po dávkách, po havárii nebo obnově zálohy.',
    usage: 'mlain rebuild-engagement --workspace <id> [--batch-size <n>]',
    options: [
      { flag: '--workspace', summary: 'Projekt, jehož zapojení se přepočítá. Povinný.' },
      { flag: '--batch-size', summary: 'Velikost dávky přepočtu. Výchozí 5000.' },
    ],
    owner: 'P16',
    implemented: true,
  },
  // Převlečení do barev značky. Do registru patří proto, že převlékání jinak
  // spouští jen uložení značky: instalace, která ji nastavenou má a od upgradu
  // ji znovu neuloží, by zůstala se starými barvami napořád.
  {
    name: 'redress-brand',
    summary: 'Převleče uložené e-maily do barev značky projektu. Opakované spuštění nic nezmění.',
    usage: 'mlain redress-brand',
    owner: 'P08',
    implemented: true,
  },
];

export function findCommand(name: string): CommandDefinition | undefined {
  return COMMANDS.find((command) => command.name === name);
}

/** Nejbližší jméno podle Levenshteinovy vzdálenosti, pro nápovědu u překlepu. */
export function suggest(name: string): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const command of COMMANDS) {
    const distance = levenshtein(name, command.name);
    if (!best || distance < best.distance) best = { name: command.name, distance };
  }
  return best && best.distance <= 3 ? best.name : undefined;
}

function levenshtein(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) rows[0]![column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      rows[row]![column] = Math.min(
        rows[row - 1]![column]! + 1,
        rows[row]![column - 1]! + 1,
        rows[row - 1]![column - 1]! + cost,
      );
    }
  }
  return rows[a.length]![b.length]!;
}
