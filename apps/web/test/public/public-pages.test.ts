// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { keyringFromEnv } from '../../../../packages/contracts/src/keyring';
import {
  buildConfirmationRef,
  createForm,
  issueUnsubscribeToken,
  publicFormRef,
} from '@mlain/core/contacts';
import { GET as confirmGet, POST as confirmPost } from '../../src/app/(public)/s/c/[token]/route';
import {
  GET as unsubscribeGet,
  POST as unsubscribePost,
} from '../../src/app/(public)/u/[token]/route';
import {
  GET as preferencesGet,
  POST as preferencesPost,
} from '../../src/app/(public)/p/[token]/route';
import {
  GET as reactivationGet,
  POST as reactivationPost,
} from '../../src/app/(public)/r/[token]/route';
import { GET as formGet } from '../../src/app/(public)/f/[slug]/route';
import { POST as formSubmit } from '../../src/app/(public)/f/[slug]/submit/route';
import { GET as thanksGet } from '../../src/app/(public)/f/[slug]/thanks/route';
import { resetTokenRateLimit } from '../../src/features/public/rate-limit';
import {
  asMigrator,
  contactRow,
  createContact,
  createList,
  expireConfirmation,
  issueConfirmationToken,
  latestConsent,
  publicRequest,
  sentEmails,
  subscribe,
  subscriptionStatus,
  testWorkspace,
} from './harness';

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

/** Nonce z vykreslené stránky. Bez něj neprojde druhá vrstva ochrany formuláře. */
function nonceFrom(html: string): string {
  return html.match(/name="ml_nonce" value="([^"]+)"/)?.[1] ?? '';
}

beforeEach(() => {
  sentEmails.length = 0;
  resetTokenRateLimit();
});

function unsubscribeTokenFor(input: {
  workspaceId: string;
  contactId: string;
  listId: string | null;
}): string {
  return issueUnsubscribeToken({
    workspaceId: input.workspaceId,
    messageId: '00000000-0000-4000-8000-000000000001',
    contactId: input.contactId,
    listId: input.listId,
    messageCreatedAt: new Date('2026-01-01T00:00:00Z'),
    keyring: keyringFromEnv(),
  });
}

describe('KRITÉRIUM 51: GET nikdy nepotvrzuje', () => {
  it('dvoukrokový režim zobrazí tlačítko a nic nezmění', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter', confirmationMode: 'two_step' });
    await subscribe(ctx, { contactId, listId, status: 'pending' });
    const token = await issueConfirmationToken(ctx, { contactId, listId });
    const ref = buildConfirmationRef({ workspaceId: ctx.workspaceId, token });

    const response = await confirmGet(publicRequest(`/s/c/${ref}`), params({ token: ref }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<button type="submit"');
    expect(html).toContain('method="post"');
    expect(await subscriptionStatus(ctx, contactId, listId)).toBe('pending');
  }, 60_000);

  it('jednokrokový režim také nepotvrzuje na GET a načte skript', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter', confirmationMode: 'one_step' });
    await subscribe(ctx, { contactId, listId, status: 'pending' });
    const token = await issueConfirmationToken(ctx, { contactId, listId });
    const ref = buildConfirmationRef({ workspaceId: ctx.workspaceId, token });

    const html = await (
      await confirmGet(publicRequest(`/s/c/${ref}`), params({ token: ref }))
    ).text();

    // Rozhodnutí zadavatele: firemní bezpečnostní skenery samy proklikávají odkazy
    // v e-mailech, takže potvrzení na GET by ztratilo důkazní hodnotu.
    expect(await subscriptionStatus(ctx, contactId, listId)).toBe('pending');
    expect(html).toContain('src="/ml-autosubmit.js"');
    expect(html).toContain('defer');
  }, 60_000);

  it('dvoukrokový režim skript nenačítá', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter', confirmationMode: 'two_step' });
    const token = await issueConfirmationToken(ctx, { contactId, listId });
    const ref = buildConfirmationRef({ workspaceId: ctx.workspaceId, token });

    const html = await (
      await confirmGet(publicRequest(`/s/c/${ref}`), params({ token: ref }))
    ).text();
    expect(html).not.toContain('ml-autosubmit.js');
  }, 60_000);
});

