import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WriteContactInput, WriteContactResult } from '../../contacts/repo/contacts';
import { createSystemContext } from '../../identity/context';
import { applyIdentify, type ApplyIdentifyInput } from './apply-identify';
import type { BindIdentityInput, BindOutcome } from './bind';
import { identifySigningInput } from './signature';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
/** Rozsah se do `applyIdentify` předává kontextem, ne řetězcem, viz scope.test.ts. */
const CTX = createSystemContext(WS, 'test.identify');
const ANON = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SECRET = Buffer.from('otisk-tajneho-klice', 'utf8');
const NOW = new Date('2026-08-04T12:00:00.000Z');

function sign(externalId: string, traits: Record<string, unknown>, secret = SECRET): string {
  return createHmac('sha256', secret)
    .update(identifySigningInput(externalId, traits))
    .digest('base64url');
}

type Harness = {
  writes: WriteContactInput[];
  binds: BindIdentityInput[];
  run: (
    payload: ApplyIdentifyInput['payload'],
    over?: { existing?: { id: string; email: string } | null; secrets?: Buffer[] },
  ) => ReturnType<typeof applyIdentify>;
};

function harness(): Harness {
  const writes: WriteContactInput[] = [];
  const binds: BindIdentityInput[] = [];

  return {
    writes,
    binds,
    run: (payload, over = {}) =>
      applyIdentify({
        ctx: CTX,
        anonymousId: ANON,
        payload,
        now: NOW,
        deps: {
          readSecrets: async () => over.secrets ?? [SECRET],
          findByExternalId: async () => over.existing ?? null,
          write: (async (
            _scope: unknown,
            input: WriteContactInput,
          ): Promise<WriteContactResult> => {
            writes.push(input);
            return {
              rejected: null,
              id: 'contact-1',
              inserted: true,
              allowSubscriptions: true,
              allowTags: true,
              allowConsents: true,
              suppressionReason: null,
            };
          }) as never,
          bind: (async (input: BindIdentityInput): Promise<BindOutcome> => {
            binds.push(input);
            return 'bound';
          }) as never,
        },
      }),
  };
}

