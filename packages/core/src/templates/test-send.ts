import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { prepareRenderData } from '@mlain/contracts/liquid/prepare-render-data';
import type { Document } from '@mlain/emails/document/types';
import { toPreparedSchema } from '@mlain/emails/paths';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import { withWorkspace, type Tx } from '../tx';
import { compileTemplate } from './compile';
import { findTemplateById, type TemplateRow } from './repository';
import type { ServiceContext } from './service';

/** Strop z `campaigns/constants.ts` (TEST_SEND_MAX_RECIPIENTS), opsaný sem, aby doména šablon nezávisela na doméně kampaní. */
export const TEST_SEND_MAX_RECIPIENTS = 5;

/**
 * Doménový limit četnosti.
 *
 * ODCHYLKA, VĚDOMÁ: katalog pravidel v `apps/web/src/lib/api/rate-limit.ts` je
 * uzavřený typ `RuleName` a vlastní ho P04; doménový plán do něj sahat nesmí.
 * Limit je proto tady a počítá skutečně vyrobené zprávy, ne požadavky. Má to
 * i výhodu: uživatel, který pošle pět adres najednou, spotřebuje pět, ne jednu.
 *
 * Okno je 60 sekund, protože registr chyb má u `test_rate_limited`
 * `retryAfterSeconds: 60`. Kdyby se ta dvě čísla rozešla, klient by dostal
 * nepravdivou dobu čekání.
 */
export const TEST_SEND_WINDOW_SECONDS = 60;
export const TEST_SEND_MAX_PER_WINDOW = 20;

/** Jméno skryté kampaně. Není to identifikátor, ten nese `kind` a `template_id`. */
const SYSTEM_CAMPAIGN_NAME = 'Testovací odeslání šablony';

export type TestSendRenderData = Record<string, unknown>;

export type TestSendInput = {
  templateId: string;
  recipients: string[];
  /** Hotová data pro dosazení, stejná jako u náhledu. Skládá je volající. */
  renderData: TestSendRenderData;
  /** Z konfigurace (`ASSET_BASE_URL`). Doména ji nečte sama, aby šla otestovat bez prostředí. */
  assetBaseUrl: string;
};

export type TestSendResult = {
  created: number;
  campaignId: string;
  subject: string;
};

/**
 * Chyby domény. Překládá je HTTP vrstva, tady jsou jen jako kódy ve zprávě,
 * stejně jako ve zbytku domény šablon.
 */
export class TestSendError extends Error {
  constructor(
    code: string,
    readonly params?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'TestSendError';
  }
}

/** Hrubá kontrola tvaru adresy. Ostrou validaci dělá schéma cesty, tohle je pojistka domény. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Testovací odeslání šablony.
 *
 * JDE PŘES OUTBOX A PŘES SKUTEČNOU KAMPAŇ, ne mimo ně. Kdyby se posílalo přímo
 * přes providera, obešlo by to seznam potlačených adres, kvóty, sledování
 * i rekonciliaci, a všechno by se muselo napsat podruhé. Testovací mail, který
 * odejde na adresu ze seznamu potlačených, je přesně ta chyba, kterou si nástroj
 * na rozesílání dovolit nemůže.
 *
 * Kampaň je `kind = 'system'`, takže se uživateli nikde neukáže. Zprávy jsou
 * `kind = 'test'`, takže je sender claimuje přednostně (`StmtClaimTestBatch`)
 * bez ohledu na stav kampaně a nepočítají se do statistik.
 */
