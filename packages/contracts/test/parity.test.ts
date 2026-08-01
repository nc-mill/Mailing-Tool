import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkParity, expectedIds } from '../scripts/check-parity';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Vyrobí dvojici reportů, která je v pořádku, a nechá test jednu z nich pokazit. */
async function reports(): Promise<Record<string, unknown>> {
  const expected = await expectedIds(packageRoot);
  const out: Record<string, unknown> = {};
  for (const [section, sides] of Object.entries(expected)) {
    for (const language of ['ts', 'go'] as const) {
      out[`${language}-golden-${section}.json`] = {
        language,
        section,
        total: sides[language].ids.length,
        executed: sides[language].ids.length,
        skipped: 0,
        ids: sides[language].ids,
        groups: sides[language].groups,
        fixturesDigest: sides.digest,
      };
    }
  }
  return out;
}

describe('test:parity', () => {
  it('projde, když se počty, id i otisky shodují', async () => {
    const result = await checkParity(packageRoot, { override: await reports() });
    expect(result.errors).toEqual([]);
  });

  it('spadne, když report jedné strany chybí', async () => {
    const override = await reports();
    delete override['go-golden-liquid.json'];
    const result = await checkParity(packageRoot, { override });
    // Chybějící report NIKDY neznamená přeskočení. Parita nad jednou stranou
    // není parita a tenhle test je jediný důkaz, že to tak opravdu je.
    expect(result.errors.join('\n')).toMatch(/chybí report go-golden-liquid/);
  });

  it('spadne, když jedna strana zpracovala jinou množinu fixtur', async () => {
    const override = await reports();
    const go = override['go-golden-liquid.json'] as { ids: string[]; executed: number };
    go.ids = go.ids.slice(0, -1);
    go.executed = go.ids.length;
    const result = await checkParity(packageRoot, { override });
    expect(result.errors.join('\n')).toMatch(/LQ-/);
  });

  it('spadne, když je fixture označená jako přeskočená', async () => {
    const override = await reports();
    (override['go-golden-liquid.json'] as { skipped: number }).skipped = 1;
    const result = await checkParity(packageRoot, { override });
    expect(result.errors.join('\n')).toMatch(/přeskočen/);
  });

  it('spadne nad reportem ze staršího běhu, i když čísla sedí', async () => {
    const override = await reports();
    (override['go-golden-liquid.json'] as { fixturesDigest: string }).fixturesDigest = 'a'.repeat(
      64,
    );
    const result = await checkParity(packageRoot, { override });
    // Adresář reports/ se nikde nemaže, takže bez otisku by šlo dostat zelenou
    // paritu nad výsledkem běhu, který proběhl nad jinými fixtures.
    expect(result.errors.join('\n')).toMatch(/otisk/);
  });

  it('spadne, když zakázaná konstrukce nebo negativní vektor nemá fixture', async () => {
    const result = await checkParity(packageRoot, {
      override: await reports(),
      requireExtraCode: 'liquid_neexistujici_kod',
    });
    expect(result.errors.join('\n')).toContain('liquid_neexistujici_kod');
  });
});
