/**
 * Graf závislostí mezi balíčky monorepa.
 *
 * Hrany pro contracts, db, core, web a worker jsou NORMATIVNÍ, opsané z části 1,
 * kapitoly 3.11 specifikace. Hrany pro config, emails, i18n, sdk-node, sdk-web,
 * ui a cli specifikace neuvádí; jsou odvozené v plánu P01, rozhodnutí D12.
 *
 * apps/sender v grafu není: je to Go modul, který podle 3.11 nesmí importovat
 * nic z Node světa, a hlídá ho `go-licenses` plus absence go.mod závislosti.
 */

export const WORKSPACE_PACKAGES = [
  '@mlain/config',
  '@mlain/contracts',
  '@mlain/core',
  '@mlain/db',
  '@mlain/emails',
  '@mlain/i18n',
  '@mlain/sdk-node',
  '@mlain/sdk-web',
  '@mlain/ui',
] as const;

export const WORKSPACE_APPS = ['@mlain/cli', '@mlain/web', '@mlain/worker'] as const;

export type WorkspaceName = (typeof WORKSPACE_PACKAGES)[number] | (typeof WORKSPACE_APPS)[number];

export const PACKAGE_GRAPH: Record<WorkspaceName, readonly WorkspaceName[]> = {
  // Kořen grafu. Nesmí importovat nic z monorepa, čte ho i Go strana.
  '@mlain/contracts': [],
  '@mlain/config': [],
  '@mlain/i18n': [],
  '@mlain/sdk-web': [],
  '@mlain/db': ['@mlain/contracts'],
  '@mlain/sdk-node': ['@mlain/contracts'],
  '@mlain/ui': ['@mlain/i18n'],
  '@mlain/emails': ['@mlain/contracts', '@mlain/i18n'],
  // Hrana core -> emails je NORMATIVNÍ potřeba plánu P08: doména
  // packages/core/src/templates/** je obal nad blokovým modelem a rendererem
  // a importuje z @mlain/emails/document/{schema,semantic,migrate,canonical,types}
  // v osmi zdrojových souborech. Bez téhle hrany by ESLint hranice P08 zastavily
  // hned prvním souborem. Cyklus nevzniká: packages/emails v manifestu ani
  // v kódu @mlain/core neimportuje, jeho jediná workspace závislost je contracts.
  '@mlain/core': ['@mlain/contracts', '@mlain/db', '@mlain/emails', '@mlain/i18n'],
  '@mlain/cli': ['@mlain/contracts', '@mlain/core', '@mlain/db'],
  '@mlain/worker': ['@mlain/contracts', '@mlain/core', '@mlain/db', '@mlain/emails', '@mlain/i18n'],
  '@mlain/web': [
    '@mlain/contracts',
    '@mlain/core',
    '@mlain/db',
    '@mlain/emails',
    '@mlain/i18n',
    '@mlain/sdk-node',
    '@mlain/ui',
  ],
};

export const PACKAGE_DIRECTORIES: Record<WorkspaceName, string> = {
  '@mlain/config': 'packages/config',
  '@mlain/contracts': 'packages/contracts',
  '@mlain/core': 'packages/core',
  '@mlain/db': 'packages/db',
  '@mlain/emails': 'packages/emails',
  '@mlain/i18n': 'packages/i18n',
  '@mlain/sdk-node': 'packages/sdk-node',
  '@mlain/sdk-web': 'packages/sdk-web',
  '@mlain/ui': 'packages/ui',
  '@mlain/cli': 'apps/cli',
  '@mlain/web': 'apps/web',
  '@mlain/worker': 'apps/worker',
};

/** Balíčky, které `name` importovat nesmí. Doplněk povolených hran. */
export function forbiddenDependencies(name: WorkspaceName): WorkspaceName[] {
  const allowed = new Set<WorkspaceName>([name, ...PACKAGE_GRAPH[name]]);
  return [...WORKSPACE_PACKAGES, ...WORKSPACE_APPS].filter((candidate) => !allowed.has(candidate));
}
