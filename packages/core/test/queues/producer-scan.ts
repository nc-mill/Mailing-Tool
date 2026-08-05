import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Statický sken PRODUCENTŮ úloh, tedy druhé poloviny slučovací dvojice.
 *
 * PROČ TO EXISTUJE. Slučování v pg-bossu stojí na dvou nezávislých polovinách:
 * fronta musí mít politiku a producent musí posílat `singletonKey`. Když se
 * jedna z nich rozejde, NIC NESPADNE, jen se přestane slučovat. Přesně tak se
 * to v produktu jednou rozešlo a nikdo si toho nevšiml. Sken je tu proto, aby
 * se obě poloviny daly porovnat testem, ne pohledem.
 *
 * ROZSAH A JEHO PŘIZNANÉ MEZE. Není to překladač. Čte zdroj, odstraní komentáře
 * a hledá volání zařazovacích pomocníků. Co nedokáže rozhodnout, NEHÁDÁ: uloží
 * to do `unresolved` a test na tom trvá, aby každé takové místo někdo ručně
 * zařadil. Tichý průchod nad neznámým místem by byl přesně ta vada, kterou
 * tenhle soubor odstraňuje.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/** Adresáře se zdrojem, ne s testy. Fronty plní jedině produkční kód. */
const SOURCE_ROOTS = ['packages/core/src', 'apps/web/src', 'apps/cli/src', 'apps/worker/src'];

/**
 * Pomocníci, kteří zařazují úlohu. Všichni mají stejný tvar
 * `fn(tx, name, payload, options?)`, takže se název fronty čte z druhého
 * argumentu a klíč z toho čtvrtého.
 *
 * `enqueue` je v seznamu schválně, i když je to obecné slovo: v produktu je to
 * jméno zařazovače domény kontaktů. Volání s méně než třemi argumenty se
 * přeskakuje, tím se odfiltrují injektované závislosti `enqueue(payload)`,
 * jejichž skutečné zařazení je vidět v kompozičním kořeni.
 */
const ENQUEUE_FUNCTIONS = [
  'enqueue',
  // Přejmenovaný import `enqueue` z domény kontaktů, viz identity/workspace-service.ts.
  // Jiné přejmenování v produktu není a `unknownAliases` hlídá, že nepřibude.
  'enqueueContactsJob',
  'enqueueImportJob',
  'enqueueBrandJob',
  'enqueueTrackingJob',
  'enqueueSegmentJob',
  'enqueueCampaignJob',
  'enqueueInWorkspace',
];

/**
 * Sdílený zařazovač. Bere JEDEN objekt, ne poziční argumenty, takže se název
 * fronty čte z `name:` uvnitř něj. Volají ho jednak doménoví pomocníci (tam je
 * `name` proměnná a jde o průchoďák, viz `UNRESOLVED_ALLOWLIST`), jednak
 * producenti, kteří ho používají přímo.
 */
const OBJECT_ARG_FUNCTIONS = ['enqueueJob'];

/**
 * Soubory, které vkládají do tabulky úloh VLASTNÍM SQL, tedy mimo pomocníky výš.
 * Seznam je uzavřený a test na tom trvá. Nový soubor s vlastním insertem je nová
 * cesta do fronty, kterou tenhle sken neumí přečíst, a musí se sem doplnit
 * i s tím, jak nakládá s klíčem.
 */
export const RAW_INSERT_FILES: Record<string, string> = {
  'packages/core/src/queues/enqueue-sql.ts':
    'JEDINÉ MÍSTO, KDE SE SMÍ VKLÁDAT DO TABULKY ÚLOH, a tenhle seznam to drží. Sedm domén ' +
    'tu mělo sedm kopií téhož příkazu a VŠEM chyběl sloupec `policy`, takže do řádku padala ' +
    'NULL, slučovací index se na něj nevztahoval a `singletonKey` neslučoval nic. Kdyby ' +
    'seznam znovu narostl, vznikla by osmá kopie, která se zase rozejde.',
};

/**
 * Producenti s vlastním insertem, které sken volání nevidí.
 *
 * PRÁZDNÉ, a je to tak správně. Bývala tu `identity.merge`, protože si vkládací příkaz
 * psala sama. Od přepojení na `enqueueJob` ji sken přečte automaticky, takže tady ruční
 * záznam být nemusí. Každá položka v tomhle poli je místo, kde brána věří člověku
 * místo kódu, takže čím prázdnější, tím lépe.
 */
