import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { prepareRenderData } from '@mlain/contracts/liquid/prepare-render-data';
import { hasContentBlocks } from '@mlain/emails/document/content-stats';
import type { Document } from '@mlain/emails/document/types';
import { toPreparedSchema } from '@mlain/emails/paths';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import { compileTemplate } from '../templates/compile';
import { findTemplateById, validationProfileFor } from '../templates/repository';
import { contactPreviewData } from '../templates/api/preview-data';
import { resolveSenderIdentity, type ResolvedSenderIdentity } from '../sender-identities/resolve';
import { withWorkspace, type Tx } from '../tx';
import { getFieldCatalog } from '../contacts/fields/catalog';
import { transactionalVerdict } from '../contacts/suppression/transactional';
import { normalizeEmail } from '../contacts/email';

/**
 * Odeslání jedné transakční zprávy, kterou si vyžádala APLIKACE ZÁKAZNÍKA
 * voláním `POST /api/v1/transactional`.
 *
 * Typický případ je reset hesla: odkaz s jednorázovým tokenem přijde v požadavku
 * a dosadí se do tlačítka jako `{{ data.reset_url }}`.
 *
 * JDE PŘES OUTBOX A PŘES SKRYTOU KAMPAŇ, ne přímo přes providera. Je to táž
 * úvaha jako u testovacího odeslání a u e-mailu z formuláře: mimo outbox by se
 * obešel seznam potlačených adres, kvóty, retry, rekonciliace i statistiky
 * a všechno by se muselo napsat podruhé.
 *
 * ČÍM SE LIŠÍ OD OSTATNÍCH CEST MIMO KAMPAŇ:
 *
 * 1. `messages.kind = 'transactional'`, ne `'test'`. Test nese hlavičku
 *    `X-Mlain-Test: 1`, má vlastní větev odhlašovacího odkazu a v reportech
 *    by se transakční pošta počítala jako testovací.
 * 2. Zpráva NENESE odhlašovací odkaz ani hlavičku `List-Unsubscribe`. Vynucuje
 *    to sender podle `kind`, ne tenhle kód.
 * 3. Neměří se otevření ani prokliky. Odkaz bývá jednorázový a bezpečnostní
 *    skener v poštovní schránce by ho při měření otevřel a token spotřeboval
 *    dřív než člověk.
 * 4. Chybějící proměnná je CHYBA, ne prázdný řetězec. Kontrakt Liquidu má
 *    `strictVariables: false`, což je pro kampaň správně a pro reset hesla
 *    katastrofa: vzniklo by z toho `href=""`.
 * 5. Odhlášení z marketingu adresu NEBLOKUJE, tvrdý odraz a výmaz podle GDPR ano.
 */

/** Strop na serializovaný objekt `data`. Nad ním je to 413, ne oříznutí. */
export const TRANSACTIONAL_DATA_MAX_BYTES = 16 * 1024;

/** Kořen, pod kterým se `data` z volání dostane do šablony: `{{ data.reset_url }}`. */
export const TRANSACTIONAL_DATA_ROOT = 'data';

/** Jméno skryté kampaně. Není to identifikátor, ten nese `kind` a jméno se skládá. */
const SYSTEM_CAMPAIGN_NAME = 'Transakční e-mail';

export type TransactionalSendInput = {
  templateId: string;
  to: { email: string; name?: string | undefined };
  /** Hodnoty pro kořen `data`. Volitelné, šablona nemusí žádnou proměnnou mít. */
  data?: Record<string, unknown> | undefined;
  senderIdentityId?: string | undefined;
  replyTo?: string | undefined;
  tags?: readonly string[] | undefined;
  /**
   * Založit kontakt, když adresa v projektu není? Výchozí ANO, protože
   * `messages.contact_id` je `NOT NULL` a bez kontaktu zpráva technicky neodejde.
   *
   * Takto vzniklý kontakt NESMÍ dostat marketingový souhlas, nesmí se přidat do
   * žádného seznamu a musí být poznat, odkud je: `source = 'api'`.
   */
  createContact?: boolean | undefined;
  /** Z konfigurace (`ASSET_BASE_URL`). Doména ji nečte sama, aby šla otestovat bez prostředí. */
  assetBaseUrl: string;
};

export type TransactionalSendResult = {
  messageId: string;
  contactId: string;
  campaignId: string;
  createdAt: Date;
  /**
   * Adresa je sice blokovaná, ale z důvodu, který transakční poštu nezastaví
   * (`manual`, `import`). Volající to má vidět, ne se to dozvědět z logu.
   */
  warnings: Array<{ code: string; params?: Record<string, unknown> }>;
};