describe('stavy potvrzovací stránky', () => {
  it('KRITÉRIUM 52: každý stav vrací 200, nikdy 404', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    const valid = buildConfirmationRef({
      workspaceId: ctx.workspaceId,
      token: await issueConfirmationToken(ctx, { contactId, listId }),
    });

    for (const token of [valid, 'nesmysl', 'ttttneexistuje']) {
      const response = await confirmGet(publicRequest(`/s/c/${token}`), params({ token }));
      // Kdyby neplatný token vrátil 404, dalo by se podle odpovědi zjišťovat,
      // které kontakty existují.
      expect(response.status, token).toBe(200);
    }
  }, 60_000);

  it('neplatný a neexistující token dají bajtově stejnou stránku', async () => {
    const invalid = await (
      await confirmGet(publicRequest('/s/c/nesmysl'), params({ token: 'nesmysl' }))
    ).text();
    const missing = await (
      await confirmGet(publicRequest('/s/c/ttttneexistuje'), params({ token: 'ttttneexistuje' }))
    ).text();
    expect(invalid).toBe(missing);
  }, 60_000);

  it('prošlý token nabídne odeslání nového a POST ho odešle', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'pending' });
    const token = await issueConfirmationToken(ctx, { contactId, listId });
    await expireConfirmation(ctx, contactId);
    const ref = buildConfirmationRef({ workspaceId: ctx.workspaceId, token });

    const page = await (
      await confirmGet(publicRequest(`/s/c/${ref}`), params({ token: ref }))
    ).text();
    expect(page).toContain('name="action"');
    expect(page).toContain('value="resend"');

    const response = await confirmPost(
      publicRequest(`/s/c/${ref}`, {
        method: 'POST',
        body: 'action=resend',
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token: ref }),
    );
    expect(response.status).toBe(200);
    expect(sentEmails.filter((e) => e.kind === 'confirmation')).toHaveLength(1);
  }, 60_000);
});

describe('POST potvrzuje', () => {
  it('KRITÉRIUM 51: teprve odeslání formuláře změní stav na confirmed', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'pending' });
    const ref = buildConfirmationRef({
      workspaceId: ctx.workspaceId,
      token: await issueConfirmationToken(ctx, { contactId, listId }),
    });

    const response = await confirmPost(
      publicRequest(`/s/c/${ref}`, {
        method: 'POST',
        body: '',
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token: ref }),
    );
    expect(response.status).toBe(200);
    expect(await subscriptionStatus(ctx, contactId, listId)).toBe('confirmed');
  }, 60_000);

  it('KRITÉRIUM 52: opakované odeslání vrátí 200 a hlášku, nikdy chybu', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'pending' });
    const ref = buildConfirmationRef({
      workspaceId: ctx.workspaceId,
      token: await issueConfirmationToken(ctx, { contactId, listId }),
    });
    const post = () =>
      confirmPost(
        publicRequest(`/s/c/${ref}`, {
          method: 'POST',
          body: '',
          contentType: 'application/x-www-form-urlencoded',
        }),
        params({ token: ref }),
      );

    await post();
    const second = await post();
    expect(second.status).toBe(200);
    expect(await second.text()).toMatch(/už jste přihlášeni/i);
  }, 60_000);

  it('KRITÉRIUM 63: potvrzení odstraní blokaci z dřívějšího odhlášení', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'vratil@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });

    // Nejdřív globální odhlášení, které založí blokaci.
    const unsubscribeToken = unsubscribeTokenFor({
      workspaceId: ctx.workspaceId,
      contactId,
      listId: null,
    });
    await unsubscribePost(
      publicRequest(`/u/${unsubscribeToken}`, {
        method: 'POST',
        body: 'List-Unsubscribe=One-Click',
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token: unsubscribeToken }),
    );
    const before = await asMigrator().query(
      `SELECT 1 FROM suppressions WHERE workspace_id = $1 AND removed_at IS NULL`,
      [ctx.workspaceId],
    );
    expect(before.rowCount).toBe(1);

    // Odběr zůstává ve stavu 'unsubscribed'. Právě přechod z něj je jediné místo,
    // kde stavový automat sundá blokaci: návrat musí být rozhodnutím toho člověka.
    const ref = buildConfirmationRef({
      workspaceId: ctx.workspaceId,
      token: await issueConfirmationToken(ctx, { contactId, listId }),
    });
    await confirmPost(
      publicRequest(`/s/c/${ref}`, {
        method: 'POST',
        body: '',
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token: ref }),
    );

    // Návrat musí být rozhodnutím toho člověka, ne marketéra. Blokaci proto nesundá
    // admin ani import, jen nové potvrzené přihlášení.
    const after = await asMigrator().query(
      `SELECT 1 FROM suppressions WHERE workspace_id = $1 AND removed_at IS NULL`,
      [ctx.workspaceId],
    );
    expect(after.rowCount).toBe(0);
  }, 60_000);
});

