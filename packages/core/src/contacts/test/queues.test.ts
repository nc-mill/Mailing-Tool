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
