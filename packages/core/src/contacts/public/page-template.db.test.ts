import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Document } from '@mlain/emails/document/types';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import {
  categoryOf,
  countTemplatesByCategory,
  createTemplateRow,
  EMPTY_TEMPLATE_USAGE,
  listTemplates,
  setValidationState,
  softDeleteTemplate,
} from '../../templates/repository';
import { closePools, withWorkspace } from '../../tx';
import { createForm, updateForm } from '../repo/forms';
import * as listsRepo from '../repo/lists';
import { resolvePageTemplateId } from './page-template';

/**
 * PŘEKLAD POVRCHU NA ŠABLONU VEŘEJNÉ STRÁNKY, proti databázi.
 *
 * Body 9 až 13 z oddílu 6.3 plánu
 * (docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md)
 * plus důkaz, že migrace 0029 opravdu doběhla.
 *
 * Testuje se proti skutečné databázi schválně: polovina pravidel jsou podmínky
 * v dotazu (měkce smazaný řádek, `validation_state`, `kind`, izolace projektu)
 * a proti atrapě by prošly, i kdyby v SQL chyběly.
 */

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

/** Nejmenší dokument, který projde uložením. Obsah stránky tyhle testy neřeší. */
const design = {
  schemaVersion: 1,
  meta: { name: 'Stránka', previewText: '', language: 'cs' },
  theme: {
    contentWidth: 600,
    canvasBackground: 'surface.canvas',
    contentBackground: 'surface.content',
    colors: {},
    fonts: { heading: 'system', body: 'system' },
    typography: { baseFontSize: 16, baseLineHeight: 1.5, headingScale: 1.25 },
    radius: 6,
    darkMode: { strategy: 'auto', colors: {} },
  },
  blocks: [],
} as unknown as Document;

type Seeded = Awaited<ReturnType<typeof seedWorkspaceForCoreTests>>;

async function createPage(ws: Seeded, name: string): Promise<string> {
  const row = await withWorkspace(ws.ctx, (tx) =>
    createTemplateRow(tx, ws.ctx, { name, kind: 'page', design, usedFields: [] }),
  );
  return row.id;
}

async function createList(ws: Seeded, patch: Record<string, unknown> = {}): Promise<string> {
  return withWorkspace(ws.ctx, async (tx) => {
    const [row] = await tx
      .insert(schema.lists)
      .values({
        workspaceId: ws.workspaceId,
        name: `Newsletter ${Math.random().toString(36).slice(2)}`,
        optIn: 'double',
        ...patch,
      })
      .returning({ id: schema.lists.id });
    return row!.id;
  });
}

async function createContact(ws: Seeded, email: string): Promise<string> {
  return withWorkspace(ws.ctx, async (tx) => {
    const [row] = await tx
      .insert(schema.contacts)
      .values({
        workspaceId: ws.workspaceId,
        email,
        status: 'unconfirmed',
        source: 'form',
        locale: 'cs',
      })
      .returning({ id: schema.contacts.id });
    return row!.id;
  });
}

/**
 * Přihlášení, které vzniklo z konkrétního formuláře. `source_ref` nese jeho ID
 * přesně tak, jak ho zapisuje `forms/submit.ts`; na tomhle poli stojí izolace
 * mezi formuláři a test 12 by bez něj neznamenal nic.
 */
async function subscribeFromForm(
  ws: Seeded,
  contactId: string,
  listId: string,
  formId: string,
): Promise<void> {
  await withWorkspace(ws.ctx, (tx) =>
    tx.insert(schema.listSubscriptions).values({
      workspaceId: ws.workspaceId,
      contactId,
      listId,
      status: 'pending',
      source: 'form',
      sourceRef: formId,
    }),
  );
}

async function resolve(
  ws: Seeded,
  query: Parameters<typeof resolvePageTemplateId>[2],
): Promise<string | null> {
  return withWorkspace(ws.ctx, (tx) => resolvePageTemplateId(tx, ws.ctx, query));
}

