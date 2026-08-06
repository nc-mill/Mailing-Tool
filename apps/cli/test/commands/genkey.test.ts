import { describe, expect, it } from 'vitest';
import { runGenkeyCommand } from '../../src/commands/genkey';
import { EXIT_OK, EXIT_USAGE } from '../../src/exit-codes';
import type { CliStreams } from '../../src/dispatch';

const io = (): CliStreams & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (l) => out.push(l), stderr: (l) => err.push(l) };
};

/** Klíč z výpisu, tedy hodnota za `SECRET_KEY=<id>:`. */
function keyFrom(lines: readonly string[]): { keyId: number; key: string } {
  const line = lines.find((l) => l.includes('SECRET_KEY='));
  expect(line, 've výpisu chybí řádek se SECRET_KEY').toBeDefined();
  const match = line!.match(/SECRET_KEY=(\d+):(\S+)/);
  expect(match, `řádek nemá tvar SECRET_KEY=<id>:<klíč>: ${line}`).not.toBeNull();
  return { keyId: Number(match![1]), key: match![2]! };
}

describe('mlain genkey', () => {
  it('při druhé rotaci bez přepínače vyrobí TŘETÍ pokolení, ne znovu druhé', async () => {
    // Přesně ten omyl, kvůli kterému se to opravovalo: dřív byl výchozí --id 2,
    // takže druhý běh bez přepínače vyrobil druhý různý klíč se stejným key_id
    // a data zašifrovaná tím prvním se přestala dát přečíst.
    const streams = io();
    const code = await runGenkeyCommand(streams, [], {
      SECRET_KEY: '2:druhy',
      SECRET_KEY_PREVIOUS: '1:prvni',
    });
    expect(code).toBe(EXIT_OK);
    expect(keyFrom(streams.out).keyId).toBe(3);
  });

  it('bez pokolení v prostředí a bez --id nevydá klíč a řekne proč', async () => {
    const streams = io();
    const code = await runGenkeyCommand(streams, [], {});
    expect(code).toBe(EXIT_USAGE);
    expect(streams.out).toEqual([]);
    expect(streams.err.join('\n')).toContain('--id');
  });

  it('odmítne --id, které instalace už zná', async () => {
    const streams = io();
    const code = await runGenkeyCommand(streams, ['--id', '2'], {
      SECRET_KEY: '2:druhy',
      SECRET_KEY_PREVIOUS: '1:prvni',
    });
    expect(code).toBe(EXIT_USAGE);
    expect(streams.out).toEqual([]);
    expect(streams.err.join('\n')).toContain('UŽ ZNÁ');
  });

  it('první klíč nové instalace se vydá jen na výslovné --id 1', async () => {
    const streams = io();
    const code = await runGenkeyCommand(streams, ['--id', '1'], {});
    expect(code).toBe(EXIT_OK);
    expect(keyFrom(streams.out).keyId).toBe(1);
  });

  it('vydaný klíč je base64url o 32 bajtech', async () => {
    const streams = io();
    await runGenkeyCommand(streams, ['--id', '1'], {});
    const { key } = keyFrom(streams.out);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(key, 'base64url')).toHaveLength(32);
  });

  it('runbook vyjmenuje pokolení do SECRET_KEY_PREVIOUS, ať se žádné nevynechá', async () => {
    const streams = io();
    await runGenkeyCommand(streams, [], { SECRET_KEY: '2:b', SECRET_KEY_PREVIOUS: '1:a' });
    const previous = streams.out.find((l) => l.includes('SECRET_KEY_PREVIOUS='));
    expect(previous).toContain('1, 2');
  });

  it('--id bez hodnoty skončí hláškou o použití, ne stackem', async () => {
    const streams = io();
    expect(await runGenkeyCommand(streams, ['--id'], {})).toBe(EXIT_USAGE);
    expect(streams.err.join('\n')).toContain('mlain genkey');
  });
});