/**
 * Chyba domény. Kód je přímo kořenový `code` z registru chyb, takže ho HTTP
 * vrstva jen přebalí a nemusí ho překládat tabulkou.
 */
export class TransactionalSendError extends Error {
  constructor(
    code: string,
    readonly params?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'TransactionalSendError';
  }
}

export async function sendTransactional(
  ctx: WorkspaceContext,
  input: TransactionalSendInput,
): Promise<TransactionalSendResult> {
  const parsed = normalizeEmail(input.to.email);
  if (!parsed.ok) throw new TransactionalSendError('validation_failed', { field: 'to.email' });
  const email = parsed.email;

  const data = input.data ?? {};
  // Měří se serializovaná velikost, ne počet klíčů: strop chrání sloupec
  // `render_data`, a ten nese JSON.
  const dataBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (dataBytes > TRANSACTIONAL_DATA_MAX_BYTES) {
    throw new TransactionalSendError('transactional_data_too_large', {
      bytes: dataBytes,
      limit: TRANSACTIONAL_DATA_MAX_BYTES,
    });
  }

  const fields = await getFieldCatalog(ctx);
  const now = new Date();

  return withWorkspace(ctx, async (tx) => {
    const template = await findTemplateById(tx, ctx, input.templateId);
    if (template === undefined) throw new TransactionalSendError('not_found');
    if (template.kind !== 'transactional') {
      throw new TransactionalSendError('template_kind_not_transactional', {
        kind: template.kind,
      });
    }

    const warnings = await checkSuppression(tx, ctx, email);

    const document = template.design as Document;
    // Prázdná šablona se neposílá. Dokument s pouhou patičkou je platný
    // a zkompiluje se bez výhrady, takže tuhle kontrolu nikdo jiný neudělá.
    if (!hasContentBlocks(document)) {
      throw new TransactionalSendError('template_not_compilable', { reason: 'empty' });
    }

    const identity = await resolveSenderIdentityFor(tx, ctx, input.senderIdentityId);
    if (identity === null) {
      throw new TransactionalSendError(
        input.senderIdentityId === undefined
          ? 'sending_not_configured'
          : 'sender_identity_not_found',
      );
    }

    const compiled = await compileTemplate({
      tx,
      ctx,
      document,
      templateKind: validationProfileFor(template.kind),
      fields,
      language: document.meta.language,
      assetBaseUrl: input.assetBaseUrl,
      // `test`, ne `send`: `send` odvozuje `link_id` z kampaně, kterou tahle
      // zpráva nemá. Výstup přitom opravdu odchází příjemci, takže ani `preview`.
      purpose: 'test',
      // Rozhodnutí zadavatele: transakční pošta se neměří. Sledovaný odkaz
      // s jednorázovým tokenem by spotřeboval bezpečnostní skener ve schránce.
      trackOpens: false,
      trackClicks: false,
      preheader: document.meta.previewText,
      now,
    });
    if (!compiled.ok) {
      throw new TransactionalSendError('template_not_compilable', {
        issues: compiled.issues.map((issue) => issue.code),
      });
    }

    // Přísná kontrola proměnných. TOHLE je důvod, proč se opravoval sběrač
    // `buildRenderSchema`: bez cest z URL polí by `usedPaths` proměnnou
    // z tlačítka vůbec neobsahovalo a chybějící hodnota by se tiše proměnila
    // v `href=""`, tedy v nefunkční odkaz na reset hesla.
    const missing = missingDataPaths(compiled.meta.usedPaths, data);
    if (missing.length > 0) {
      throw new TransactionalSendError('transactional_variable_unknown', { paths: missing });
    }

    const contactId = await resolveContact(tx, ctx, {
      email,
      name: input.to.name,
      createContact: input.createContact !== false,
      now,
    });

    const campaignId = await upsertTransactionalCampaign(tx, ctx, {
      templateId: template.id,
      subject: subjectFor(template.name, document),
      preheader: document.meta.previewText,
      html: compiled.html,
      text: compiled.text,
      compileMeta: compiled.meta,
      identity,
      replyTo: input.replyTo ?? identity.replyTo,
      now,
    });

    const language = document.meta.language.toLowerCase().startsWith('cs') ? 'cs' : 'en';
    const sample = await contactPreviewData(tx, ctx, language, contactId);
    if (sample === null) throw new TransactionalSendError('not_found');

    const renderData = prepareRenderData(
      // Kořen `data` se přidává k datům kontaktu, kampaně a projektu, ne místo
      // nich: transakční šablona smí použít `{{ contact.first_name }}` stejně
      // jako kampaňová.
      { ...(sample as unknown as Record<string, unknown>), [TRANSACTIONAL_DATA_ROOT]: data },
      toPreparedSchema(compiled.meta.renderSchema),
    );

    const [created] = await tx
      .insert(schema.messages)
      .values({
        workspaceId: ctx.workspaceId,
        campaignId,
        contactId,
        kind: 'transactional',
        email,
        renderData,
        status: 'pending',
        nextAttemptAt: now,
        createdAt: now,
      })
      .returning({ id: schema.messages.id, createdAt: schema.messages.createdAt });

    return {
      messageId: created!.id,
      contactId,
      campaignId,
      createdAt: created!.createdAt,
      warnings,
    };
  });
}

