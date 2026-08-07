import { describe, expect, it } from 'vitest';
import { CONTACTS_QUEUES } from '../queues';

describe('registr front domény kontaktů', () => {
  it('každý název má tvar domena.akce', () => {
    for (const name of Object.keys(CONTACTS_QUEUES)) {
      expect(name).toMatch(/^(contacts|contact_fields|consents|gdpr|inbound|retention)\.[a-z_]+$/);
    }
  });

  it('každá fronta má explicitní retryLimit a expireInSeconds', () => {
    for (const [name, opts] of Object.entries(CONTACTS_QUEUES)) {
      expect(typeof opts.retryLimit, name).toBe('number');
      expect(typeof opts.expireInSeconds, name).toBe('number');
      expect(opts.expireInSeconds, name).toBeGreaterThan(0);
    }
  });

  it('import kontaktů tady není, patří plánu P11', () => {
    expect(CONTACTS_QUEUES).not.toHaveProperty('contacts.import');
  });

  it('fronty, které smí trvale selhat, mají dead letter frontu', () => {
    for (const [name, opts] of Object.entries(CONTACTS_QUEUES)) {
      if (opts.retryLimit > 0) {
        expect('deadLetter' in opts ? opts.deadLetter : undefined, name).toBe(`${name}.dlq`);
      }
    }
  });

  it('každá fronta má popsané, čím je její handler idempotentní', () => {
    for (const [name, opts] of Object.entries(CONTACTS_QUEUES)) {
      expect(opts.idempotency.length, name).toBeGreaterThan(20);
    }
  });

  /**
   * BRÁNA PROTI TICHÉMU DRIFTU MEZI DVĚMA VÝČTY.
   *
   * Doména posílá své hodnoty do řádku úlohy (`jobs/enqueue.ts`), takže při rozchodu
   * platí ONA, ne registr. Rozdíl se proto nikde neprojeví jako chyba, jen jako jiné
   * chování, než jaké slibuje registr. Expirace se srovnaly a drží se srovnané.
   */
  it('expirace se u každé fronty shoduje se sdíleným registrem', async () => {
    const { QUEUE_REGISTRY } = await import('../../queues/index');
    const byName = new Map(QUEUE_REGISTRY.map((q) => [q.name, q]));
    for (const [name, opts] of Object.entries(CONTACTS_QUEUES)) {
      const entry = byName.get(name);
      expect(entry, `fronta ${name} chybí v registru P01`).toBeDefined();
      expect(opts.expireInSeconds, `expirace fronty ${name}`).toBe(entry?.expireInSeconds);
    }
  });

  /**
   * Zbylé rozdíly jsou v POČTU POKUSŮ, ne v expiraci, a nechaly se schválně: mění
   * chování při selhání. Výčet je uzavřený, aby další rozdíl nemohl přibýt bez
   * rozhodnutí.
   *
   * `gdpr.erase` v něm ZÁMĚRNĚ NENÍ, ačkoli dřív byl. Srovnal se na registr, protože
   * jeho nula pokusů nebyla opatrnost před opakovaným výmazem (obsluha je idempotentní
   * a druhý běh neudělá nic), ale tichá ztráta výmazu podle článku 17. Kdyby se sem
   * někdy vrátil, spadne tenhle test a bude to muset někdo obhájit.
   */
  it('rozdíly v politice opakování jsou jen ty vyjmenované', async () => {
    const { QUEUE_REGISTRY } = await import('../../queues/index');
    const byName = new Map(QUEUE_REGISTRY.map((q) => [q.name, q]));
    const known = new Set([
      // doména 5, registr 3: rotace klíče je běh přes celý projekt a operátor ji pouští ručně
      'contacts.refingerprint',
      // doména 0, registr 3: nevratné mazání, doména opakování schválně nechce
      'contacts.bulk_delete',
      // doména 2, registr 3
      'gdpr.export_subject',
      // doména 3, registr 5: fronta dnes nemá producenta, takže neplatí ani jedna hodnota
      'inbound.process',
    ]);
    const diffs = Object.entries(CONTACTS_QUEUES)
      .filter(([name, opts]) => {
        const entry = byName.get(name);
        return (
          entry !== undefined &&
          (opts.retryLimit !== entry.retryLimit || opts.retryBackoff !== entry.retryBackoff)
        );
      })
      .map(([name]) => name);
    expect(diffs.sort()).toEqual([...known].sort());
  });

  it('každá fronta téhle domény je i ve sdíleném registru front, který vlastní P01', async () => {
    // Registr front je zdroj pravdy pro workera. Kdyby se rozešel s tímhle souborem,
    // fronta by se tvářila zaregistrovaná a nikdo by ji neobsluhoval. Žádné výjimky:
    // fronta, která tady je a v registru není, je fronta bez obsluhy.
    const { QUEUE_REGISTRY } = await import('../../queues/index');
    const registered = new Set(QUEUE_REGISTRY.map((q) => q.name));
    for (const name of Object.keys(CONTACTS_QUEUES)) {
      expect(registered.has(name), `fronta ${name} chybí v registru P01`).toBe(true);
    }
  });
});
