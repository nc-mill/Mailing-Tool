import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { JobNotEnqueuedError, enqueueJob, jobInsert } from '../../src/queues/enqueue-sql';

const dialect = new PgDialect();

/**
 * Přeloží fragment na skutečný dotaz i s parametry.
 *
 * Jde přes `PgDialect`, ne přes vlastní procházení `queryChunks`: tvar chunků
 * je vnitřnost drizzle a při upgradu se změní pod rukama, kdežto `sqlToQuery`
 * je totéž, co použije ovladač při odeslání do databáze.
 */
function render(fragment: ReturnType<typeof jobInsert>): { text: string; values: unknown[] } {
  const query = dialect.sqlToQuery(fragment);
  return { text: query.sql.replace(/\s+/g, ' ').trim(), values: query.params };
}

describe('transakční zařazení úlohy', () => {
  it('vyplňuje policy, bez které se neslučuje nic', () => {
    // Slučovací indexy se řídí sloupcem `policy` NA ŘÁDKU ÚLOHY. Sedm ručně
    // psaných insertů v doménách ho vynechávalo, takže tam padala NULL a index
    // se na řádek nevztahoval, ať měla fronta politiku jakoukoli.
    const { text } = render(
      jobInsert({
        schema: 'pgboss',
        name: 'contacts.import',
        payload: { importId: 'i1' },
        singletonKey: 'i1',
      }),
    );
    expect(text).toContain('start_after, policy');
    expect(text).toContain('SELECT policy FROM');
  });

  it('čte politiku z databáze, ne z registru', () => {
    // Dvě pravdy o téže hodnotě by se rozešly v okamžiku, kdy někdo změní
    // registr a nerestartuje workera, a poznalo by se to zase jen tím, že se
    // přestane slučovat.
    const { text, values } = render(
      jobInsert({ schema: 'pgboss', name: 'segments.recount', payload: {}, singletonKey: 's1' }),
    );
    expect(text).toMatch(/\(SELECT policy FROM "pgboss"\.queue WHERE name = \$\d+\)/);
    expect(values).toContain('segments.recount');
    expect(values).not.toContain('short');
  });

  it('sloučenou úlohu tiše nezařadí, místo aby shodila doménovou transakci', () => {
    // Bez `ON CONFLICT DO NOTHING` by druhá úloha s týmž klíčem skončila na
    // 23505, a protože běží ve stejné transakci jako doménová změna, vzal by
    // rollback i tu změnu. Import by se nepotvrdil, kampaň neuložila.
    const { text } = render(
      jobInsert({ schema: 'pgboss', name: 'segments.recount', payload: {}, singletonKey: 's1' }),
    );
    expect(text).toContain('ON CONFLICT DO NOTHING');
  });

  it('používá skalární poddotaz, aby neexistující fronta padla nahlas', () => {
    // S `FROM queue q JOIN` by neexistující fronta znamenala nula vložených
    // řádků, tedy tiše zahozenou úlohu. Se skalárním poddotazem vyjde NULL,
    // řádek se vloží a padne cizí klíč job.name -> queue.name.
    const { text } = render(
      jobInsert({ schema: 'pgboss', name: 'segments.recount', payload: {}, singletonKey: 's1' }),
    );
    expect(text).not.toMatch(/FROM "pgboss"\.queue\s+q/);
  });

  it('bere retryLimit z registru a nechá ho přebít', () => {
    const fromRegistry = render(
      jobInsert({ schema: 'pgboss', name: 'segments.recount', payload: {}, singletonKey: 's1' }),
    );
    expect(fromRegistry.values).toContain(3);

    const overridden = render(
      jobInsert({
        schema: 'pgboss',
        name: 'contacts.import',
        payload: {},
        singletonKey: 'i1',
        retryLimit: 0,
      }),
    );
    expect(overridden.values).toContain(0);
  });

  it('odmítne zařazení bez klíče do fronty, která slučuje', () => {
    expect(() => jobInsert({ schema: 'pgboss', name: 'segments.recount', payload: {} })).toThrow(
      /má zapnuté slučování/,
    );
    // Prázdný řetězec je tentýž případ: `String(undefined)` a spol. ho vyrobí
    // snadno a statický sken producentů ho nevidí.
    expect(() =>
      jobInsert({ schema: 'pgboss', name: 'segments.recount', payload: {}, singletonKey: '' }),
    ).toThrow(/má zapnuté slučování/);
  });

  it('nechá projít frontu bez politiky i bez klíče', () => {
    // U front, kde slučování zapnuté není, je klíč v registru jen deklarovaný
    // záměr a producent ho legitimně neposílá. Vynucovat ho tady by shodilo
    // výmaz podle článku 17, který dnes klíč neposílá.
    expect(() =>
      jobInsert({ schema: 'pgboss', name: 'gdpr.erase', payload: { requestId: 'r1' } }),
    ).not.toThrow();
  });

  it('odmítne schéma, které není platný identifikátor', () => {
    expect(() =>
      jobInsert({ schema: 'pg"boss', name: 'segments.recount', payload: {}, singletonKey: 's1' }),
    ).toThrow(/není platný identifikátor/);
  });

  it('vrací id, aby šlo sloučení vůbec poznat', () => {
    // Bez `RETURNING id` vypadá zahozená úloha přesně jako zařazená a volající
    // nemá na čem stavět. Přesně tak by se ztratila kampaň, kterou uživatel
    // odeslal: kód, který ji má vrátit ze stavu `queueing`, by se nikdy nespustil.
    const { text } = render(
      jobInsert({ schema: 'pgboss', name: 'segments.recount', payload: {}, singletonKey: 's1' }),
    );
    expect(text).toMatch(/ON CONFLICT DO NOTHING RETURNING id$/);
  });
});

