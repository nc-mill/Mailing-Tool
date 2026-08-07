import { describe, expect, it } from 'vitest';
import { dispatch, type CliStreams } from '../../src/dispatch';
import { EXIT_UNAVAILABLE } from '../../src/exit-codes';
import { COMMANDS } from '../../src/registry';

const P16_COMMANDS = [
  'backup',
  'restore',
  'doctor',
  'upgrade',
  'rotate-credentials',
  'genkey',
  'rebuild-consents',
  'rebuild-engagement',
  'reset-password',
] as const;

const io = (): CliStreams & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (l) => out.push(l), stderr: (l) => err.push(l) };
};

describe('registrace příkazů P16', () => {
  it.each(P16_COMMANDS)('příkaz %s je v registru', (name) => {
    expect(COMMANDS.map((c) => c.name)).toContain(name);
  });

  it.each(P16_COMMANDS)('příkaz %s je označený jako implementovaný', (name) => {
    expect(COMMANDS.find((c) => c.name === name)?.implemented).toBe(true);
  });

  it.each(P16_COMMANDS)('příkaz %s NEVRACÍ exit 69, tedy je zapojený v dispatchi', async (name) => {
    // `--help` vypíše nápovědu a skončí nulou u KAŽDÉHO příkazu, i neimplementovaného,
    // takže se ptáme na skutečné spuštění. Bez konfigurace většina skončí kódem 78,
    // což je v pořádku: 78 znamená „příkaz běžel a chybí mu konfigurace",
    // kdežto 69 znamená „tělo příkazu vůbec nikdo nezavolal".
    const code = await dispatch([name], { ...io(), env: {} }).catch(() => -1);
    expect(code).not.toBe(EXIT_UNAVAILABLE);
  });

  it('mlain migrate zůstává v registru, protože ho dodává P03', () => {
    expect(COMMANDS.map((c) => c.name)).toContain('migrate');
  });

  it('backup zná podpříkazy verify a list', () => {
    const backup = COMMANDS.find((c) => c.name === 'backup');
    expect([...(backup?.subcommands ?? [])].sort()).toEqual(['list', 'verify']);
  });

  it('každý příkaz má jednořádkový popis pro nápovědu', () => {
    for (const c of COMMANDS) {
      expect(c.summary.length).toBeGreaterThan(10);
      expect(c.summary).not.toContain('\n');
    }
  });
});

/**
 * Nález: `mlain doctor` uměl `--json` a `--strict`, v registru stálo jen
 * `usage: 'mlain doctor'` a `dispatch` zachytává `--help` DŘÍV než příkaz,
 * takže je nevypsala ani nápověda. Přepínač, o kterém se nedá nikde dočíst,
 * v praxi neexistuje, a `--strict` přitom mění exit kód.
 */
describe('přepínače příkazů jsou popsané', () => {
  /** Přepínače z `usage`, tedy to, co registr sám slibuje. */
  const flagsInUsage = (usage: string): string[] => [
    ...new Set(usage.match(/--[a-z0-9-]+/g) ?? []),
  ];

  it.each(COMMANDS.filter((c) => flagsInUsage(c.usage).length > 0).map((c) => c.name))(
    'příkaz %s má ke každému přepínači z usage vysvětlení',
    (name) => {
      const command = COMMANDS.find((c) => c.name === name)!;
      const described = (command.options ?? []).map((o) => o.flag);
      for (const flag of flagsInUsage(command.usage)) {
        expect(described, `${name}: přepínač ${flag} není nikde popsaný`).toContain(flag);
      }
    },
  );

  it('žádný popis přepínače nepopisuje přepínač, který v usage není', () => {
    for (const command of COMMANDS) {
      for (const option of command.options ?? []) {
        expect(
          flagsInUsage(command.usage),
          `${command.name}: ${option.flag} je popsaný, ale v usage chybí`,
        ).toContain(option.flag);
      }
    }
  });

  it('mlain doctor umí --json i --strict a nápověda je vypíše', async () => {
    const streams = io();
    const code = await dispatch(['doctor', '--help'], { ...streams, env: {} });
    expect(code).toBe(0);
    const help = streams.out.join('\n');
    expect(help).toContain('--json');
    expect(help).toContain('--strict');
    // Nestačí, že se přepínač jmenuje. Musí být vidět, co dělá, protože
    // `--strict` je jediný způsob, jak nechat varování shodit hlídač v cronu.
    expect(help).toMatch(/--strict\s+\S/);
    expect(help).toContain('exit 1');
  });
});
