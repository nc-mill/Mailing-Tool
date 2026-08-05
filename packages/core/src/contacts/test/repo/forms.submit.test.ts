import { keyringFromEnv } from '@mlain/contracts/keyring';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import { FormDefinitionSchema } from '../../forms/definition';
import { buildEmbedSnippets } from '../../forms/embed';
import { issueNonce } from '../../forms/nonce';
import { createFormRateLimiter, DEFAULT_FORM_RATE_LIMIT } from '../../forms/rate-limit';
import { submitForm, type SubmitInput } from '../../forms/submit';
import { registerSubscriptionEmails, resetSubscriptionEmails } from '../../lists/subscribe-service';
import { addSuppression } from '../../repo/suppressions';
import { createForm, lastSubmission, loadPublicForm, publicFormRef } from '../../repo/forms';
import {
  asMigrator,
  countContacts,
  createActiveContact,
  createList,
  createSubscription,
  findByEmailOrNull,
  testContext,
} from '../support/db';
import { one, setPrivacy, subscriptionStatus } from '../support/phase-c';

/**
 * ODCHYLKA OD PLÁNU. Tenhle blok stál v plánu na začátku `test/forms/definition.test.ts`,
 * tedy v čistém unit testu bez kontejneru. Ptá se ale databáze, takže by ten soubor
 * prodloužil o start PostgreSQL. Přesunul se sem, kde kontejner stejně běží.
 */
describe('legal_basis versus databáze', () => {
  it('zod výčet formuláře se shoduje s ck_consents__legal_basis', async () => {
    // forms.legal_basis nemá ve schématu vlastní CHECK, ale teče přímo do
    // consents.legal_basis, které ho má. Bez téhle kontroly by se neplatná hodnota
    // projevila až při odeslání formuláře v produkci jako 23514 uprostřed transakce,
    // místo aby ji odmítlo uložení definice.
    const { rows } = await asMigrator().query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conname = 'ck_consents__legal_basis'`,
    );
    expect(rows, 'omezení ck_consents__legal_basis ve schématu není').toHaveLength(1);
    const allowed = [...rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const zodValues = [...FormDefinitionSchema.shape.legal_basis.unwrap().options].sort();
    expect(zodValues).toEqual(allowed);
  }, 60_000);

  it('reactivation je v ck_consents__source, jinak kritérium 83 spadne na 23514', async () => {
    const { rows } = await asMigrator().query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conname = 'ck_consents__source'`,
    );
    expect(rows[0]!.def).toContain("'reactivation'");
  }, 60_000);
});

type SentEmail = { kind: 'confirmation' | 'welcome'; contactId: string };
let sent: SentEmail[] = [];

beforeEach(() => {
  sent = [];
  registerSubscriptionEmails({
    async sendConfirmation(input) {
      sent.push({ kind: 'confirmation', contactId: input.contactId });
    },
    async sendWelcome(input) {
      sent.push({ kind: 'welcome', contactId: input.contactId });
    },
    async deliverRequestedItem() {},
  });
});

afterEach(() => {
  resetSubscriptionEmails();
});

async function formWithList(
  ctx: WorkspaceContext,
  overrides: Record<string, unknown> = {},
): Promise<{ ref: string; id: string; listId: string }> {
  const list = await createList(ctx, { name: `Newsletter ${Math.random()}`, optIn: 'double' });
  const form = await createForm(ctx, {
    name: 'Newsletter',
    fields: [{ target: 'email', label: { en: 'Email' }, required: true, type: 'email' }],
    list_ids: [list.id],
    ...overrides,
  });
  return { ref: publicFormRef(form), id: form.id, listId: list.id };
}

function submission(formId: string, email: string, extra: Partial<SubmitInput> = {}): SubmitInput {
  return {
    fields: { email },
    origin: null,
    nonce: issueNonce(keyringFromEnv(), { formId, ip: '1.2.3.4' }).value,
    ip: '1.2.3.4',
    userAgent: 'vitest',
    pageUrl: 'https://firma.cz/newsletter',
    elapsedSeconds: 5,
    contentType: 'application/json',
    ...extra,
  };
}

/** Vlastní limiter pro každé volání, aby jeden test neubíral strop druhému. */
function generous() {
  return createFormRateLimiter({ perIpMinute: 1000, perIpHour: 1000, perFormMinute: 1000 });
}

