import { describe, expect, it } from 'vitest';
import { EXIT_UNAVAILABLE, EXIT_USAGE } from '../src/exit-codes';
import { COMMANDS } from '../src/registry';
import { dispatch } from '../src/dispatch';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

describe('mlain dispatcher', () => {
  it('zná všechny podpříkazy, které specifikace jmenuje', () => {
    const names = COMMANDS.map((command) => command.name).sort();
    expect(names).toEqual([
      'backup',
      'config',
      'doctor',
      'genkey',
      'healthcheck',
      'migrate',
      'rebuild-engagement',
      'reset-password',
      'restore',
      'rotate-credentials',
      'upgrade',
      'version',
    ]);
  });

  it('zná podpříkazy, které vlastník příkazu skutečně dodává', () => {
    const backup = COMMANDS.find((command) => command.name === 'backup');
    // P16 implementuje `backup`, `backup verify` i `backup list`. Kdyby tady
    // `list` chyběl, dispatcher by ho odmítl jako špatný argument.
    expect([...(backup?.subcommands ?? [])].sort()).toEqual(['list', 'verify']);
  });

  it('bez argumentů vypíše nápovědu a skončí 64', async () => {
    const streams = io();
    const code = await dispatch([], streams);
    expect(code).toBe(EXIT_USAGE);
    expect(streams.out.join('\n')).toContain('mlain <příkaz>');
    expect(streams.out.join('\n')).toContain('backup');
  });

  it('neznámý příkaz skončí 64 s návrhem', async () => {
    const streams = io();
    const code = await dispatch(['bakcup'], streams);
    expect(code).toBe(EXIT_USAGE);
    expect(streams.err.join('\n')).toContain('bakcup');
    expect(streams.err.join('\n')).toContain('backup');
  });

  it('deklarovaný, ale neimplementovaný příkaz skončí 69 s jasnou chybou', async () => {
    const streams = io();
    const code = await dispatch(['backup'], streams);
    expect(code).toBe(EXIT_UNAVAILABLE);
    const text = streams.err.join('\n');
    expect(text).toContain('not implemented');
    expect(text).toContain('P16');
  });

  it('migrate hlásí, že ho dodá P03', async () => {
    const streams = io();
    expect(await dispatch(['migrate'], streams)).toBe(EXIT_UNAVAILABLE);
    expect(streams.err.join('\n')).toContain('P03');
  });

  it('version vypíše verzi a skončí nulou', async () => {
    const streams = io();
    const code = await dispatch(['version'], { ...streams, env: { IMAGE_VERSION: '9.9.9' } });
    expect(code).toBe(0);
    expect(streams.out.join('\n')).toContain('9.9.9');
  });

  it('--help u konkrétního příkazu vypíše jeho popis a skončí nulou', async () => {
    const streams = io();
    const code = await dispatch(['backup', '--help'], streams);
    expect(code).toBe(0);
    expect(streams.out.join('\n')).toContain('zálohu');
  });

  it('každý neimplementovaný příkaz zná plán, který ho dodá', () => {
    for (const command of COMMANDS) {
      if (command.implemented) continue;
      expect(command.owner, `${command.name} nemá vlastníka`).toMatch(/^P\d\d$/);
    }
  });

  it('config check při vadné konfiguraci skončí 78', async () => {
    const streams = io();
    const code = await dispatch(['config', 'check'], { ...streams, env: {} });
    expect(code).toBe(78);
    expect(streams.err.join('\n')).toContain('SECRET_KEY');
  });
});