export async function sendTemplateTest(
  ctx: ServiceContext,
  input: TestSendInput,
): Promise<TestSendResult> {
  const recipients = input.recipients.map((address) => address.trim().toLowerCase());
  if (recipients.length < 1 || recipients.length > TEST_SEND_MAX_RECIPIENTS) {
    throw new TestSendError('test_recipients_out_of_range', {
      max: TEST_SEND_MAX_RECIPIENTS,
      got: recipients.length,
    });
  }
  for (const address of recipients) {
    if (!EMAIL_SHAPE.test(address)) {
      throw new TestSendError('test_recipient_invalid', { email: address });
    }
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - TEST_SEND_WINDOW_SECONDS * 1000);

  return withWorkspace(ctx.ctx, async (tx) => {
    const template = await findTemplateById(tx, ctx.ctx, input.templateId);
    if (!template) throw new Error('not_found');

    await assertUnderRateLimit(tx, ctx.ctx, windowStart, recipients.length);
    await assertRecipientsAllowed(tx, ctx.ctx, recipients);

    const identity = await senderIdentity(tx, ctx.ctx);
    const contactId = await resolveTestContactId(tx, ctx.ctx);

    const compiled = await compileTemplate({
      tx,
      ctx: ctx.ctx,
      document: template.design as Document,
      templateKind: template.kind,
      fields: ctx.fields,
      language: (template.design as Document).meta.language,
      assetBaseUrl: input.assetBaseUrl,
      // `test` je vlastní účel kontraktu 5. Není to `send`, takže se nevyžaduje
      // `campaignId` do odvození `link_id`, a není to `preview`, protože výstup
      // opravdu odchází příjemci.
      purpose: 'test',
      trackOpens: false,
      trackClicks: false,
      preheader: (template.design as Document).meta.previewText,
      now,
    });
    if (!compiled.ok) {
      throw new TestSendError('test_template_not_compilable', {
        issues: compiled.issues.filter((issue) => issue.severity === 'error'),
      });
    }

    const subject = subjectFor(template);
    const campaignId = await upsertSystemCampaign(tx, ctx.ctx, {
      templateId: template.id,
      subject,
      preheader: (template.design as Document).meta.previewText,
      html: compiled.html,
      text: compiled.text,
      compileMeta: compiled.meta,
      identity,
      now,
    });

    // Mapu `_present` plní `prepareRenderData` podle `renderSchema.presence`,
    // úplně stejně jako ostrá materializace. Bez ní by se podmíněné bloky
    // v testovacím mailu chovaly jinak než v tom ostrém, což je přesně to,
    // co má test odhalit.
    const renderData = prepareRenderData(
      input.renderData,
      toPreparedSchema(compiled.meta.renderSchema),
    );

    for (const address of recipients) {
      await tx.insert(schema.messages).values({
        workspaceId: ctx.ctx.workspaceId,
        campaignId,
        contactId,
        kind: 'test',
        email: address,
        renderData,
        status: 'pending',
        nextAttemptAt: now,
        // `created_at` se NEnastavuje na `audience_built_at` kampaně, protože
        // skrytá kampaň žádné publikum nemá. Od migrace 0010 to nevadí:
        // cizí klíč jede přes generovaný `audience_campaign_id`, který je
        // u `kind = 'test'` NULL, takže se kontrola přeskočí.
        createdAt: now,
      });
    }

    return { created: recipients.length, campaignId, subject };
  });
}

/** Předmět testovacího mailu. Vlastní pole na něj šablona nemá, bere se její jméno. */
function subjectFor(template: TemplateRow): string {
  const fromDocument = (template.design as Document).meta.name;
  return (fromDocument !== '' ? fromDocument : template.name).slice(0, 400);
}

