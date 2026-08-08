// @vitest-environment node
/**
 * NAVRŽENÉ VEŘEJNÉ STRÁNKY na veřejných trasách.
 *
 * Body 14 až 18 z oddílu 6.4 plánu
 * (docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md) plus
 * odhlašovací stránka a pád vykreslení.
 *
 * Testuje se proti skutečné databázi a přes route handlery, ne přes atrapy:
 * chráníme přesně to, co uvidí příjemce e-mailu, včetně hlaviček a včetně toho,
 * co se v databázi opravdu stalo.
 */
import { describe, expect, it } from 'vitest';
import { keyringFromEnv } from '../../../../packages/contracts/src/keyring';
import { buildConfirmationRef, createForm, issueUnsubscribeToken } from '@mlain/core/contacts';
import { publicFormRef } from '@mlain/core/contacts';
import { POST as confirmPost } from '../../src/app/(public)/s/c/[token]/route';
import { GET as thanksGet } from '../../src/app/(public)/f/[slug]/thanks/route';
import { POST as formSubmit } from '../../src/app/(public)/f/[slug]/submit/route';
import { GET as formGet } from '../../src/app/(public)/f/[slug]/route';
import {
  GET as unsubscribeGet,
  POST as unsubscribePost,
} from '../../src/app/(public)/u/[token]/route';
import {
  createBrokenPageTemplate,
  createContact,
  createList,
  createPageTemplate,
  createSenderIdentity,
  issueConfirmationToken,
  pageDocument,
  publicRequest,
  setListPages,
  subscribe,
  subscriptionStatus,
  testWorkspace,
} from './harness';

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

/**
 * Viditelný text stránky bez značek.
 *
 * Emitor sází každý úsek odstavce do vlastního `<span>`, takže věta s proměnnou
 * je v HTML rozsekaná („<span>Píše vám </span><span>Firma</span>"). Návštěvník
 * ji přitom vidí vcelku a testovat se má to, co vidí on.
 */
function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nonceFrom(html: string): string {
  return html.match(/name="ml_nonce" value="([^"]+)"/)?.[1] ?? '';
}

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

/** Formulář s vlastní děkovací stránkou, nebo bez ní. */
async function formWithPage(pages: Record<string, string | null> = {}) {
  const ctx = await testWorkspace('Firma s.r.o.');
  await createSenderIdentity(ctx, 'Novinky od Firmy');
  const listId = await createList(ctx, { name: 'Newsletter' });
  const form = await createForm(ctx, {
    name: 'Odběr novinek',
    fields: [
      { target: 'email', label: { en: 'Email', cs: 'E-mail' }, required: true, type: 'email' },
    ],
    list_ids: [listId],
    // Časová past je v testu na obtíž: požadavek odejde okamžitě po vykreslení
    // stránky a ochrana by ho zahodila jako příliš rychlý.
    min_fill_seconds: 0,
    ...pages,
  });
  return { ctx, listId, form, ref: publicFormRef(form) };
}