describe('stránka podle povrchu', () => {
  it('formulář s nastavenou stránkou ji vrátí, bez nastavení vrátí null', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const pageId = await createPage(ws, 'Děkujeme');

    const withoutPage = await createForm(ws.ctx, { name: 'Bez stránky' });
    expect(await resolve(ws, { surface: 'form_thanks', formId: withoutPage.id })).toBeNull();

    const withPage = await createForm(ws.ctx, {
      name: 'Se stránkou',
      thanks_template_id: pageId,
    });
    expect(await resolve(ws, { surface: 'form_thanks', formId: withPage.id })).toBe(pageId);
  });

  it('nastavení stránky přežije úpravu formuláře', async () => {
    // Úprava formuláře přepisuje celý řádek, ne jen změněné sloupce
    // (`updateForm`). Kdyby klíče stránek do toho přepisu nevstupovaly, zmizely
    // by při prvním přejmenování a autor by o návrh přišel, aniž by na něj sáhl.
    const ws = await seedWorkspaceForCoreTests();
    const pageId = await createPage(ws, 'Děkujeme po úpravě');
    const form = await createForm(ws.ctx, { name: 'Původní', thanks_template_id: pageId });

    const renamed = await updateForm(ws.ctx, form.id, { name: 'Přejmenovaný' });
    expect(renamed.name).toBe('Přejmenovaný');
    expect(await resolve(ws, { surface: 'form_thanks', formId: form.id })).toBe(pageId);
  });

  it('smazaná šablona spadne na vestavěný text', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const pageId = await createPage(ws, 'Smazaná');
    const form = await createForm(ws.ctx, { name: 'Formulář', thanks_template_id: pageId });
    expect(await resolve(ws, { surface: 'form_thanks', formId: form.id })).toBe(pageId);

    await withWorkspace(ws.ctx, (tx) => softDeleteTemplate(tx, ws.ctx, pageId));

    // Odkaz v jsonb zůstal, protože ho nemá kdo uklidit; odpovědí přesto musí
    // být vestavěný text, ne chyba. V tuhle chvíli je člověk už v databázi.
    expect(await resolve(ws, { surface: 'form_thanks', formId: form.id })).toBeNull();
  });

  it('neplatná šablona spadne na vestavěný text', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const pageId = await createPage(ws, 'Neplatná');
    const form = await createForm(ws.ctx, { name: 'Formulář', thanks_template_id: pageId });

    await withWorkspace(ws.ctx, (tx) =>
      setValidationState(tx, ws.ctx, pageId, 'invalid', [
        { code: 'content_html_forbidden_on_page' },
      ]),
    );

    expect(await resolve(ws, { surface: 'form_thanks', formId: form.id })).toBeNull();
  });

  it('šablona jiného druhu se jako stránka nevykreslí', async () => {
    // Odkaz na e-mail místo na stránku není teoretická možnost: klíč v jsonb
    // cizí klíč nemá, takže tam takové ID kdokoliv zapíše. Vykreslit obsah
    // kampaně jako veřejnou stránku by pustilo blok syrového HTML na naši
    // doménu, což profil stránky schválně zakazuje.
    const ws = await seedWorkspaceForCoreTests();
    const emailId = await withWorkspace(ws.ctx, async (tx) => {
      const row = await createTemplateRow(tx, ws.ctx, {
        name: 'Kampaň',
        kind: 'campaign',
        design,
        usedFields: [],
      });
      return row.id;
    });
    const form = await createForm(ws.ctx, { name: 'Formulář', thanks_template_id: emailId });

    expect(await resolve(ws, { surface: 'form_thanks', formId: form.id })).toBeNull();
  });

  it('potvrzení z formuláře A nevezme stránku formuláře B', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const pageA = await createPage(ws, 'Potvrzeno A');
    const pageB = await createPage(ws, 'Potvrzeno B');
    const formA = await createForm(ws.ctx, { name: 'Formulář A', confirmed_template_id: pageA });
    const formB = await createForm(ws.ctx, { name: 'Formulář B', confirmed_template_id: pageB });
    // Jeden seznam, dva formuláře. Kdyby se stránka hledala podle seznamu,
    // vyšla by u obou přihlášení stejná a tenhle test by nic nechytil.
    const listId = await createList(ws);

    const contactA = await createContact(
      ws,
      `a-${Math.random().toString(36).slice(2)}@example.com`,
    );
    const contactB = await createContact(
      ws,
      `b-${Math.random().toString(36).slice(2)}@example.com`,
    );
    await subscribeFromForm(ws, contactA, listId, formA.id);
    await subscribeFromForm(ws, contactB, listId, formB.id);

    expect(await resolve(ws, { surface: 'confirmed', contactId: contactA, listId })).toBe(pageA);
    expect(await resolve(ws, { surface: 'confirmed', contactId: contactB, listId })).toBe(pageB);
    expect(await resolve(ws, { surface: 'confirmed', contactId: contactA, listId })).not.toBe(
      pageB,
    );
  });

  it('bez stránky u formuláře se sáhne na seznam a teprve pak na vestavěný text', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const listPage = await createPage(ws, 'Potvrzeno ze seznamu');
    const form = await createForm(ws.ctx, { name: 'Formulář bez stránky' });
    const listId = await createList(ws, { confirmedTemplateId: listPage });
    const contactId = await createContact(
      ws,
      `c-${Math.random().toString(36).slice(2)}@example.com`,
    );
    await subscribeFromForm(ws, contactId, listId, form.id);

    expect(await resolve(ws, { surface: 'confirmed', contactId, listId })).toBe(listPage);

    // Seznam bez návrhu je vestavěný text, ne chyba.
    const bare = await createList(ws);
    await subscribeFromForm(ws, contactId, bare, form.id);
    expect(await resolve(ws, { surface: 'confirmed', contactId, listId: bare })).toBeNull();
  });

  it('odhlašovací stránku vlastní jen seznam', async () => {
    // Na odhlašovací stránku se chodí z odkazu v e-mailu, takže formulář do
    // rozhodování vstupovat nesmí, i kdyby ten kontakt z formuláře přišel.
    const ws = await seedWorkspaceForCoreTests();
    const listPage = await createPage(ws, 'Odhlášeno');
    const formPage = await createPage(ws, 'Formulářová stránka');
    const form = await createForm(ws.ctx, {
      name: 'Formulář',
      confirmed_template_id: formPage,
      already_subscribed_template_id: formPage,
    });
    const listId = await createList(ws, { unsubscribedTemplateId: listPage });
    const contactId = await createContact(
      ws,
      `u-${Math.random().toString(36).slice(2)}@example.com`,
    );
    await subscribeFromForm(ws, contactId, listId, form.id);

    expect(await resolve(ws, { surface: 'unsubscribed', contactId, listId })).toBe(listPage);
    expect(await resolve(ws, { surface: 'unsubscribed', contactId, listId })).not.toBe(formPage);
  });

  it('cizí projekt stránku nedostane', async () => {
    const a = await seedWorkspaceForCoreTests();
    const b = await seedWorkspaceForCoreTests();
    const pageId = await createPage(a, 'Cizí');
    const form = await createForm(b.ctx, { name: 'Formulář B', thanks_template_id: pageId });

    // ID z cizího projektu je pro tenhle projekt totéž co smazaná šablona.
    expect(await resolve(b, { surface: 'form_thanks', formId: form.id })).toBeNull();
  });
});

