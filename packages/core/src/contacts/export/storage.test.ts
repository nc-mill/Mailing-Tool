import { mkdtempSync } from 'node:fs';
import { readFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileExportStorage, exportStorageKey } from './storage';

const root = mkdtempSync(join(tmpdir(), 'mlain-export-storage-'));

describe('úložiště exportů', () => {
  it('klíč je složený z identifikátorů, ne ze vstupu uživatele', () => {
    expect(exportStorageKey('ws-1', 'exp-2', 'zip')).toBe('exports/ws-1/exp-2.zip');
  });

  it('SOUBOR PO ZÁPISU FYZICKY EXISTUJE a má přesně zapsaný obsah', async () => {
    const storage = createFileExportStorage(root);
    const key = exportStorageKey('ws-a', 'exp-a', 'zip');
    const content = Buffer.from('PK archiv subjektu');

    const { byteSize } = await storage.put(key, content);

    const target = join(root, key);
    expect((await stat(target)).size).toBe(content.length);
    expect(byteSize).toBe(content.length);
    expect(await readFile(target)).toEqual(content);
  });

  it('archiv s osobními údaji není čitelný pro ostatní účty na stroji', async () => {
    const storage = createFileExportStorage(root);
    const key = exportStorageKey('ws-b', 'exp-b', 'zip');
    await storage.put(key, Buffer.from('data'));

    // 0600 na souboru, 0700 na adresáři projektu.
    expect((await stat(join(root, key))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, 'exports', 'ws-b'))).mode & 0o777).toBe(0o700);
  });

  it('po zápisu nezůstane rozepsaný dočasný soubor', async () => {
    const storage = createFileExportStorage(root);
    await storage.put(exportStorageKey('ws-c', 'exp-c', 'zip'), Buffer.from('data'));

    const names = await readdir(join(root, 'exports', 'ws-c'));
    expect(names).toEqual(['exp-c.zip']);
  });

  it('druhý zápis pod týmž klíčem obsah přepíše, nezaloží druhý soubor', async () => {
    const storage = createFileExportStorage(root);
    const key = exportStorageKey('ws-d', 'exp-d', 'zip');
    await storage.put(key, Buffer.from('první'));
    await storage.put(key, Buffer.from('druhý'));

    expect(await readFile(join(root, key), 'utf8')).toBe('druhý');
    expect(await readdir(join(root, 'exports', 'ws-d'))).toEqual(['exp-d.zip']);
  });

  it('klíč mimo DATA_DIR se odmítne, jinak by stažení vydalo cizí soubor', async () => {
    const storage = createFileExportStorage(root);
    for (const key of ['../../etc/passwd', 'exports/../../secret', '/etc/passwd', '']) {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow(/mimo DATA_DIR/);
      expect(() => storage.resolve(key)).toThrow(/mimo DATA_DIR/);
    }
  });

  it('mazání je idempotentní, retence běží opakovaně', async () => {
    const storage = createFileExportStorage(root);
    const key = exportStorageKey('ws-e', 'exp-e', 'zip');
    await storage.put(key, Buffer.from('data'));

    await storage.remove(key);
    await expect(stat(join(root, key))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(storage.remove(key)).resolves.toBeUndefined();
  });
});