describe('bod 14: děkovací stránka s návrhem vykreslí obsah dokumentu', () => {
  it('místo vestavěné věty ukáže text autora i dosazené proměnné', async () => {
    const ctx = await testWorkspace('Firma s.r.o.');
    await createSenderIdentity(ctx, 'Novinky od Firmy');
    const listId = await createList(ctx, { name: 'Newsletter' });
    const pageId = await createPageTemplate(ctx, {
      name: 'Děkujeme',
      document: pageDocument({
        name: 'Děkujeme',
        paragraphs: [
          'Tohle je náš vlastní návrh.',
          'Píše vám {{ workspace.name }} kvůli seznamu {{ data.list_name }} z formuláře {{ data.form_name }}.',
        ],
      }),
    });
    const form = await createForm(ctx, {
      name: 'Odběr novinek',
      fields: [
        { target: 'email', label: { en: 'Email', cs: 'E-mail' }, required: true, type: 'email' },
      ],
      list_ids: [listId],
      thanks_template_id: pageId,
    });
    const ref = publicFormRef(form);

    const response = await thanksGet(publicRequest(`/f/${ref}/thanks`), params({ slug: ref }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(textOf(html)).toContain('Tohle je náš vlastní návrh.');
    expect(textOf(html)).toContain(
      'Píše vám Novinky od Firmy kvůli seznamu Newsletter z formuláře Odběr novinek.',
    );
    // Dokument nahrazuje CELOU bílou kartu (rozhodnutí zadavatele 0.1), takže
    // po obalu aplikace nesmí zůstat ani stopa.
    expect(html).not.toContain('ml-public__card');
    // Vestavěná věta se nesmí objevit vedle návrhu.
    expect(html).not.toContain('Poslali jsme vám e-mail s odkazem');
  }, 60_000);
});

describe('bod 15: navržená stránka drží všechna dnešní pravidla', () => {
  it('noindex, žádný JavaScript, pod 100 kB a jazyk projektu, ne prohlížeče', async () => {
    const ctx = await testWorkspace('Firma s.r.o.');
    await createSenderIdentity(ctx, 'Novinky od Firmy');
    const listId = await createList(ctx, { name: 'Newsletter' });
    const pageId = await createPageTemplate(ctx, {
      name: 'Děkujeme',
      document: pageDocument({ name: 'Děkujeme', paragraphs: ['Tohle je náš vlastní návrh.'] }),
    });
    const form = await createForm(ctx, {
      name: 'Odběr novinek',
      fields: [
        { target: 'email', label: { en: 'Email', cs: 'E-mail' }, required: true, type: 'email' },
      ],
      list_ids: [listId],
      thanks_template_id: pageId,
    });
    const ref = publicFormRef(form);

    const response = await thanksGet(
      // Prohlížeč hlásí němčinu. Stránka se tím řídit NESMÍ: člověk přišel
      // z formuláře projektu, který mluví česky.
      publicRequest(`/f/${ref}/thanks`, { headers: { 'accept-language': 'de-DE,de;q=0.9' } }),
      params({ slug: ref }),
    );
    const html = await response.text();

    expect(html).toContain('noindex');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('cache-control')).toContain('no-store');
    // Ani vložený skript, ani odkaz na externí soubor: politika obsahu by je
    // zablokovala a stránka by se rozsypala až u návštěvníka.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('rel="stylesheet"');
    // N5: politika obsahu jde i sem, protože navrženou stránku vydává tentýž
    // `publicHtmlResponse`. A hlavně SMÍ TU BÝT: dokument z Builderu má styly
    // vložené přímo ve značkách, takže `style-src` bez `unsafe-inline` by ho
    // zabil, aniž by o tom kdokoliv z nás věděl.
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(html).toMatch(/style="/);
    // Jazyk nese dokument, který v Builderu vznikl v jazyce projektu. Hlavička
    // prohlížeče do toho nemluví, viz komentář u požadavku výš.
    expect(html).toContain('lang="cs"');
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(100 * 1024);
  }, 60_000);
});

describe('bod 16: jméno projektu se na navržené stránce neobjeví', () => {
  /**
   * Nález zadavatele ze 7. 8. 2026: jméno projektu je jeho osobní věc („Petr
   * Osobní projekt"), na veřejné stránce smí být jen jméno odesílatele. Test
   * schválně používá `{{ workspace.name }}`, tedy tu proměnnou, která v e-mailu
   * název projektu nese: na stránce se musí dosadit odesílatel.
   */
  it('proměnná workspace.name dosadí odesílatele, ne projekt', async () => {
    const ctx = await testWorkspace('Petr Osobní projekt');
    await createSenderIdentity(ctx, 'Novinky od Petra');
    const listId = await createList(ctx, { name: 'Newsletter' });
    const pageId = await createPageTemplate(ctx, {
      name: 'Děkujeme',
      document: pageDocument({ name: 'Děkujeme', paragraphs: ['Posílá {{ workspace.name }}.'] }),
    });
    const form = await createForm(ctx, {
      name: 'Odběr novinek',
      fields: [
        { target: 'email', label: { en: 'Email', cs: 'E-mail' }, required: true, type: 'email' },
      ],
      list_ids: [listId],
      thanks_template_id: pageId,
    });
    const ref = publicFormRef(form);

    const html = await (
      await thanksGet(publicRequest(`/f/${ref}/thanks`), params({ slug: ref }))
    ).text();

    // Obě tvrzení jsou nutná: kdyby zůstalo jen to kladné, prošlo by i vykreslení,
    // které ukáže obě jména vedle sebe.
    expect(textOf(html)).toContain('Posílá Novinky od Petra.');
    expect(html).not.toContain('Petr Osobní projekt');
  }, 60_000);
});

describe('bod 17: stránka po potvrzení vykreslí návrh A přihlášení se potvrdí', () => {
  it('návrh nezastíní vedlejší účinek', async () => {
    const ctx = await testWorkspace('Firma s.r.o.');
    await createSenderIdentity(ctx, 'Novinky od Firmy');
    const contactId = await createContact(ctx, { email: 'j@x.cz', firstName: 'Jana' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'pending' });
    const pageId = await createPageTemplate(ctx, {
      name: 'Hotovo',
      document: pageDocument({
        name: 'Hotovo',
        paragraphs: ['Vítejte mezi námi, {{ contact.first_name }}.'],
      }),
    });
    await setListPages(ctx, listId, { confirmed: pageId });
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
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(textOf(html)).toContain('Vítejte mezi námi, Jana.');
    // Tohle je to podstatné: vzhled se povedl, ale rozhoduje zápis.
    expect(await subscriptionStatus(ctx, contactId, listId)).toBe('confirmed');
  }, 60_000);
});

describe('bod 18: bez návrhu se vykreslí dnešní věta, znak po znaku', () => {
  it('děkovací stránka', async () => {
    const { ref } = await formWithPage();
    const html = await (
      await thanksGet(publicRequest(`/f/${ref}/thanks`), params({ slug: ref }))
    ).text();

    expect(html).toContain('Poslali jsme vám e-mail s odkazem');
    expect(html).toContain(
      'Přihlášení dokončíte kliknutím na odkaz v e-mailu, který jsme právě odeslali.',
    );
  }, 60_000);

  it('stránka po potvrzení', async () => {
    const ctx = await testWorkspace('Firma s.r.o.');
    await createSenderIdentity(ctx, 'Novinky od Firmy');
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'pending' });
    const ref = buildConfirmationRef({
      workspaceId: ctx.workspaceId,
      token: await issueConfirmationToken(ctx, { contactId, listId }),
    });

    const html = await (
      await confirmPost(
        publicRequest(`/s/c/${ref}`, {
          method: 'POST',
          body: '',
          contentType: 'application/x-www-form-urlencoded',
        }),
        params({ token: ref }),
      )
    ).text();

    expect(html).toContain('Hotovo, přihlášení je potvrzené');
    expect(html).toContain('Od teď vám budeme posílat Newsletter.');
  }, 60_000);

  it('stránka po odhlášení', async () => {
    const ctx = await testWorkspace('Firma s.r.o.');
    await createSenderIdentity(ctx, 'Novinky od Firmy');
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });

    const html = await (
      await unsubscribeGet(publicRequest(`/u/${token}?done=1`), params({ token }))
    ).text();

    expect(html).toContain('Hotovo, ze seznamu Newsletter jsme vás odhlásili.');
  }, 60_000);
});