describe('stránka jako samostatná kategorie knihovny', () => {
  it('nenabízí se jako obsah kampaně ani jako transakční e-mail a naopak', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const pageId = await createPage(ws, 'Stránka v knihovně');
    const campaignId = await withWorkspace(ws.ctx, async (tx) => {
      const row = await createTemplateRow(tx, ws.ctx, {
        name: 'Kampaň v knihovně',
        kind: 'campaign',
        design,
        usedFields: [],
      });
      return row.id;
    });
    const transactionalId = await withWorkspace(ws.ctx, async (tx) => {
      const row = await createTemplateRow(tx, ws.ctx, {
        name: 'Transakční v knihovně',
        kind: 'transactional',
        design,
        usedFields: [],
      });
      return row.id;
    });

    const ids = async (options: Parameters<typeof listTemplates>[2]): Promise<string[]> => {
      const page = await withWorkspace(ws.ctx, (tx) => listTemplates(tx, ws.ctx, options));
      return page.items.map((row) => row.id);
    };

    // Nabídka obsahu kampaně jede přes `kind=campaign`, nabídka e-mailu
    // formuláře a e-mailů seznamu přes `kind=transactional`.
    expect(await ids({ limit: 50, kind: 'campaign' })).not.toContain(pageId);
    expect(await ids({ limit: 50, kind: 'transactional' })).not.toContain(pageId);
    expect(await ids({ limit: 50, category: 'campaign' })).not.toContain(pageId);
    expect(await ids({ limit: 50, category: 'transactional' })).not.toContain(pageId);

    // A naopak: v kategorii stránek není e-mail.
    const pages = await ids({ limit: 50, category: 'page' });
    expect(pages).toContain(pageId);
    expect(pages).not.toContain(campaignId);
    expect(pages).not.toContain(transactionalId);

    /*
     * VÝCHOZÍ VÝPIS STRÁNKY VRACÍ, a je to oprava ze 7. 8. 2026.
     *
     * Původně je schovával, aby se nedaly nabídnout jako e-mail. Znělo to
     * obezřetně a byla to vada: stránka po založení ZMIZELA z knihovny, takže
     * ji nešlo najít, upravit ani smazat. Nahlásil to zadavatel.
     *
     * Ochrana se přesunula tam, kde na ní záleží: nabídky si o zúžení říkají
     * samy (`kind=campaign`, `kind=transactional`), což hlídají tvrzení výš.
     * Výchozí stav, který tiše skryje celou kategorii, ochrání volající, ale
     * okrade uživatele.
     */
    const everything = await ids({ limit: 50 });
    expect(everything).toContain(campaignId);
    expect(everything).toContain(transactionalId);
    expect(everything).toContain(pageId);

    // Číslo nad knihovnou musí sedět na to, co je pod ním vidět.
    const counts = await withWorkspace(ws.ctx, (tx) => countTemplatesByCategory(tx, ws.ctx));
    expect(counts.page).toBe(1);
    expect(counts.all).toBe(counts.campaign + counts.form + counts.transactional + counts.page);
  });

  it('kategorie jedné stránky je page, ne campaign', async () => {
    expect(categoryOf('page', EMPTY_TEMPLATE_USAGE)).toBe('page');
    expect(categoryOf('campaign', EMPTY_TEMPLATE_USAGE)).toBe('campaign');
  });
});