export const RAW_INSERT_PRODUCERS: { queue: string; keyed: boolean; why: string }[] = [];

/**
 * Volání, u kterých sken název fronty nepřečte, protože je v proměnné. Každé
 * musí být zařazené ručně; test hlídá, že jich není víc ani míň.
 *
 * `queues: []` znamená průchoďák, tedy volání, které jen předává název dál
 * a samo žádnou frontu neplní.
 */
export const UNRESOLVED_ALLOWLIST: Record<
  string,
  { queues: string[]; keyed: boolean; why: string }
> = {
  'packages/core/src/contacts/jobs/enqueue.ts': {
    queues: [],
    keyed: false,
    why:
      'PRŮCHOĎÁK, ne producent: zařazovač domény kontaktů předává název fronty ze svého ' +
      'parametru do sdíleného enqueueJob. Frontu určuje až jeho volající a toho sken ' +
      'přečte zvlášť. Kdyby takový obal přibyl a nikdo ho sem nedopsal, test spadne.',
  },
  'packages/core/src/contacts/import/jobs/enqueue.ts': {
    queues: [],
    keyed: false,
    why: 'PRŮCHOĎÁK, ne producent: zařazovač importu, název fronty je jeho parametr.',
  },
  'packages/core/src/brand/jobs/enqueue.ts': {
    queues: [],
    keyed: false,
    why: 'PRŮCHOĎÁK, ne producent: zařazovač domény značky, název fronty je jeho parametr.',
  },
  'packages/core/src/segments/jobs/enqueue.ts': {
    queues: [],
    keyed: false,
    why: 'PRŮCHOĎÁK, ne producent: zařazovač segmentů, název fronty je jeho parametr.',
  },
  'packages/core/src/tracking/jobs/enqueue.ts': {
    queues: [],
    keyed: false,
    why: 'PRŮCHOĎÁK, ne producent: zařazovač měřicí domény, název fronty je jeho parametr.',
  },
  'packages/core/src/campaigns/api/service.ts': {
    queues: [],
    keyed: false,
    why:
      'PRŮCHOĎÁK, ne producent: enqueueCampaignJob předává název dál do enqueueJob ' +
      'a enqueueInWorkspace jen otevře transakci. Frontu určuje až jejich volající.',
  },
  'packages/core/src/brand/api/index.ts': {
    queues: ['content.brand_extract'],
    keyed: true,
    why:
      'Kompoziční kořen domény značky předává enqueue jako (queue, payload) => ' +
      'enqueueBrandJob(tx, queue, payload, { singletonKey: payload.extractionId }). Název ' +
      'fronty je parametr, ale jediný volající (brand-service.ts) posílá ' +
      'content.brand_extract a klíč se doplňuje tady, takže je fronta klíčovaná.',
  },
  'packages/core/src/contacts/repo/gdpr.ts': {
    queues: ['gdpr.erase', 'gdpr.export_subject'],
    keyed: false,
    why:
      'Název fronty se vybírá podle typu žádosti (erasure vs. access a portability), takže ' +
      'jedno volání plní DVĚ fronty. Klíč se NEPOSÍLÁ: volá se enqueue(tx, queue, payload) ' +
      'bez options, přestože registr u obou front slibuje <request_id>. Právě proto u nich ' +
      'slučování zapnuté není.',
  },
};

export type ProducerCounts = { keyed: number; keyless: number };

export type ScanResult = {
  readonly byQueue: Map<string, ProducerCounts>;
  readonly unresolved: string[];
  readonly rawInsertFiles: string[];
  /** Přejmenované importy zařazovačů, které sken nezná. Musí být prázdné. */
  readonly unknownAliases: string[];
};

/** Nahradí komentáře mezerami, aby seděla čísla řádků i offsety. */
function stripComments(source: string): string {
  const out = source.split('');
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === c) break;
        i += 1;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

function listFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
      found.push(full);
    }
  };
  walk(join(REPO_ROOT, root));
  return found;
}

/** Rozdělí obsah závorky na argumenty podle čárek na nulté úrovni zanoření. */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) args.push(current.trim());
  return args;
}