describe('odhlašovací stránka s návrhem', () => {
  async function unsubscribeSetup(pageId: string | null) {
    const ctx = await testWorkspace('Firma s.r.o.');
    await createSenderIdentity(ctx, 'Novinky od Firmy');
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });
    if (pageId !== null) await setListPages(ctx, listId, { unsubscribed: pageId });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });
    return { ctx, contactId, listId, token };
  }

  it('po odhlášení ukáže návrh seznamu', async () => {
    const ctx = await testWorkspace('Firma s.r.o.');
    await createSenderIdentity(ctx, 'Novinky od Firmy');
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });
    const pageId = await createPageTemplate(ctx, {
      name: 'Mrzí nás to',
      document: pageDocument({
        name: 'Mrzí nás to',
        paragraphs: [
          'Mrzí nás to, {{ contact.email }}. Ze seznamu {{ data.list_name }} jste pryč.',
        ],
      }),
    });
    await setListPages(ctx, listId, { unsubscribed: pageId });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });

    const posted = await unsubscribePost(
      publicRequest(`/u/${token}`, {
        method: 'POST',
        body: new URLSearchParams({ action: 'unsubscribe_list' }).toString(),
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token }),
    );
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/u/${token}?done=1`);
    expect(await subscriptionStatus(ctx, contactId, listId)).toBe('unsubscribed');

    const html = await (
      await unsubscribeGet(publicRequest(`/u/${token}?done=1`), params({ token }))
    ).text();
    expect(textOf(html)).toContain('Mrzí nás to, j@x.cz. Ze seznamu Newsletter jste pryč.');
    expect(html).not.toContain('Hotovo, ze seznamu Newsletter jsme vás odhlásili.');
  }, 60_000);

  it('stránka PŘED odhlášením zůstává vestavěná, protože nese tlačítko', async () => {
    const { ctx, listId, token } = await unsubscribeSetup(null);
    const pageId = await createPageTemplate(ctx, {
      name: 'Mrzí nás to',
      document: pageDocument({ name: 'Mrzí nás to', paragraphs: ['Mrzí nás to.'] }),
    });
    await setListPages(ctx, listId, { unsubscribed: pageId });

    const html = await (
      await unsubscribeGet(publicRequest(`/u/${token}`), params({ token }))
    ).text();

    expect(html).not.toContain('Mrzí nás to.');
    expect(html).toContain('Odhlásit se');
  }, 60_000);
});

describe('pád vykreslení nesmí zvrátit odhlášení', () => {
  /**
   * Rozbitý dokument je náhražka za budoucí neshodu verzí schématu. Podstatné
   * není, JAK se rozbil, ale že se člověk odhlásil a musí to tak zůstat, i když
   * z návrhu nezbude nic.
   */
  it('spadne na vestavěnou stránku a potvrzení zůstane zapsané', async () => {
    const ctx = await testWorkspace('Firma s.r.o.');
    await createSenderIdentity(ctx, 'Novinky od Firmy');
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'pending' });
    await setListPages(ctx, listId, { confirmed: await createBrokenPageTemplate(ctx) });
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
    const html = await response.text();

    // Potvrzení a vykreslení jsou v JEDNOM požadavku, takže tohle je ta ostrá
    // varianta pravidla „návrh nesmí zastínit vedlejší účinek".
    expect(response.status).toBe(200);
    expect(html).toContain('Hotovo, přihlášení je potvrzené');
    expect(await subscriptionStatus(ctx, contactId, listId)).toBe('confirmed');
  }, 60_000);

  it('spadne na vestavěnou stránku a odhlášení zůstane zapsané', async () => {
    const ctx = await testWorkspace('Firma s.r.o.');
    await createSenderIdentity(ctx, 'Novinky od Firmy');
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    const listId = await createList(ctx, { name: 'Newsletter' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });
    await setListPages(ctx, listId, { unsubscribed: await createBrokenPageTemplate(ctx) });
    const token = unsubscribeTokenFor({ workspaceId: ctx.workspaceId, contactId, listId });

    await unsubscribePost(
      publicRequest(`/u/${token}`, {
        method: 'POST',
        body: new URLSearchParams({ action: 'unsubscribe_list' }).toString(),
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ token }),
    );

    const response = await unsubscribeGet(publicRequest(`/u/${token}?done=1`), params({ token }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Hotovo, ze seznamu Newsletter jsme vás odhlásili.');
    expect(await subscriptionStatus(ctx, contactId, listId)).toBe('unsubscribed');
  }, 60_000);
});

describe('větev „už jste přihlášeni"', () => {
  async function submitTwice(pages: Record<string, string | null>) {
    const setup = await formWithPage(pages);
    const html = await (
      await formGet(publicRequest(`/f/${setup.ref}`), params({ slug: setup.ref }))
    ).text();
    const send = () =>
      formSubmit(
        publicRequest(`/f/${setup.ref}/submit`, {
          method: 'POST',
          body: new URLSearchParams({ email: 'j@x.cz', ml_nonce: nonceFrom(html) }).toString(),
          contentType: 'application/x-www-form-urlencoded',
        }),
        params({ slug: setup.ref }),
      );
    return { ...setup, send };
  }

  it('odeslání potvrzenou adresou vede na návrh, když si ho autor nastavil', async () => {
    const ctx = await testWorkspace('Firma s.r.o.');
    await createSenderIdentity(ctx, 'Novinky od Firmy');
    const listId = await createList(ctx, { name: 'Newsletter' });
    const pageId = await createPageTemplate(ctx, {
      name: 'Už jste u nás',
      document: pageDocument({
        name: 'Už jste u nás',
        paragraphs: ['Vy už {{ data.list_name }} odebíráte, nemusíte dělat nic.'],
      }),
    });
    const form = await createForm(ctx, {
      name: 'Odběr novinek',
      fields: [
        { target: 'email', label: { en: 'Email', cs: 'E-mail' }, required: true, type: 'email' },
      ],
      list_ids: [listId],
      min_fill_seconds: 0,
      already_subscribed_template_id: pageId,
    });
    const ref = publicFormRef(form);
    const contactId = await createContact(ctx, { email: 'j@x.cz' });
    await subscribe(ctx, { contactId, listId, status: 'confirmed' });

    const html = await (await formGet(publicRequest(`/f/${ref}`), params({ slug: ref }))).text();
    const posted = await formSubmit(
      publicRequest(`/f/${ref}/submit`, {
        method: 'POST',
        body: new URLSearchParams({ email: 'j@x.cz', ml_nonce: nonceFrom(html) }).toString(),
        contentType: 'application/x-www-form-urlencoded',
      }),
      params({ slug: ref }),
    );
    expect(posted.headers.get('location')).toBe(`/f/${ref}/thanks?already=1`);

    const page = await thanksGet(
      publicRequest(`/f/${ref}/thanks?already=1`),
      params({ slug: ref }),
    );
    expect(textOf(await page.text())).toContain('Vy už Newsletter odebíráte, nemusíte dělat nic.');
  }, 60_000);

  it('bez nastavené stránky zůstává odpověď bajtově táž jako pro neznámou adresu', async () => {
    const known = await submitTwice({});
    const contactId = await createContact(known.ctx, { email: 'j@x.cz' });
    await subscribe(known.ctx, { contactId, listId: known.listId, status: 'confirmed' });
    const forKnown = await known.send();

    const unknown = await submitTwice({});
    const forUnknown = await unknown.send();

    // Jednotná odpověď (R9): parametr se přidá jen tehdy, když si autor stránku
    // sám nastavil. Jinak se z odpovědi nesmí dát poznat, kdo je v databázi.
    expect(forKnown.headers.get('location')).toBe(`/f/${known.ref}/thanks`);
    expect(forUnknown.headers.get('location')).toBe(`/f/${unknown.ref}/thanks`);
  }, 60_000);
});