describe('layout veřejných stránek', () => {
  it('neobsahuje navigaci do aplikace, nese jméno odesílatele a má noindex', async () => {
    const ctx = await testWorkspace('Firma s.r.o.');
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    const ref = buildConfirmationRef({
      workspaceId: ctx.workspaceId,
      token: await issueConfirmationToken(ctx, { contactId, listId }),
    });

    const response = await confirmGet(publicRequest(`/s/c/${ref}`), params({ token: ref }));
    const html = await response.text();

    expect(html).not.toContain('href="/w/');
    expect(html).toContain('Firma s.r.o.');
    expect(html).toContain('noindex');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    // Stránka se otevírá na mobilu a na pomalém připojení.
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(100 * 1024);
  }, 60_000);

  it('jazyk se bere z kontaktu, ne z prohlížeče', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'en@x.cz', locale: 'en' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    const ref = buildConfirmationRef({
      workspaceId: ctx.workspaceId,
      token: await issueConfirmationToken(ctx, { contactId, listId }),
    });

    const html = await (
      await confirmGet(publicRequest(`/s/c/${ref}`), params({ token: ref }))
    ).text();
    expect(html).toContain('Confirm your subscription');
    expect(html).toContain('lang="en"');
  }, 60_000);
});

describe('KRITÉRIUM 57: GET nikoho neodhlásí', () => {
  it('zobrazí stránku a stav zůstane beze změny', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });

    const response = await unsubscribeGet(publicRequest(`/u/${token}`), params({ token }));
    expect(response.status).toBe(200);
    expect(await subscriptionStatus(ctx, contactId, listId)).toBe('confirmed');
  }, 60_000);
});

describe('KRITÉRIUM 56: POST s one-click tělem', () => {
  it('vrátí 200, NIKDY přesměrování, a skutečně odhlásí', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });

    const response = await unsubscribePost(
      publicRequest(`/u/${token}`, {
        method: 'POST',
        body: 'List-Unsubscribe=One-Click',
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token }),
    );

    // RFC 8058 bod 6: přesměrovaný POST se v prohlížečích chová nespolehlivě
    // a často se mění na GET.
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(await subscriptionStatus(ctx, contactId, listId)).toBe('unsubscribed');
    // Rozsah řídí i TEXT odpovědi: po odhlášení z jednoho seznamu se nesmí tvrdit,
    // že už nepřijde nic, protože ostatní e-maily chodí dál.
    expect(await response.text()).toMatch(/ze seznamu Newsletter/);
  }, 60_000);

  it('přijme multipart, obojí kódování uvádí RFC', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });

    const boundary = '----vitest';
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="List-Unsubscribe"\r\n\r\n' +
      `One-Click\r\n--${boundary}--\r\n`;

    const response = await unsubscribePost(
      publicRequest(`/u/${token}`, {
        method: 'POST',
        body,
        contentType: `multipart/form-data; boundary=${boundary}`,
      }),
      params({ token }),
    );
    expect(response.status).toBe(200);
    expect(await subscriptionStatus(ctx, contactId, listId)).toBe('unsubscribed');
  }, 60_000);

  it('KRITÉRIUM 82: dvě stě požadavků z jedné adresy neskončí 429', async () => {
    const ctx = await testWorkspace();
    const listId = await createList(ctx, { name: 'Newsletter' });

    // Každý požadavek nese JINÝ token, přesně jako u kampaně na sto tisíc adres.
    // Per-IP limit by je začal odmítat, poštovní klient by ukázal selhání odhlášení
    // a uživatel by místo toho označil zprávu jako spam.
    for (let i = 0; i < 200; i += 1) {
      const contactId = await createContact(ctx, { email: `hromada${i}@x.cz` });
      await subscribe(ctx, { contactId, listId, status: 'confirmed' });
      const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });
      const response = await unsubscribePost(
        publicRequest(`/u/${token}`, {
          method: 'POST',
          body: 'List-Unsubscribe=One-Click',
          contentType: 'application/x-www-form-urlencoded',
          ip: '66.102.1.1',
        }),
        params({ token }),
      );
      expect(response.status, `požadavek ${i}`).not.toBe(429);
    }
  }, 600_000);

  it('jeden token nad dvacet volání za hodinu ale omezený je', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });
    const post = () =>
      unsubscribePost(
        publicRequest(`/u/${token}`, {
          method: 'POST',
          body: 'List-Unsubscribe=One-Click',
          contentType: 'application/x-www-form-urlencoded',
        }),
        params({ token }),
      );

    for (let i = 0; i < 20; i += 1) await post();
    const response = await post();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3600');
  }, 120_000);
});

