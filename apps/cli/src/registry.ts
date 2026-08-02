export interface CommandDefinition {
  readonly name: string;
  /** Podpříkazy, například `backup verify`. */
  readonly subcommands?: readonly string[];
  readonly summary: string;
  readonly usage: string;
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
    summary: 'Vygeneruje nový SECRET_KEY ve tvaru <key_id>:<base64url>.',
    usage: 'mlain genkey [--id <n>]',
    owner: 'P16',
    implemented: true,
  },
  {
    name: 'backup',
    subcommands: ['verify', 'list'],
    summary:
      'Vytvoří zálohu databáze a uploadů. Podpříkaz verify ji ověří do dočasné databáze, list vypíše existující zálohy.',
    usage: 'mlain backup [--skip-prune] | mlain backup verify <adresář> | mlain backup list',
    owner: 'P16',
    implemented: true,
  },
  {
    name: 'restore',
    summary: 'Obnoví instalaci ze zálohy.',
    usage: 'mlain restore <adresář> [--force] [--skip-uploads] [--i-know-the-key-differs]',
    owner: 'P16',
    implemented: true,
  },
  {
    name: 'doctor',
    summary: 'Prověří instalaci a vypíše nálezy podle závažnosti.',
    usage: 'mlain doctor',
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
    owner: 'P16',
    implemented: true,
  },
  {
    name: 'rebuild-engagement',
    summary:
      'Přepočítá tabulku zapojení kontaktů od nuly po dávkách, po havárii nebo obnově zálohy.',
    usage: 'mlain rebuild-engagement --workspace <id> [--batch-size <n>]',
    owner: 'P16',
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
