import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('hranice balíčku contracts', () => {
  it('nemá závislost na žádném balíčku z monorepa', async () => {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    const all = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
    };
    const fromMonorepo = Object.keys(all).filter((name) => name.startsWith('@mlain/'));
    expect(fromMonorepo).toEqual([]);
  });

  it('má subpath exporty a nemá barrel index', async () => {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    expect(Object.keys(manifest.exports)).toContain('./token');
    expect(Object.keys(manifest.exports)).toContain('./crypto');
    expect(Object.keys(manifest.exports)).toContain('./outbox');
    expect(Object.keys(manifest.exports)).toContain('./liquid');
    expect(Object.keys(manifest.exports)).not.toContain('.');
  });

  it('vystavuje fixtures i vlastní package.json', async () => {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    // Bez ./fixtures/* si P08 fixtures nenačte a bez ./package.json si nedopočítá
    // jejich absolutní cestu přes import.meta.resolve. Obojí je doložený požadavek.
    expect(Object.keys(manifest.exports)).toContain('./fixtures/*');
    expect(Object.keys(manifest.exports)).toContain('./schema/*');
    expect(manifest.exports['./package.json']).toBe('./package.json');
  });
});