describe('KRITÉRIUM 58 a 66: rozsah odhlášení určuje text', () => {
  it('token se seznamem řekne, že ostatní e-maily chodí dál', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });

    const html = await (
      await unsubscribeGet(publicRequest(`/u/${token}`), params({ token }))
    ).text();
    expect(html).toMatch(/Odhlašujete se ze seznamu/);
    expect(html).toMatch(/Ostatní e-maily od nás vám budou chodit dál/);
    expect(html).toMatch(/Nechci od vás už nic/);
  }, 60_000);

  it('token bez seznamu řekne, že už nepřijde nic', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId: null });

    const html = await (
      await unsubscribeGet(publicRequest(`/u/${token}`), params({ token }))
    ).text();
    expect(html).toMatch(/už vám nic nepošleme|Nechci od vás už nic/i);
  }, 60_000);

  it('stránka vysvětluje zprávy, které jsou už na cestě', async () => {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });

    const html = await (
      await unsubscribeGet(publicRequest(`/u/${token}?done=1`), params({ token }))
    ).text();
    // Jedna věta, která brání nejdražší možné reakci. Bez ní vypadá zpoždění
    // jako rozbité odhlášení a příjemce sáhne po tlačítku spam.
    expect(html).toMatch(/Kdyby vám ještě dorazil e-mail/);
  }, 60_000);
});

