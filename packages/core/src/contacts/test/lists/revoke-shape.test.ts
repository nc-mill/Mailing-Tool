import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * KRITÉRIUM 79 jako mechanismus, ne jako věta v dokumentaci.
 *
 * `revokePendingMessages` bere rozsah v poli `listId`. V části 4a je ten parametr
 * volitelný, takže jeho vynechání projde typovou kontrolou a zruší VEŠKEROU čekající
 * poštu kontaktu místo zvoleného rozsahu. Je to tichá ztráta pošty: nic neselže.
 *
 * Ochrana je proto trojí a tenhle soubor hlídá dvě z nich:
 *   1. Typ portu má `listId` POVINNÉ, takže vynechání neprojde překladem.
 *   2. Žádné volání v repozitáři klíč nevynechá, ani kdyby port někdo uvolnil.
 * Třetí je pravidlo `no-restricted-syntax` v `contacts/eslint-rules.js`, které se
 * zapojí, až ho P01 přidá do sdílené konfigurace.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const domainRoot = join(here, '..', '..');
const portFile = join(domainRoot, 'campaigns-port.ts');

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'node_modules') continue;
      collectSources(full, out);
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('rozsah zrušení čekajících zpráv', () => {
  it('port má listId povinné, ne volitelné', () => {
    const port = readFileSync(portFile, 'utf8');
    expect(port).toMatch(/listId:\s*string\s*\|\s*null;/);
    expect(port).not.toMatch(/listId\?:/);
  });

  it('žádné volání v doméně nevynechá listId', () => {
    const offenders: string[] = [];
    for (const file of collectSources(domainRoot)) {
      if (file === portFile) continue;
      const source = readFileSync(file, 'utf8');
      let index = source.indexOf('revokePendingMessages({');
      while (index !== -1) {
        const call = source.slice(index, source.indexOf('});', index));
        if (!call.includes('listId'))
          offenders.push(relative(domainRoot, file).split(sep).join('/'));
        index = source.indexOf('revokePendingMessages({', index + 1);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('pojistka sama funguje: aspoň jedno hlídané volání v doméně je', () => {
    const calls = collectSources(domainRoot)
      .filter((file) => file !== portFile)
      .filter((file) => readFileSync(file, 'utf8').includes('revokePendingMessages({'));
    expect(calls.length).toBeGreaterThan(0);
  });
});
