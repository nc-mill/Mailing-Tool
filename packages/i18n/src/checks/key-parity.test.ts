import { describe, expect, it } from 'vitest';
import { loadMessages } from '../load-messages';

function flatten(tree: unknown, prefix = ''): string[] {
  if (typeof tree !== 'object' || tree === null) return [prefix];
  return Object.entries(tree).flatMap(([key, value]) =>
    flatten(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('shoda klíčů mezi jazyky', () => {
  it('cs a en mají přesně stejnou množinu klíčů', async () => {
    const [cs, en] = await Promise.all([loadMessages('cs'), loadMessages('en')]);
    const csKeys = flatten(cs).sort();
    const enKeys = flatten(en).sort();

    const missingInCs = enKeys.filter((key) => !csKeys.includes(key));
    const missingInEn = csKeys.filter((key) => !enKeys.includes(key));

    expect(missingInCs, `chybí v cs: ${missingInCs.join(', ')}`).toEqual([]);
    expect(missingInEn, `chybí v en: ${missingInEn.join(', ')}`).toEqual([]);
  });

  it('žádná hodnota není prázdný řetězec', async () => {
    for (const locale of ['cs', 'en'] as const) {
      const messages = await loadMessages(locale);
      const empty: string[] = [];
      const walk = (node: unknown, path: string) => {
        if (typeof node === 'string') {
          if (node.trim() === '') empty.push(path);
          return;
        }
        if (typeof node === 'object' && node !== null) {
          for (const [key, value] of Object.entries(node)) {
            walk(value, path === '' ? key : `${path}.${key}`);
          }
        }
      };
      walk(messages, '');
      expect(empty, `prázdné klíče v ${locale}: ${empty.join(', ')}`).toEqual([]);
    }
  });
});
