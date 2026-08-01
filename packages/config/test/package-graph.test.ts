import { describe, expect, it } from 'vitest';
import {
  PACKAGE_DIRECTORIES,
  PACKAGE_GRAPH,
  WORKSPACE_APPS,
  WORKSPACE_PACKAGES,
  forbiddenDependencies,
  type WorkspaceName,
} from '../src/package-graph';

describe('PACKAGE_GRAPH', () => {
  it('má právě devět balíčků v packages/', () => {
    expect([...WORKSPACE_PACKAGES].sort()).toEqual([
      '@mlain/config',
      '@mlain/contracts',
      '@mlain/core',
      '@mlain/db',
      '@mlain/emails',
      '@mlain/i18n',
      '@mlain/sdk-node',
      '@mlain/sdk-web',
      '@mlain/ui',
    ]);
  });

  it('kopíruje hrany normativně dané částí 1, kapitolou 3.11', () => {
    expect(PACKAGE_GRAPH['@mlain/contracts']).toEqual([]);
    expect(PACKAGE_GRAPH['@mlain/db']).toEqual(['@mlain/contracts']);
    expect([...PACKAGE_GRAPH['@mlain/core']].sort()).toEqual([
      '@mlain/contracts',
      '@mlain/db',
      '@mlain/emails',
      '@mlain/i18n',
    ]);
    expect([...PACKAGE_GRAPH['@mlain/web']].sort()).toEqual([
      '@mlain/contracts',
      '@mlain/core',
      '@mlain/db',
      '@mlain/emails',
      '@mlain/i18n',
      '@mlain/sdk-node',
      '@mlain/ui',
    ]);
    expect([...PACKAGE_GRAPH['@mlain/worker']].sort()).toEqual([
      '@mlain/contracts',
      '@mlain/core',
      '@mlain/db',
      '@mlain/emails',
      '@mlain/i18n',
    ]);
  });

  it('je acyklický', () => {
    const seen = new Map<string, 'open' | 'done'>();
    const walk = (node: string, trail: string[]): void => {
      const state = seen.get(node);
      if (state === 'done') return;
      if (state === 'open') throw new Error(`cyklus: ${[...trail, node].join(' -> ')}`);
      seen.set(node, 'open');
      for (const dep of PACKAGE_GRAPH[node as WorkspaceName] ?? []) walk(dep, [...trail, node]);
      seen.set(node, 'done');
    };
    expect(() => {
      for (const node of Object.keys(PACKAGE_GRAPH)) walk(node, []);
    }).not.toThrow();
  });

  it('nezná žádnou hranu na balíček mimo workspace', () => {
    const known = new Set<string>([...WORKSPACE_PACKAGES, ...WORKSPACE_APPS]);
    for (const [pkg, deps] of Object.entries(PACKAGE_GRAPH)) {
      expect(known.has(pkg), `neznámý balíček ${pkg}`).toBe(true);
      for (const dep of deps) expect(known.has(dep), `${pkg} -> ${dep}`).toBe(true);
    }
  });

  it('má adresář pro každý balíček i aplikaci', () => {
    for (const name of [...WORKSPACE_PACKAGES, ...WORKSPACE_APPS]) {
      expect(PACKAGE_DIRECTORIES[name], `chybí adresář pro ${name}`).toBeTypeOf('string');
    }
  });

  it('forbiddenDependencies vrací doplněk povolených hran', () => {
    const forbidden = forbiddenDependencies('@mlain/db');
    expect(forbidden).toContain('@mlain/core');
    expect(forbidden).toContain('@mlain/ui');
    expect(forbidden).not.toContain('@mlain/contracts');
    expect(forbidden).not.toContain('@mlain/db');
  });
});
