import {
  PACKAGE_DIRECTORIES,
  PACKAGE_GRAPH,
  WORKSPACE_APPS,
  WORKSPACE_PACKAGES,
  forbiddenDependencies,
} from '../src/package-graph.ts';

const BARREL_MESSAGE =
  'Barrel exporty se v monorepu nezakládají. Importuj podcestu, například @mlain/core/errors, ne @mlain/core.';

/** Balíčky, u kterých je zakázaný jen holý název, ne podcesty (uzávěr S11). */
const BARREL_PACKAGES = ['@mlain/core'];

/**
 * Flat config bloky, které vynucují graf závislostí z části 1, kapitoly 3.11.
 * Jeden blok na balíček, aby chybová hláška uměla říct, který balíček co nesmí.
 */
export function boundariesConfig() {
  const all = [...WORKSPACE_PACKAGES, ...WORKSPACE_APPS];

  return all.map((name) => {
    const dir = PACKAGE_DIRECTORIES[name];
    const forbidden = forbiddenDependencies(name);
    const allowedDirs = new Set(PACKAGE_GRAPH[name].map((dep) => PACKAGE_DIRECTORIES[dep]));

    // paths = přesná shoda specifikátoru. Jediné správné místo pro zákaz barrelu.
    // Podcesty jako @mlain/core/errors tímhle NEJSOU dotčené.
    const paths = BARREL_PACKAGES.filter((pkg) => !forbidden.includes(pkg)).map((pkg) => ({
      name: pkg,
      message: BARREL_MESSAGE,
    }));

    // patterns = gitignore sémantika. Zakázaný balíček má být zakázaný i se
    // všemi podcestami, takže stačí holý název; `${dep}/*` a `${dep}/**` by byly
    // jen redundance.
    //
    // RELATIVNÍ CESTY SEM NEPATŘÍ. `no-restricted-imports` porovnává řetězec
    // specifikátoru a nezná adresář importujícího souboru, takže počet `../`
    // se nedá odvodit: z packages/db/src/repo.ts vede do core `../../core/...`,
    // z packages/db/src/a/b.ts `../../../core/...`. Vzor s pevným počtem `../`
    // proto nezachytí nic a vzor podle holého jména adresáře (`../config/**`)
    // by naopak zakázal legitimní `../config/ai-keys.js` uvnitř packages/core.
    // Relativní přechody přes hranici hlídá `import/no-restricted-paths`
    // v index.js, protože ten specifikátor skutečně rozřeší na cestu k souboru.
    const patterns = [
      {
        group: forbidden,
        message: `${name} nesmí importovat tenhle balíček. Povolené hrany jsou v packages/config/src/package-graph.ts a pocházejí z části 1, kapitoly 3.11.`,
      },
    ].filter((entry) => entry.group.length > 0);

    const options = {};
    if (paths.length > 0) options.paths = paths;
    if (patterns.length > 0) options.patterns = patterns;

    return {
      name: `mlain/boundaries/${name}`,
      files: [`${dir}/**/*.{ts,tsx,js,jsx,mjs}`],
      rules: {
        'no-restricted-imports': ['error', options],
      },
      // allowedDirs se používá v index.js přes restrictedPathZones(); tady je
      // jen proto, aby bylo vidět, že blok o povolených adresářích ví.
      settings: { 'mlain/allowedDirs': [...allowedDirs] },
    };
  });
}