/**
 * Které cesty pod kořenem `data` šablona chce a volání je nedodalo.
 *
 * Bere se JEN kořen `data`. Chybějící `contact.*` chybou není: to je běžná
 * personalizace, kde je prázdná hodnota správná odpověď, a `default` filtr na to
 * v kontraktu je. Chybějící `data.*` je naopak vždy chyba volajícího.
 */
export function missingDataPaths(
  usedPaths: readonly string[],
  data: Record<string, unknown>,
): string[] {
  const prefix = `${TRANSACTIONAL_DATA_ROOT}.`;
  const missing: string[] = [];
  for (const path of usedPaths) {
    if (!path.startsWith(prefix)) continue;
    if (lookup(data, path.slice(prefix.length)) === undefined) missing.push(path);
  }
  return missing;
}

function lookup(root: Record<string, unknown>, dotted: string): unknown {
  let current: unknown = root;
  for (const segment of dotted.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Blokace adresy. Používá KANONICKOU podmínku včetně větve přes otisk.
 *
 * Větev přes otisk je povinná: po výmazu podle článku 17 plaintextovou adresu
 * neznáme, takže porovnání podle `email` na takového člověka nedosáhne. Bez ní
 * by vymazaný člověk dostával transakční poštu dál a chytil by to až sender.
 */
async function checkSuppression(
  tx: Tx,
  ctx: WorkspaceContext,
  email: string,
): Promise<TransactionalSendResult['warnings']> {
  const rows = await tx
    .select({ reason: schema.suppressions.reason, createdAt: schema.suppressions.createdAt })
    .from(schema.suppressions)
    .where(
      and(
        wsEq(ctx, schema.suppressions),
        isNull(schema.suppressions.removedAt),
        sql`(${schema.suppressions.email} = ${email}::citext OR ${schema.suppressions.fingerprint} IN (
          SELECT unnest(c.email_fingerprints) FROM contacts c
          WHERE c.workspace_id = ${ctx.workspaceId} AND lower(c.email::text) = ${email}
        ))`,
      ),
    );

  const warnings: TransactionalSendResult['warnings'] = [];
  for (const row of rows) {
    const verdict = transactionalVerdict(row.reason);
    if (verdict === 'block') {
      throw new TransactionalSendError('recipient_suppressed', {
        reason: row.reason,
        suppressed_at: row.createdAt.toISOString(),
      });
    }
    if (verdict === 'allow_with_warning') {
      warnings.push({ code: 'recipient_suppressed_soft', params: { reason: row.reason } });
    }
  }
  return warnings;
}

/**
 * Kontakt příjemce. Dohledá ho, nebo založí.
 *
 * Založený kontakt NEDOSTANE marketingový souhlas a NEPŘIDÁ se do žádného
 * seznamu. Že aplikace zákazníka zavolala reset hesla, není souhlas s newsletterem.
 * `source = 'api'` je proto, aby šlo poznat, odkud se kontakt vzal.
 *
 * Když je zakládání vypnuté a kontakt neexistuje, vrací se CHYBA. Tiché
 * neodeslání by u resetu hesla bylo nejhorší možné chování.
 */
async function resolveContact(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { email: string; name?: string | undefined; createContact: boolean; now: Date },
): Promise<string> {
  const [existing] = await tx
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(
      and(
        wsEq(ctx, schema.contacts),
        isNull(schema.contacts.deletedAt),
        sql`lower(${schema.contacts.email}::text) = ${input.email}`,
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  if (!input.createContact) throw new TransactionalSendError('recipient_unknown');

  const [created] = await tx
    .insert(schema.contacts)
    .values({
      workspaceId: ctx.workspaceId,
      email: input.email,
      // `active` je stav kontaktu, ne souhlas. Souhlas se zapisuje do `consents`
      // a do `list_subscriptions`, a tady se do ani jednoho NEZAPISUJE.
      status: 'active',
      source: 'api',
      ...(input.name === undefined || input.name.trim() === ''
        ? {}
        : { firstName: input.name.trim().slice(0, 200) }),
      createdAt: input.now,
    })
    .returning({ id: schema.contacts.id });
  return created!.id;
}

/** Předmět. Vlastní pole na něj šablona nemá, bere se jméno z dokumentu. */
function subjectFor(fallback: string, document: Document): string {
  const fromDocument = document.meta.name;
  return (fromDocument !== '' ? fromDocument : fallback).slice(0, 400);
}

/**
 * Odesílatel transakční zprávy.
 *
 * Výslovně zvolená identita má přednost; bez ní rozhoduje společný resolver
 * (`sender-identities/resolve.ts`), tedy předvolba projektu, poslední kampaň
 * s vyplněným odesílatelem a nakonec připojený účet s ověřenou adresou.
 * Do 7. 8. 2026 měla tahle trasa vlastní kopii téhož hledání a čtyři kopie
 * se rozešly.
 *
 * ODDĚLENÝ ÚČET PRO TRANSAKČNÍ PROUD se doporučuje, ale NEVYNUCUJE (rozhodnutí
 * zadavatele). Zákazník ho zařídí druhým řádkem `sending_providers` a vlastní
 * subdoménou a předá sem `sender_identity_id`. Vynucení by znatelně prodloužilo
 * cestu k prvnímu odeslanému mailu.
 */
async function resolveSenderIdentityFor(
  tx: Tx,
  ctx: WorkspaceContext,
  identityId: string | undefined,
): Promise<ResolvedSenderIdentity | null> {
  if (identityId !== undefined) {
    const [row] = await tx
      .select({
        providerId: schema.senderIdentities.providerId,
        senderDomainId: schema.senderIdentities.senderDomainId,
        fromName: schema.senderIdentities.fromName,
        fromEmail: schema.senderIdentities.fromEmail,
        replyTo: schema.senderIdentities.replyTo,
      })
      .from(schema.senderIdentities)
      .where(and(wsEq(ctx, schema.senderIdentities), eq(schema.senderIdentities.id, identityId)))
      .limit(1);
    return row ? { ...row, source: 'identity' } : null;
  }
  return resolveSenderIdentity(tx, ctx);
}

/**
 * Nosič obsahu: JEDNA skrytá kampaň NA ŠABLONU.
 *
 * Sender čte předmět, odesílatele a zkompilované HTML z hlavičky kampaně
 * (`StmtCampaignHeader`), takže nosič být musí. Jedna na šablonu, ne na volání:
 * kampaní by jinak přibývalo bez omezení a každá by držela odkaz na providera
 * cizím klíčem s `ON DELETE RESTRICT`.
 *
 * `revision` se zvyšuje, protože sender si hlavičku cachuje podle dvojice
 * (campaign_id, revision). Claim ne-kampaňových zpráv revizi vrací přímo
 * ve zprávě, takže se změna šablony do odeslané pošty opravdu promítne.
 */
async function upsertTransactionalCampaign(
  tx: Tx,
  ctx: WorkspaceContext,
  input: {
    templateId: string;
    subject: string;
    preheader: string;
    html: string;
    text: string;
    compileMeta: unknown;
    identity: ResolvedSenderIdentity;
    replyTo: string | null;
    now: Date;
  },
): Promise<string> {
  const content = {
    subject: input.subject,
    preheader: input.preheader,
    fromName: input.identity.fromName,
    fromEmail: input.identity.fromEmail,
    replyTo: input.replyTo,
    providerId: input.identity.providerId,
    senderDomainId: input.identity.senderDomainId,
    templateId: input.templateId,
    compiledHtml: input.html,
    compiledText: input.text,
    compileMeta: input.compileMeta,
    compiledAt: input.now,
    trackOpens: false,
    trackClicks: false,
    updatedAt: input.now,
  };

  // Šablona se pozná podle jména skryté kampaně, stejně jako u e-mailu
  // z formuláře: `campaigns` sloupec pro tenhle vztah nemá a přidávat ho kvůli
  // jednomu vyhledání by znamenalo migraci. Jméno se nikde neukazuje, protože
  // výpis kampaní `kind = 'system'` vynechává.
  const name = `${SYSTEM_CAMPAIGN_NAME} · ${input.templateId}`;

  const [existing] = await tx
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(
      and(
        wsEq(ctx, schema.campaigns),
        eq(schema.campaigns.kind, 'system'),
        eq(schema.campaigns.name, name),
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
      name,
      kind: 'system',
      // Zůstává v draftu navždy. Claim zpráv mimo kampaň stav kampaně nekontroluje.
      status: 'draft',
      ...content,
    })
    .returning({ id: schema.campaigns.id });
  return created!.id;
}