describe('centrum předvoleb', () => {
  async function preferencesSetup() {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'jana@example.cz', firstName: 'Jana' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });
    return { ctx, contactId, listId, token };
  }

  it('maskuje adresu a obsahuje všech sedm bloků', async () => {
    const { token } = await preferencesSetup();
    const html = await (
      await preferencesGet(publicRequest(`/p/${token}`), params({ token }))
    ).text();

    expect(html).toContain('j***@example.cz');
    expect(html).not.toContain('jana@example.cz');
    for (const pattern of [
      /Nastavení pro/,
      /Newsletter/,
      /Posílat méně často/,
      /Jazyk/,
      /Odhlásit ze všeho/,
      /Stáhnout kopii/,
      /Smazat mé údaje/,
    ]) {
      expect(html, String(pattern)).toMatch(pattern);
    }
  }, 60_000);

  it('pozastavení je nabídnuté PŘED odhlášením', async () => {
    const { token } = await preferencesSetup();
    const html = await (
      await preferencesGet(publicRequest(`/p/${token}`), params({ token }))
    ).text();
    expect(html.indexOf('Posílat méně často')).toBeLessThan(html.indexOf('Odhlásit ze všeho'));
  }, 60_000);

  it('KRITÉRIUM 68: funguje bez JavaScriptu přes POST a 303', async () => {
    const { token, ctx, contactId, listId } = await preferencesSetup();
    const response = await preferencesPost(
      publicRequest(`/p/${token}`, {
        method: 'POST',
        body: 'action=snooze&days=30',
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain(`/p/${token}`);

    const { rows } = await asMigrator().query<{ snooze_until: Date | null }>(
      `SELECT snooze_until FROM list_subscriptions
        WHERE workspace_id = $1 AND contact_id = $2 AND list_id = $3`,
      [ctx.workspaceId, contactId, listId],
    );
    expect(rows[0]?.snooze_until).not.toBeNull();
  }, 60_000);

  it('změna jazyka projde a oslovení se přepočítá', async () => {
    const { token, ctx, contactId } = await preferencesSetup();
    await preferencesPost(
      publicRequest(`/p/${token}`, {
        method: 'POST',
        body: 'action=update&locale=en&first_name=Jana&last_name=Nov%C3%A1kov%C3%A1',
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token }),
    );
    const row = await contactRow(ctx, contactId);
    expect(row['locale']).toBe('en');
    // Anglické oslovení se neskloňuje, takže v něm zůstává první pád.
    expect(String(row['greeting'])).toContain('Jana');
  }, 60_000);

  it('žádost o data založí záznam podle GDPR rovnou ve stavu processing', async () => {
    const { token, ctx } = await preferencesSetup();
    const response = await preferencesPost(
      publicRequest(`/p/${token}`, {
        method: 'POST',
        body: 'action=export_data',
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token }),
    );
    expect(response.status).toBe(200);

    const { rows } = await asMigrator().query<{ type: string; status: string }>(
      `SELECT type, status FROM gdpr_requests WHERE workspace_id = $1
        ORDER BY requested_at DESC LIMIT 1`,
      [ctx.workspaceId],
    );
    expect(rows[0]?.type).toBe('access');
    // Ze stránky předvoleb je totožnost prokázaná držením tokenu z e-mailu,
    // který jsme sami odeslali, takže žádost nečeká na další ověření.
    expect(rows[0]?.status).toBe('processing');
  }, 60_000);

  it('neplatný token vede na generickou stránku, ne na chybu', async () => {
    const response = await preferencesGet(
      publicRequest('/p/nesmysl'),
      params({ token: 'nesmysl' }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/Tenhle odkaz neplatí/);
  }, 60_000);

  it('smí upravit jen pole označená jako editovatelná subjektem', async () => {
    const { token, ctx, contactId } = await preferencesSetup();
    await asMigrator().query(
      `INSERT INTO contact_fields (workspace_id, key, type, label, subject_editable, position)
       VALUES ($1, 'internal_score', 'text', '{}'::jsonb, false, 1)`,
      [ctx.workspaceId],
    );

    await preferencesPost(
      publicRequest(`/p/${token}`, {
        method: 'POST',
        body: 'action=update&attr_internal_score=999',
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token }),
    );

    const row = await contactRow(ctx, contactId);
    expect((row['attributes'] as Record<string, unknown>)['internal_score']).not.toBe('999');
  }, 60_000);
});

describe('KRITÉRIUM 83: reaktivace', () => {
  async function reactivationSetup() {
    const ctx = await testWorkspace();
    const contactId = await createContact(ctx, { email: 'spici@x.cz' });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId: null });
    return { ctx, contactId, token };
  }

  it('zapíše souhlas se zdrojem reactivation, poslední aktivitu a štítek', async () => {
    const { ctx, contactId, token } = await reactivationSetup();
    const response = await reactivationPost(
      publicRequest(`/r/${token}`, { method: 'POST' }),
      params({ token }),
    );
    expect(response.status).toBe(200);

    // Dřív tahle hodnota nebyla v CHECK omezení consents.source, takže by první
    // kliknutí spadlo na 23514 a reaktivační kampaň by po něm přestala fungovat.
    expect((await latestConsent(ctx, contactId))?.source).toBe('reactivation');
    expect((await contactRow(ctx, contactId))['last_activity_at']).not.toBeNull();

    const { rows } = await asMigrator().query<{ name: string }>(
      `SELECT t.name FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.workspace_id = $1 AND ct.contact_id = $2`,
      [ctx.workspaceId, contactId],
    );
    expect(rows.map((r) => r.name)).toEqual(['reaktivovan']);
  }, 60_000);

  it('opakované kliknutí nic nezkazí', async () => {
    const { ctx, contactId, token } = await reactivationSetup();
    const post = () =>
      reactivationPost(publicRequest(`/r/${token}`, { method: 'POST' }), params({ token }));

    await post();
    expect((await post()).status).toBe(200);

    const { rows } = await asMigrator().query<{ total: string }>(
      `SELECT count(*)::text AS total FROM contact_tags
        WHERE workspace_id = $1 AND contact_id = $2`,
      [ctx.workspaceId, contactId],
    );
    expect(rows[0]?.total).toBe('1');
  }, 60_000);

  it('GET nic nezapíše, potvrzuje až POST', async () => {
    const { ctx, contactId, token } = await reactivationSetup();
    const response = await reactivationGet(publicRequest(`/r/${token}`), params({ token }));
    expect(response.status).toBe(200);
    expect(await latestConsent(ctx, contactId)).toBeNull();
  }, 60_000);

  it('neplatný token vede na generickou stránku', async () => {
    const response = await reactivationPost(
      publicRequest('/r/nesmysl', { method: 'POST' }),
      params({ token: 'nesmysl' }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/neplatí/i);
  }, 60_000);
});

describe('KRITÉRIUM 84: formulář bez JavaScriptu', () => {
  async function formSetup(overrides: Record<string, unknown> = {}) {
    const ctx = await testWorkspace();
    const listId = await createList(ctx, { name: 'Newsletter' });
    const form = await createForm(ctx, {
      name: 'Odběr novinek',
      fields: [
        { target: 'email', label: { en: 'Email', cs: 'E-mail' }, required: true, type: 'email' },
      ],
      list_ids: [listId],
      ...overrides,
    });
    return { ctx, listId, form, ref: publicFormRef(form) };
  }

  it('hostovaná stránka nese obyčejný formulář, honeypot a nonce', async () => {
    const { ref } = await formSetup();
    const html = await (await formGet(publicRequest(`/f/${ref}`), params({ slug: ref }))).text();

    expect(html).toContain('method="post"');
    expect(html).toContain(`/f/${ref}/submit`);
    expect(html).toContain('name="website"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('name="ml_nonce"');
  }, 60_000);

  it('odeslání urlencoded odpoví 303 na děkovací stránku', async () => {
    const { ref } = await formSetup();
    const html = await (await formGet(publicRequest(`/f/${ref}`), params({ slug: ref }))).text();

    const response = await formSubmit(
      publicRequest(`/f/${ref}/submit`, {
        method: 'POST',
        body: new URLSearchParams({ email: 'j@x.cz', ml_nonce: nonceFrom(html) }).toString(),
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ slug: ref }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain(`/f/${ref}/thanks`);
  }, 60_000);

  it('odeslání JSON odpoví 200 s tělem', async () => {
    const { ref } = await formSetup();
    const html = await (await formGet(publicRequest(`/f/${ref}`), params({ slug: ref }))).text();

    const response = await formSubmit(
      publicRequest(`/f/${ref}/submit`, {
        method: 'POST',
        body: JSON.stringify({ email: 'j@x.cz', ml_nonce: nonceFrom(html) }),
        contentType: 'application/json',
      }),
      params({ slug: ref }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, double_opt_in: true });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  }, 60_000);

  it('vlastní přesměrování má přednost před děkovací stránkou', async () => {
    const { ref } = await formSetup({ redirect_url: 'https://firma.cz/dekujeme' });
    const html = await (await formGet(publicRequest(`/f/${ref}`), params({ slug: ref }))).text();

    const response = await formSubmit(
      publicRequest(`/f/${ref}/submit`, {
        method: 'POST',
        body: new URLSearchParams({ email: 'j@x.cz', ml_nonce: nonceFrom(html) }).toString(),
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ slug: ref }),
    );
    expect(response.headers.get('location')).toBe('https://firma.cz/dekujeme');
  }, 60_000);

  it('děkovací stránka se vykreslí i po obnovení', async () => {
    const { ref } = await formSetup();
    const response = await thanksGet(publicRequest(`/f/${ref}/thanks`), params({ slug: ref }));
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/Poslali jsme vám e-mail/);
  }, 60_000);
});

describe('vkládací skript', () => {
  async function scriptFor(): Promise<{ body: string; response: Response }> {
    const ctx = await testWorkspace();
    const form = await createForm(ctx, {
      name: 'Odběr',
      fields: [{ target: 'email', label: { en: 'Email' }, required: true, type: 'email' }],
    });
    const ref = `${publicFormRef(form)}.js`;
    const response = await formGet(publicRequest(`/f/${ref}`), params({ slug: ref }));
    return { body: await response.clone().text(), response };
  }

  it('vejde se do dvanácti kilobajtů po kompresi a vykresluje do zapouzdřeného stromu', async () => {
    const { body } = await scriptFor();
    expect(gzipSync(Buffer.from(body, 'utf8')).byteLength).toBeLessThan(12 * 1024);
    expect(body).toContain('attachShadow');
  }, 60_000);

  it('sám o sobě nic nesleduje', async () => {
    const { body } = await scriptFor();
    // Skript se vkládá na cizí weby a nesmí z nich odesílat nic, co si jejich
    // provozovatel nezvolil. Je oddělený od trackovacího SDK z části 5.
    for (const forbidden of ['/e/track', '/t/o/', 'sendBeacon', 'document.cookie']) {
      expect(body).not.toContain(forbidden);
    }
  }, 60_000);

  it('má hlavičky pro použití na cizí doméně', async () => {
    const { response } = await scriptFor();
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-type')).toContain('javascript');
  }, 60_000);

  it('neznámý formulář vrátí 404 a prázdné tělo', async () => {
    const slug = `${'0'.repeat(32)}neexistujiciformular1234.js`;
    const response = await formGet(publicRequest(`/f/${slug}`), params({ slug }));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  }, 60_000);
});
