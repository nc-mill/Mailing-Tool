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