async function send(
  ref: string,
  input: SubmitInput,
  limiter = generous(),
): Promise<Awaited<ReturnType<typeof submitForm>>> {
  const form = await loadPublicForm(ref);
  expect(form, `formulář ${ref} se nenačetl`).not.toBeNull();
  return submitForm(form!, input, { limiter });
}

const UNIFORM = { ok: true, double_opt_in: true };

describe('KRITÉRIUM 89 a rozhodnutí R9: jednotná odpověď', () => {
  it('nový kontakt vznikne a odejde potvrzovací e-mail', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx);
    const result = await send(form.ref, submission(form.id, 'novy@x.cz'));
    expect(result.response).toEqual(UNIFORM);
    expect(sent.filter((e) => e.kind === 'confirmation')).toHaveLength(1);
  }, 60_000);

  it('dříve odhlášený projde znovu potvrzením', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx);
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await createSubscription(ctx, {
      contactId: contact.id,
      listId: form.listId,
      status: 'unsubscribed',
    });

    const result = await send(form.ref, submission(form.id, 'j@x.cz'));
    expect(result.response).toEqual(UNIFORM);
    expect(await subscriptionStatus(ctx, contact.id, form.listId)).toBe('pending');
  }, 60_000);

  it('už potvrzený kontakt NEDOSTANE druhý potvrzovací e-mail', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx);
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await createSubscription(ctx, {
      contactId: contact.id,
      listId: form.listId,
      status: 'confirmed',
    });

    const result = await send(form.ref, submission(form.id, 'j@x.cz'));
    // Poslat "potvrďte prosím přihlášení" člověku, který přihlášený je, vypadá jako
    // rozbitý nástroj a část lidí na to klikne s pocitem, že je někdo přihlásil
    // bez jejich vědomí.
    expect(sent).toHaveLength(0);
    expect(result.response).toEqual(UNIFORM);
  }, 60_000);

  it('KRITÉRIUM 89: adresa se stížností vrátí úspěch a nic nezapíše', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx);
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'complaint', source: 'ses' });

    const result = await send(form.ref, submission(form.id, 'j@x.cz'));
    expect(result.response).toEqual(UNIFORM);
    expect(await countContacts(ctx)).toBe(0);
    expect(sent).toHaveLength(0);
  }, 60_000);

  it('všech pět vnitřních stavů vrátí bajtově stejnou odpověď', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx);

    // a: nový, b: dříve odhlášený, c: už potvrzený, d: se stížností, e: tiše zahozený.
    const unsubscribed = await createActiveContact(ctx, 'b@x.cz');
    await createSubscription(ctx, {
      contactId: unsubscribed.id,
      listId: form.listId,
      status: 'unsubscribed',
    });
    const confirmed = await createActiveContact(ctx, 'c@x.cz');
    await createSubscription(ctx, {
      contactId: confirmed.id,
      listId: form.listId,
      status: 'confirmed',
    });
    await addSuppression(ctx, { email: 'd@x.cz', reason: 'complaint', source: 'ses' });

    const responses: string[] = [];
    for (const email of ['a@x.cz', 'b@x.cz', 'c@x.cz', 'd@x.cz']) {
      responses.push(JSON.stringify((await send(form.ref, submission(form.id, email))).response));
    }
    responses.push(
      JSON.stringify(
        (
          await send(
            form.ref,
            submission(form.id, 'e@x.cz', {
              fields: { email: 'e@x.cz', website: 'spam' },
            }),
          )
        ).response,
      ),
    );

    // Kdyby se odpověď u známé adresy lišila, stal by se z formuláře nástroj
    // na zjišťování, kdo je v databázi.
    expect(new Set(responses).size).toBe(1);
  }, 60_000);

  it('zahozené odeslání vrátí stejnou odpověď a zapíše se jako dropped', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx);
    const result = await send(
      form.ref,
      submission(form.id, 'j@x.cz', { fields: { email: 'j@x.cz', website: 'spam' } }),
    );
    expect(result.response).toEqual(UNIFORM);
    const row = await lastSubmission(ctx, form.id);
    expect(row?.status).toBe('dropped');
    expect(row?.error_code).toBe('honeypot');
  }, 60_000);

  it('chybná validace pole vrátí 422 a payload se NEULOŽÍ', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx);
    const result = await send(
      form.ref,
      submission(form.id, 'nesmysl', { fields: { email: 'nesmysl' } }),
    );
    expect(result.status).toBe(422);
    const row = await lastSubmission(ctx, form.id);
    expect(row?.status).toBe('rejected');
    expect(row?.payload).toEqual({});
  }, 60_000);

  it('zapíše souhlas s důkazem', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx, { consent_text: 'Souhlasím.' });
    await send(form.ref, submission(form.id, 'j@x.cz'));

    const contact = await findByEmailOrNull(ctx, 'j@x.cz');
    expect(contact).not.toBeNull();
    const consent = await one<{ consent_text: string; evidence: Record<string, unknown> }>(
      `SELECT consent_text, evidence FROM consents
        WHERE workspace_id = $1 AND contact_id = $2 AND source = 'form'
        ORDER BY occurred_at DESC LIMIT 1`,
      [ctx.workspaceId, contact!.id],
    );
    expect(consent.consent_text).toBe('Souhlasím.');
    expect(consent.evidence).toMatchObject({ form_id: form.id, page_url: expect.any(String) });
    expect(consent.evidence['consent_text_sha256']).toEqual(expect.any(String));
  }, 60_000);

  it('respektuje přepínač ukládání IP', async () => {
    const ctx = await testContext();
    await setPrivacy(ctx, { store_ip: false });
    const form = await formWithList(ctx, { consent_text: 'Souhlasím.' });
    await send(form.ref, submission(form.id, 'j@x.cz'));

    const contact = await findByEmailOrNull(ctx, 'j@x.cz');
    const consent = await one<{ evidence: Record<string, unknown> }>(
      `SELECT evidence FROM consents
        WHERE workspace_id = $1 AND contact_id = $2 AND source = 'form'
        ORDER BY occurred_at DESC LIMIT 1`,
      [ctx.workspaceId, contact!.id],
    );
    expect(consent.evidence['ip']).toBeNull();
    // Zbytek důkazu zůstává, bez něj by souhlas nebyl doložitelný vůbec.
    expect(consent.evidence['user_agent']).toBe('vitest');

    const row = await one<{ ip: string | null }>(
      `SELECT ip::text AS ip FROM form_submissions
        WHERE workspace_id = $1 AND form_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [ctx.workspaceId, form.id],
    );
    expect(row.ip).toBeNull();
  }, 60_000);

  it('opakované odeslání do šedesáti sekund nepošle druhý e-mail', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx);
    await send(form.ref, submission(form.id, 'j@x.cz'));
    await send(form.ref, submission(form.id, 'j@x.cz'));
    expect(sent.filter((e) => e.kind === 'confirmation')).toHaveLength(1);
  }, 60_000);

  it('KRITÉRIUM 84: odeslání formulářem odpoví 303 na děkovací stránku', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx);
    const result = await send(
      form.ref,
      submission(form.id, 'j@x.cz', { contentType: 'application/x-www-form-urlencoded' }),
    );
    expect(result.status).toBe(303);
    expect(result.location).toContain(`/f/${form.ref}/thanks`);
  }, 60_000);

  it('vlastní přesměrování má přednost před děkovací stránkou', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx, { redirect_url: 'https://firma.cz/dekujeme' });
    const result = await send(
      form.ref,
      submission(form.id, 'j@x.cz', { contentType: 'application/x-www-form-urlencoded' }),
    );
    expect(result.location).toBe('https://firma.cz/dekujeme');
  }, 60_000);
});

describe('pátá vrstva ochrany je vynucená i na cestě odeslání', () => {
  it('po vyčerpání stropu vrátí 429 a nic nezapíše do kontaktů', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx);
    const limiter = createFormRateLimiter(DEFAULT_FORM_RATE_LIMIT);

    for (let i = 0; i < DEFAULT_FORM_RATE_LIMIT.perIpMinute; i += 1) {
      await send(form.ref, submission(form.id, `spam${i}@x.cz`), limiter);
    }
    const before = await countContacts(ctx);
    const blocked = await send(form.ref, submission(form.id, 'posledni@x.cz'), limiter);

    expect(blocked.status).toBe(429);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(await countContacts(ctx)).toBe(before);
  }, 60_000);
});

describe('veřejný identifikátor formuláře', () => {
  it('cizí projekt formulář nenajde, i když zná slug', async () => {
    const ctx = await testContext();
    const other = await testContext();
    const form = await formWithList(ctx);
    const slug = form.ref.slice(32);

    const stolen = `${other.workspaceId.replaceAll('-', '')}${slug}`;
    expect(await loadPublicForm(stolen)).toBeNull();
  }, 60_000);

  it('poškozený identifikátor vrátí null, ne výjimku', async () => {
    expect(await loadPublicForm('nesmysl')).toBeNull();
    expect(await loadPublicForm('')).toBeNull();
  }, 60_000);
});

describe('kód k vložení', () => {
  it('vrátí dvě varianty', () => {
    const snippets = buildEmbedSnippets({ appUrl: 'https://app.example.com', slug: 'newsletter' });
    // Třetí, „čistě HTML formulář", zmizela: statický kód na cizím webu nemá jak
    // získat nonce, takže tiše zahazoval data (`dropped / missing_nonce`), zatímco
    // návštěvník viděl děkovací stránku. Viz hlavička `buildEmbedSnippets`.
    expect(Object.keys(snippets)).toEqual(['script', 'iframe']);
  });

  it('skriptová varianta míří na hostitelský prvek a načítá se asynchronně', () => {
    const snippets = buildEmbedSnippets({ appUrl: 'https://app.example.com', slug: 'newsletter' });
    expect(snippets.script).toContain('data-ml-form="newsletter"');
    expect(snippets.script).toContain('async');
  });

  it('ani jedna varianta nenese CSS', () => {
    const snippets = buildEmbedSnippets({ appUrl: 'https://app.example.com', slug: 'newsletter' });
    // Rozhodnutí zadavatele: vzhled si určuje web, kam se formulář vkládá.
    for (const snippet of Object.values(snippets)) {
      expect(snippet).not.toContain('style=');
      expect(snippet).not.toContain('<style');
    }
  });

  it('rámeček funguje bez JavaScriptu na straně hostitele', () => {
    const snippets = buildEmbedSnippets({ appUrl: 'https://app.example.com', slug: 'newsletter' });
    // Uvnitř běží naše stránka, která si nonce i ochrany řeší sama.
    expect(snippets.iframe).toContain('/f/newsletter');
    expect(snippets.iframe).not.toContain('<script');
  });
});

/**
 * Pravidlo 4 na souhlas z formuláře.
 *
 * Přihlášení do seznamu hlídá `subscribeToList`, souhlas s textem z definice formuláře
 * ale vzniká mimo něj. Bez vlastní kontroly by se zapsal i adrese na suppression listu,
 * takže by odesláním formuláře šlo vyrobit doklad o souhlasu člověka, který se odhlásil.
 *
 * Cesta zpět zůstává: kontakt se dostane do stavu pending a souhlas mu vznikne až
 * kliknutím na potvrzovací odkaz, tedy jeho vlastním úkonem.
 */
describe('formulář a suppression list', () => {
  const withConsent = {
    consent_text: 'Souhlasím se zasíláním novinek.',
    legal_basis: 'consent',
  };

  async function grantedConsents(ctx: WorkspaceContext, email: string): Promise<number> {
    const { rows } = await asMigrator().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM consents c JOIN contacts k ON k.id = c.contact_id
        WHERE c.workspace_id = $1 AND k.email = $2 AND c.status = 'granted'`,
      [ctx.workspaceId, email],
    );
    return Number(rows[0]?.count ?? '0');
  }

  it('blokované adrese nezapíše udělený souhlas', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx, withConsent);
    const contact = await createActiveContact(ctx, 'odhlaseny@x.cz');
    await addSuppression(ctx, {
      email: 'odhlaseny@x.cz',
      reason: 'global_unsubscribe',
      source: 'test',
    });

    const result = await send(form.ref, submission(form.id, 'odhlaseny@x.cz'));

    expect(result.response).toEqual(UNIFORM);
    expect(await grantedConsents(ctx, 'odhlaseny@x.cz')).toBe(0);
    expect(await subscriptionStatus(ctx, contact.id, form.listId)).toBe('pending');
  }, 60_000);

  it('adrese bez blokace souhlas zapíše', async () => {
    const ctx = await testContext();
    const form = await formWithList(ctx, withConsent);

    await send(form.ref, submission(form.id, 'cisty@x.cz'));

    expect(await grantedConsents(ctx, 'cisty@x.cz')).toBe(1);
  }, 60_000);
});