describe('migrace 0029', () => {
  it('templates.kind přijme page', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const pageId = await createPage(ws, 'Důkaz migrace');
    const rows = await withWorkspace(ws.ctx, (tx) =>
      tx
        .select({ kind: schema.templates.kind })
        .from(schema.templates)
        .where(eq(schema.templates.id, pageId)),
    );
    expect(rows[0]?.kind).toBe('page');
  });

  it('smazání šablony vynuluje sloupec v lists a seznam přežije', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const pageId = await createPage(ws, 'Ke smazání natvrdo');
    const listId = await listsRepo
      .create(ws.ctx, {
        name: `Seznam ${Math.random().toString(36).slice(2)}`,
        unsubscribedTemplateId: pageId,
        confirmedTemplateId: pageId,
        alreadySubscribedTemplateId: pageId,
      })
      .then((row) => row.id);

    const before = await listsRepo.byId(ws.ctx, listId);
    expect(before?.unsubscribedTemplateId).toBe(pageId);

    // TVRDÉ smazání, ne měkké: `ON DELETE SET NULL` se spouští jen na DELETE.
    // Měkké smazání sloupec nechá být a stará se o něj až doména při čtení,
    // což hlídá test „smazaná šablona spadne na vestavěný text" výš.
    await withWorkspace(ws.ctx, (tx) =>
      tx.execute(sql`DELETE FROM templates WHERE id = ${pageId}::uuid`),
    );

    const after = await listsRepo.byId(ws.ctx, listId);
    expect(after).not.toBeNull();
    expect(after?.unsubscribedTemplateId).toBeNull();
    expect(after?.confirmedTemplateId).toBeNull();
    expect(after?.alreadySubscribedTemplateId).toBeNull();
  });

  it('seznam s odkazem na stránku se dá založit i bez ní', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const listId = await listsRepo
      .create(ws.ctx, { name: `Seznam ${Math.random().toString(36).slice(2)}` })
      .then((row) => row.id);
    const rows = await withWorkspace(ws.ctx, (tx) =>
      tx
        .select({
          confirmed: schema.lists.confirmedTemplateId,
          already: schema.lists.alreadySubscribedTemplateId,
          unsubscribed: schema.lists.unsubscribedTemplateId,
        })
        .from(schema.lists)
        .where(and(eq(schema.lists.id, listId), eq(schema.lists.workspaceId, ws.workspaceId))),
    );
    // NULL je vestavěný text, tedy dnešní chování. Migrace nesmí nic změnit.
    expect(rows[0]).toEqual({ confirmed: null, already: null, unsubscribed: null });
  });
});
