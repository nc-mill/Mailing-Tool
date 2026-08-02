import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const srcDir = fileURLToPath(new URL('../', import.meta.url));

type Manifest = {
  exports: Record<string, string>;
  dependencies: Record<string, string>;
};

function manifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

/** Domény, které mají vlastní modul s handlery front, tedy ty, co codegen workeru hledá. */
function domainsWithJobs(): string[] {
  return readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((domain) => existsSync(join(srcDir, domain, 'jobs', 'queue-handlers.ts')))
    .sort();
}

describe('balíček @mlain/core', () => {
  /**
   * ZMĚNA PRAVIDLA, ne změkčení testu. Původní znění vyžadovalo zástupný vzor
   * s hvězdičkou uprostřed klíče (podcesta `jobs` za hvězdičkou), aby doménové
   * plány do mapy `exports` psát nemusely. Ten vzor je podle nálezu I35 ZRUŠENÝ a vrátit se
   * nesmí: Node ani esbuild neberou v potaz pořadí klíčů, rozhoduje délka
   * základu vzoru. Jakmile doména dostala vlastní vzor se svým jménem
   * (`"./ai/*"`, `"./platform/*"`), přebil obecný vzor a `@mlain/core/ai/jobs`
   * se rozvinul na soubor, který neexistuje. Vystřelilo to dvakrát a pokaždé
   * až při stavbě produkční image.
   *
   * Nové pravidlo je proto opačné: klíče se vypisují a hlídá se, že žádná
   * doména s frontami nechybí. Test má tím pádem stejné zuby jako dřív, jen
   * měří platný stav. Druhá pojistka je v `apps/worker/codegen.mjs`, aby
   * chybějící zápis padl i mimo tenhle balíček.
   */
  it('má pro každou doménu s frontami explicitní klíč, zástupný vzor se nevrátil', () => {
    const { exports: map } = manifest();
    expect(map['./*']).toBe('./src/*/index.ts');
    expect(map['./*/jobs']).toBeUndefined();

    const domains = domainsWithJobs();
    // Pojistka, že test nekontroluje prázdnou množinu.
    expect(domains.length).toBeGreaterThan(0);
    for (const domain of domains) {
      expect(map[`./${domain}/jobs`], `chybí klíč "./${domain}/jobs" v exports mapě`).toBe(
        `./src/${domain}/jobs/queue-handlers.ts`,
      );
    }
  });

  it('nemá kořenový export, aby nešlo importovat @mlain/core bez podcesty', () => {
    expect(manifest().exports['.']).toBeUndefined();
  });

  it('deklaruje @mlain/db, protože repozitářová vrstva ho importuje', () => {
    expect(manifest().dependencies['@mlain/db']).toBe('workspace:*');
  });
});

/**
 * Preflight dodavatelů. Každý řádek je podpis, na kterém stojí některý pozdější
 * úkol. Když se sem dostane chyba typu, znamená to, že se dodavatel pohnul,
 * a řeší se to s jeho vlastníkem, ne obcházením tady.
 */
describe('preflight rozhraní, ze kterých plán čte', () => {
  it('P02 dodává encryptEnvelope a decryptEnvelope s pojmenovanými argumenty', async () => {
    const crypto = await import('@mlain/contracts/crypto');
    expect(typeof crypto.encryptEnvelope).toBe('function');
    expect(typeof crypto.decryptEnvelope).toBe('function');
    expect(crypto.CREDENTIAL_CONTEXTS).toContain('ai_provider');

    // Tvar návratové hodnoty: encryptEnvelope vrací OBJEKT s polem stored,
    // ne holý řetězec. Kdo si splete jedno s druhým, uloží "[object Object]".
    const out = crypto.encryptEnvelope({
      plaintext: JSON.stringify({ apiKey: 'sk-test' }),
      context: 'ai_provider',
      workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
      keyring: new Map([[1, new Uint8Array(32).fill(7)]]),
      keyId: 1,
    });
    expect(typeof out).toBe('object');
    expect(typeof out.stored).toBe('string');
    expect(out.stored.startsWith('enc:v1:')).toBe(true);
  });

  it('P04 dodává sdílený blocklist SSRF, ze kterého staví klasifikace adres', async () => {
    const ssrf = await import('@mlain/core/net/ssrf');
    expect(Array.isArray(ssrf.BLOCKED_RANGES)).toBe(true);
    expect(ssrf.BLOCKED_RANGES).toContain('169.254.0.0/16');
    expect(typeof ssrf.isBlockedAddress).toBe('function');
  });

  it('P04 dodává transakční obálky v podobě, jakou plán volá', async () => {
    const tx = await import('@mlain/core/tx');
    expect(typeof tx.withWorkspace).toBe('function');
    expect(typeof tx.withoutContext).toBe('function');
    expect(typeof tx.withReadOnly).toBe('function');
    // withWorkspace(ctx, fn) má dva parametry, ne tři. Kdyby přibyl pool,
    // spadne tenhle řádek, ne až dvacátý dotaz.
    expect(tx.withWorkspace.length).toBe(2);
  });

  it('P03 dodává pgErrorCode, protože kód chyby NENÍ na error.code', async () => {
    const db = await import('@mlain/db');
    expect(typeof db.pgErrorCode).toBe('function');
  });

  it('P01 dodává registr front s oběma frontami tohohle plánu', async () => {
    const queues = await import('@mlain/core/queues');
    expect(queues.queue('ai.cleanup_conversations')).toBeDefined();
    expect(queues.queue('content.brand_extract')).toMatchObject({ retryLimit: 0 });
  });
});