describe('applyIdentify', () => {
  it('podepsané identify zapíše e-mail, jméno i zbylé traits a naváže prohlížeč', async () => {
    const h = harness();
    const traits = { email: 'jan@example.cz', first_name: 'Jan', orders: 3, vip: true };
    const result = await h.run({
      externalId: 'customer_8472',
      traits,
      signature: sign('customer_8472', traits),
    });

    expect(result.outcome).toBe('applied');
    expect(result.contactId).toBe('contact-1');
    expect(h.writes[0]).toMatchObject({
      email: 'jan@example.cz',
      firstName: 'Jan',
      externalId: 'customer_8472',
      attributes: { orders: 3, vip: true },
      mode: 'update',
    });
    expect(h.binds[0]).toMatchObject({
      anonymousId: ANON,
      contactId: 'contact-1',
      source: 'sdk_identify',
      evidence: { external_id: 'customer_8472', signed: true },
    });
  });

  it('podpis pro jiná traits nezapíše NIC, ani nepodezřelou část', async () => {
    const h = harness();
    const result = await h.run({
      externalId: 'customer_8472',
      traits: { email: 'utocnik@example.cz', orders: 3 },
      signature: sign('customer_8472', { orders: 3 }),
    });

    expect(result.outcome).toBe('signature_invalid');
    expect(h.writes).toEqual([]);
    expect(h.binds).toEqual([]);
  });

  it('podpis vyrobený jiným klíčem projektu neprojde', async () => {
    const h = harness();
    const traits = { email: 'jan@example.cz' };
    const result = await h.run(
      { externalId: 'c1', traits, signature: sign('c1', traits, Buffer.from('cizi')) },
      { secrets: [SECRET] },
    );
    expect(result.outcome).toBe('signature_invalid');
  });

  it('podpis vyrobený druhým platným klíčem projektu projde', async () => {
    const h = harness();
    const second = Buffer.from('druhy-otisk', 'utf8');
    const traits = { email: 'jan@example.cz' };
    const result = await h.run(
      { externalId: 'c1', traits, signature: sign('c1', traits, second) },
      { secrets: [SECRET, second] },
    );
    expect(result.outcome).toBe('applied');
  });

  it('projekt bez jediného tajného klíče nemá čím ověřit a podpis neuzná', async () => {
    const h = harness();
    const traits = { email: 'jan@example.cz' };
    const result = await h.run(
      { externalId: 'c1', traits, signature: sign('c1', traits) },
      { secrets: [] },
    );
    expect(result.outcome).toBe('signature_invalid');
  });

  it('nepodepsané identify s osobním údajem se odmítne i tady, ne jen v příjmu', async () => {
    const h = harness();
    const result = await h.run({ externalId: 'c1', traits: { email: 'jan@example.cz' } });
    expect(result.outcome).toBe('unsigned_pii');
    expect(h.writes).toEqual([]);
  });

  it('nepodepsané identify na neznámý identifikátor kontakt NEZALOŽÍ', async () => {
    const h = harness();
    const result = await h.run({ externalId: 'neznamy', traits: { orders: 3 } });
    expect(result.outcome).toBe('contact_not_found');
    expect(h.writes).toEqual([]);
    expect(h.binds).toEqual([]);
  });

  it('nepodepsané identify na známý identifikátor zapíše traits a e-mail nechá být', async () => {
    const h = harness();
    const result = await h.run(
      { externalId: 'customer_1', traits: { first_name: 'Jan', orders: 7 } },
      { existing: { id: 'contact-1', email: 'puvodni@example.cz' } },
    );

    expect(result.outcome).toBe('applied');
    expect(h.writes[0]).toMatchObject({
      email: 'puvodni@example.cz',
      firstName: 'Jan',
      attributes: { orders: 7 },
    });
    expect(h.binds[0]?.evidence).toMatchObject({ signed: false });
  });

  /**
   * Telefon je osobní údaj bez ohledu na to, ve kterém sloupci by skončil.
   * Nepodepsané volání se proto odmítá CELÉ, ne že by se z něj telefon vyzobl
   * a zbytek uložil: to by byla ochrana proti podvržení jen napůl.
   */
  it('nepodepsané traits s telefonem mezi ostatními se odmítnou celé', async () => {
    const h = harness();
    const result = await h.run(
      { externalId: 'customer_1', traits: { orders: 3, telefon: '+420777123456' } },
      { existing: { id: 'contact-1', email: 'puvodni@example.cz' } },
    );
    expect(result.outcome).toBe('unsigned_pii');
    expect(h.writes).toEqual([]);
  });

  it('podepsané volání telefon do attributes uloží', async () => {
    const h = harness();
    const traits = { orders: 3, telefon: '+420777123456' };
    await h.run(
      { externalId: 'customer_1', traits, signature: sign('customer_1', traits) },
      { existing: { id: 'contact-1', email: 'puvodni@example.cz' } },
    );
    expect(h.writes[0]?.attributes).toEqual({ orders: 3, telefon: '+420777123456' });
  });

  it('podepsané identify bez e-mailu na neznámý identifikátor kontakt nezaloží', async () => {
    const h = harness();
    const traits = { first_name: 'Jan' };
    const result = await h.run({
      externalId: 'neznamy',
      traits,
      signature: sign('neznamy', traits),
    });
    expect(result.outcome).toBe('contact_not_found');
    expect(h.writes).toEqual([]);
  });

  it('bez anonymního ID se traits zapíšou, ale žádná vazba nevznikne', async () => {
    const writes: WriteContactInput[] = [];
    const result = await applyIdentify({
      ctx: CTX,
      anonymousId: null,
      payload: { externalId: 'customer_1', traits: { orders: 3 } },
      now: NOW,
      deps: {
        readSecrets: async () => [SECRET],
        findByExternalId: async () => ({ id: 'contact-1', email: 'a@b.cz' }),
        write: (async (_scope: unknown, input: WriteContactInput) => {
          writes.push(input);
          return {
            rejected: null,
            id: 'contact-1',
            inserted: false,
            allowSubscriptions: true,
            allowTags: true,
            allowConsents: true,
            suppressionReason: null,
          };
        }) as never,
        bind: (async () => {
          throw new Error('vazba se dělat neměla');
        }) as never,
      },
    });

    expect(result.outcome).toBe('applied');
    expect(result.bind).toBeNull();
    expect(writes).toHaveLength(1);
  });

  it('kontakt na suppression listu se neváže', async () => {
    const binds: BindIdentityInput[] = [];
    const result = await applyIdentify({
      ctx: CTX,
      anonymousId: ANON,
      payload: { externalId: 'customer_1', traits: {} },
      now: NOW,
      deps: {
        readSecrets: async () => [SECRET],
        findByExternalId: async () => ({ id: 'contact-1', email: 'a@b.cz' }),
        write: (async () => ({
          rejected: 'suppressed',
          id: null,
          inserted: false,
          allowSubscriptions: false,
          allowTags: false,
          allowConsents: false,
          suppressionReason: 'complaint',
        })) as never,
        bind: (async (input: BindIdentityInput) => {
          binds.push(input);
          return 'bound';
        }) as never,
      },
    });

    expect(result.outcome).toBe('suppressed');
    expect(binds).toEqual([]);
  });
});