describe('zařazení úlohy a rozhodnutí o sloučení', () => {
  const fakeTx = (rows: unknown[]) => ({ execute: async () => ({ rows }) });
  const job = {
    schema: 'pgboss',
    name: 'segments.recount',
    payload: {},
    singletonKey: 's1',
  } as const;

  it('vrátí true, když se úloha zařadila', async () => {
    await expect(enqueueJob(fakeTx([{ id: 'x' }]), { ...job, onMerged: 'drop' })).resolves.toBe(
      true,
    );
  });

  it('se `drop` sloučení mlčky přijme', async () => {
    await expect(enqueueJob(fakeTx([]), { ...job, onMerged: 'drop' })).resolves.toBe(false);
  });

  it('se `fail` sloučení ohlásí vlastní chybou', async () => {
    // Vlastní třída, ne obyčejný Error: volající na ni reaguje jinak než na
    // výpadek databáze. Kampaň se po ní vrací ze stavu `queueing` zpátky.
    const failing = enqueueJob(fakeTx([]), { ...job, onMerged: 'fail' });
    await expect(failing).rejects.toBeInstanceOf(JobNotEnqueuedError);
    await expect(failing).rejects.toThrow(/segments\.recount/);
  });

  it('nese ve chybě frontu i klíč, aby šlo dohledat, co se srazilo', async () => {
    let error: JobNotEnqueuedError | undefined;
    try {
      await enqueueJob(fakeTx([]), { ...job, onMerged: 'fail' });
    } catch (e) {
      error = e as JobNotEnqueuedError;
    }
    expect(error?.queue).toBe('segments.recount');
    expect(error?.singletonKey).toBe('s1');
  });
});

describe('transakční zařazení úlohy, zbytek', () => {
  it('neregistrovanou frontu odmítne, ne aby ji zařadil naslepo', () => {
    expect(() => jobInsert({ schema: 'pgboss', name: 'vymyslena.fronta', payload: {} })).toThrow(
      /uzávěr S8/,
    );
  });
});