async function assertUnderRateLimit(
  tx: Tx,
  ctx: WorkspaceContext,
  windowStart: Date,
  requested: number,
): Promise<void> {
  const rows = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM messages
     WHERE workspace_id = ${ctx.workspaceId}
       AND kind = 'test'
       AND created_at > ${windowStart.toISOString()}::timestamptz`);
  const used = rows.rows[0]?.n ?? 0;
  if (used + requested > TEST_SEND_MAX_PER_WINDOW) {
    throw new TestSendError('test_rate_limited', {
      limit: TEST_SEND_MAX_PER_WINDOW,
      windowSeconds: TEST_SEND_WINDOW_SECONDS,
    });
  }
}

/**
 * Seznam potlačených adres platí i pro test, s JEDINOU výjimkou: adresy členů
 * projektu. Bez té výjimky by si vývojář nezkusil nic potom, co si sám omylem
 * nahlásil spam. Cizí adresa na seznamu zůstává zakázaná i v testu.
 */
async function assertRecipientsAllowed(
  tx: Tx,
  ctx: WorkspaceContext,
  recipients: string[],
): Promise<void> {
  const members = await tx
    .select({ email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.workspaceId, ctx.workspaceId));
  const memberEmails = new Set(members.map((row) => row.email.toLowerCase()));

  for (const address of recipients) {
    if (memberEmails.has(address)) continue;
    const [hit] = await tx
      .select({ id: schema.suppressions.id })
      .from(schema.suppressions)
      .where(
        and(
          wsEq(ctx, schema.suppressions),
          isNull(schema.suppressions.removedAt),
          sql`lower(${schema.suppressions.email}::text) = ${address}`,
        ),
      )
      .limit(1);
    if (hit) throw new TestSendError('test_recipient_suppressed', { email: address });
  }
}

/**
 * `messages.contact_id` je NOT NULL, protože na něm stojí výmaz podle článku 17.
 * Testovací příjemce ale kontakt být nemusí (posílá se kolegovi), takže se bere
 * libovolný kontakt projektu jako nositel dat pro dosazení. Když projekt nemá
 * ani jeden kontakt, není z čeho a odmítne se to nahlas.
 */
async function resolveTestContactId(tx: Tx, ctx: WorkspaceContext): Promise<string> {
  const [row] = await tx
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(wsEq(ctx, schema.contacts), isNull(schema.contacts.deletedAt)))
    .orderBy(desc(schema.contacts.createdAt))
    .limit(1);
  if (!row) throw new TestSendError('test_no_contact');
  return row.id;
}

type SenderIdentity = {
  providerId: string;
  senderDomainId: string | null;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
};

/**
 * Odesílací identita skryté kampaně.
 *
 * ROZHODNUTÍ, KTERÉ SE MUSELO UDĚLAT: projekt nemá nikde uloženou výchozí
 * odesílací identitu. `workspaces.settings.campaigns` nese jen okno pro vrácení
 * a zkušební režim, konfigurace providera adresu neobsahuje a `sender_domains`
 * zná doménu, ne celou adresu. Vymyslet lokální část (`test@…`, `no-reply@…`)
 * by znamenalo poslat mail z adresy, kterou nikdo nezaložil.
 *
 * Bere se proto identita z POSLEDNÍ kampaně projektu, která ji má vyplněnou.
 * Testovací mail tím odejde přesně tak, jak odcházejí ostré kampaně toho
 * projektu, což je u testu žádoucí. Když taková kampaň není, odesílání ještě
 * není nastavené a odmítne se to s vlastním kódem, ne tichým výchozím nastavením.
 */
async function senderIdentity(tx: Tx, ctx: WorkspaceContext): Promise<SenderIdentity> {
  const [row] = await tx
    .select({
      providerId: schema.campaigns.providerId,
      senderDomainId: schema.campaigns.senderDomainId,
      fromName: schema.campaigns.fromName,
      fromEmail: schema.campaigns.fromEmail,
      replyTo: schema.campaigns.replyTo,
    })
    .from(schema.campaigns)
    .where(
      and(
        wsEq(ctx, schema.campaigns),
        isNull(schema.campaigns.deletedAt),
        eq(schema.campaigns.kind, 'campaign'),
        isNotNull(schema.campaigns.providerId),
        ne(schema.campaigns.fromEmail, ''),
      ),
    )
    .orderBy(desc(schema.campaigns.updatedAt))
    .limit(1);
  if (!row?.providerId) throw new TestSendError('test_sending_not_configured');
  return {
    providerId: row.providerId,
    senderDomainId: row.senderDomainId,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    replyTo: row.replyTo,
  };
}

/**
 * Skrytá kampaň je JEDNA na šablonu a přepisuje se při každém testu.
 *
 * Proč ne nová na každé odeslání: kampaní by v tabulce přibývalo bez omezení
 * a každá by držela odkaz na providera cizím klíčem s ON DELETE RESTRICT.
 * Proč ne jedna na projekt: sender čte obsah z hlavičky kampaně, takže dva
 * souběžné testy dvou různých šablon by si obsah přepsaly.
 *
 * `revision` se zvyšuje, protože sender si hlavičku cachuje podle dvojice
 * (campaign_id, revision). Bez toho by druhý test téže šablony odešel se starým
 * obsahem, a nic by přitom nespadlo.
 */
async function upsertSystemCampaign(
  tx: Tx,
  ctx: WorkspaceContext,
  input: {
    templateId: string;
    subject: string;
    preheader: string;
    html: string;
    text: string;
    compileMeta: unknown;
    identity: SenderIdentity;
    now: Date;
  },
): Promise<string> {
  const content = {
    subject: input.subject,
    preheader: input.preheader,
    fromName: input.identity.fromName,
    fromEmail: input.identity.fromEmail,
    replyTo: input.identity.replyTo,
    providerId: input.identity.providerId,
    senderDomainId: input.identity.senderDomainId,
    compiledHtml: input.html,
    compiledText: input.text,
    compileMeta: input.compileMeta,
    compiledAt: input.now,
    trackOpens: false,
    trackClicks: false,
    updatedAt: input.now,
  };

  const [existing] = await tx
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(
      and(
        wsEq(ctx, schema.campaigns),
        eq(schema.campaigns.kind, 'system'),
        eq(schema.campaigns.templateId, input.templateId),
        isNull(schema.campaigns.deletedAt),
      ),
    )
    .limit(1);

  if (existing) {
    await tx
      .update(schema.campaigns)
      .set({ ...content, revision: sql`${schema.campaigns.revision} + 1` })
      .where(eq(schema.campaigns.id, existing.id));
    return existing.id;
  }

  const [created] = await tx
    .insert(schema.campaigns)
    .values({
      workspaceId: ctx.workspaceId,
      name: SYSTEM_CAMPAIGN_NAME,
      kind: 'system',
      // Zůstává v draftu navždy. Sender testovací zprávy claimuje bez ohledu
      // na stav kampaně, takže ji není proč posouvat, a v draftu ji nesebere
      // žádná kontrola běžících kampaní.
      status: 'draft',
      templateId: input.templateId,
      ...content,
    })
    .returning({ id: schema.campaigns.id });
  return created!.id;
}