/** Najde konec volání od pozice otevírací závorky. Vrací index ZA závorkou. */
function callEnd(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

export function scanProducers(): ScanResult {
  const files = SOURCE_ROOTS.flatMap(listFiles);
  const sources = new Map<string, string>();
  for (const file of files) sources.set(file, stripComments(readFileSync(file, 'utf8')));

  // 1) Konstanty s názvem fronty, aby se daly přečíst i volání, která ho
  //    nepíšou doslova (SEGMENTS_RECOUNT_QUEUE, MATERIALIZE_JOB.queue a spol.).
  const constants = new Map<string, string>();
  for (const code of sources.values()) {
    for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*'([a-z_]+\.[a-z_]+)'/g)) {
      constants.set(m[1] as string, m[2] as string);
    }
    for (const m of code.matchAll(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*queue:\s*'([a-z_]+\.[a-z_]+)'/g,
    )) {
      constants.set(`${m[1] as string}.queue`, m[2] as string);
    }
  }

  const resolve = (arg: string): string | undefined => {
    const literal = arg.match(/^'([^']+)'$/);
    if (literal) return literal[1];
    return constants.get(arg);
  };

  const byQueue = new Map<string, ProducerCounts>();
  const unresolved: string[] = [];
  const bump = (queue: string, keyed: boolean): void => {
    const counts = byQueue.get(queue) ?? { keyed: 0, keyless: 0 };
    if (keyed) counts.keyed += 1;
    else counts.keyless += 1;
    byQueue.set(queue, counts);
  };

  const all = [...ENQUEUE_FUNCTIONS, ...OBJECT_ARG_FUNCTIONS];
  const pattern = new RegExp(`(^|[^.\\w$])(${all.join('|')})\\s*\\(`, 'g');

  for (const [file, code] of sources) {
    const rel = relative(REPO_ROOT, file);
    for (const m of code.matchAll(pattern)) {
      const open = m.index + m[0].length - 1;
      const fn = m[2] as string;
      const nameStart = open - fn.length;
      // Deklarace pomocníka, ne jeho volání.
      if (/\bfunction\s*$/.test(code.slice(Math.max(0, m.index - 30), nameStart))) continue;
      const end = callEnd(code, open);
      if (end === -1) continue;
      const call = code.slice(open, end);
      const args = splitArgs(code.slice(open + 1, end - 1));

      if (OBJECT_ARG_FUNCTIONS.includes(fn)) {
        // `enqueueJob(tx, { name: '...', singletonKey })`. Když je `name`
        // proměnná, je to doménový průchoďák a musí být v allowlistu.
        const named = (args[1] ?? '').match(/\bname:\s*([^,\n]+)/);
        const queue = named ? resolve((named[1] as string).trim()) : undefined;
        if (queue !== undefined) bump(queue, call.includes('singletonKey'));
        else unresolved.push(rel);
        continue;
      }

      // Injektovaná závislost `enqueue(payload)`. Skutečné zařazení je vidět
      // v kompozičním kořeni, který tenhle sken přečte zvlášť.
      if (args.length < 3) continue;

      const queue = resolve(args[1] as string);
      if (queue === undefined) {
        unresolved.push(rel);
        continue;
      }
      bump(queue, call.includes('singletonKey'));
    }
  }

  for (const [rel, spec] of Object.entries(UNRESOLVED_ALLOWLIST)) {
    if (!unresolved.includes(rel)) continue;
    for (const queue of spec.queues) bump(queue, spec.keyed);
  }
  for (const spec of RAW_INSERT_PRODUCERS) bump(spec.queue, spec.keyed);

  const rawInsertFiles: string[] = [];
  const unknownAliases: string[] = [];
  for (const [file, code] of sources) {
    // Zachytí obě podoby: `${sql.identifier(schema())}` i předpočítaný
    // `${schema}`. Užší tvar by přehlédl právě ten sdílený zařazovač.
    if (/INSERT INTO \$\{[\s\S]*?\}\.job\b/.test(code)) {
      rawInsertFiles.push(relative(REPO_ROOT, file));
    }
    // Přejmenovaný import zařazovače. Kdyby ho sken neznal, hledal by volání
    // pod původním jménem, žádné by nenašel a fronta by tiše vypadala jako
    // fronta bez producenta. Test proto trvá na tom, aby byl seznam prázdný.
    for (const m of code.matchAll(/\b(enqueue[A-Za-z]*)\s+as\s+([A-Za-z_$][\w$]*)/g)) {
      const alias = m[2] as string;
      if (!ENQUEUE_FUNCTIONS.includes(alias)) {
        unknownAliases.push(`${relative(REPO_ROOT, file)}: ${m[1]} as ${alias}`);
      }
    }
  }

  return {
    byQueue,
    unresolved: [...new Set(unresolved)].sort(),
    rawInsertFiles: rawInsertFiles.sort(),
    unknownAliases: unknownAliases.sort(),
  };
}
