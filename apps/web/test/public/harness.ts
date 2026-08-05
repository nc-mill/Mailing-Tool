// @vitest-environment node
/**
 * Bootstrap databázových testů veřejných stránek.
 *
 * Testy volají route handlery přímo, ne přes HTTP: handler je obyčejná funkce
 * `(Request, { params }) => Promise<Response>`, takže se dá zavolat bez serveru
 * a bez portu. Kontrolujeme přesně to, co uvidí příjemce e-mailu, včetně stavového
 * kódu a hlaviček.
 *
 * Pomocné funkce sahají do `packages/core` RELATIVNĚ, ne přes `@mlain/core/contacts`.
 * Barrel domény vystavuje jen produkční plochu a seed testu do ní nepatří; relativní
 * cesta je tady vědomá výjimka platná pro testy.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { createWorkspaceAsUser } from '@mlain/db';
import { startPgHarness, type PgHarness } from '@mlain/core/test-support/pg-harness';
import { createWorkspaceContext } from '../../../../packages/core/src/identity/context';
import { hashPassword } from '../../../../packages/core/src/identity/password';
import type { WorkspaceContext } from '../../../../packages/core/src/identity/types';
import {
  appPool,
  closePools,
  withWorkspace,
  withoutContext,
} from '../../../../packages/core/src/tx';
import * as schema from '@mlain/db/schema';
import { writeContact } from '../../../../packages/core/src/contacts/repo/contacts';
import { issueConfirmationIn } from '../../../../packages/core/src/contacts/repo/subscriptions';
import { registerSubscriptionEmails } from '../../../../packages/core/src/contacts/lists/subscribe-service';

let harness: PgHarness | null = null;
let migratorPool: Pool | null = null;
let seedUserId = '';

export type SentEmail = { kind: 'confirmation' | 'welcome' | 'goodbye'; contactId: string };
export const sentEmails: SentEmail[] = [];

beforeAll(async () => {
  harness = await startPgHarness();
  await closePools();
  migratorPool = new Pool({ connectionString: harness.migratorUrl, max: 4 });

  const passwordHash = await hashPassword('dostatecne-dlouhe-heslo');
  seedUserId = await withoutContext(async (tx) => {
    const inserted = await tx
      .insert(schema.users)
      .values({
        email: `public-${process.pid}-${Date.now()}@example.cz`,
        passwordHash,
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return inserted[0]!.id;
  });

  registerSubscriptionEmails({
    async sendConfirmation(input) {
      sentEmails.push({ kind: 'confirmation', contactId: input.contactId });
    },
    async sendWelcome(input) {
      sentEmails.push({ kind: 'welcome', contactId: input.contactId });
    },
    async sendGoodbye(input) {
      sentEmails.push({ kind: 'goodbye', contactId: input.contactId });
    },
    async deliverRequestedItem() {},
  });
}, 300_000);

afterAll(async () => {
  await closePools();
  await migratorPool?.end();
  await harness?.stop();
  harness = null;
}, 120_000);

export function asMigrator(): Pool {
  if (migratorPool === null) throw new Error('migrátorský pool není otevřený');
  return migratorPool;
}

let counter = 0;

export async function testWorkspace(name = 'Firma s.r.o.'): Promise<WorkspaceContext> {
  counter += 1;
  const slug = `pub-${process.pid}-${Date.now()}-${counter}`.slice(0, 62);
  const workspace = await createWorkspaceAsUser(appPool(), seedUserId, {
    name,
    slug,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });
  return createWorkspaceContext({
    kind: 'session',
    userId: seedUserId,
    workspaceRef: workspace.id,
  });
}

export async function createContact(
  ctx: WorkspaceContext,
  input: { email: string; firstName?: string; locale?: string },
): Promise<string> {
  const written = await writeContact(ctx, {
    email: input.email,
    firstName: input.firstName ?? 'Jana',
    lastName: 'Nováková',
    locale: input.locale ?? 'cs',
    attributes: {},
  });
  if (written.rejected !== null) throw new Error(`kontakt ${input.email} byl potlačený`);
  await asMigrator().query(`UPDATE contacts SET status = 'active' WHERE id = $1`, [written.id]);
  return written.id;
}

export async function createList(
  ctx: WorkspaceContext,
  input: {
    name: string;
    confirmationMode?: 'one_step' | 'two_step';
    /** Nabízí se ve veřejném centru předvoleb? Výchozí je NE, stejně jako v produkci. */
    publicVisible?: boolean;
    publicName?: string | null;
    publicDescription?: string | null;
  },
): Promise<string> {
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO lists (workspace_id, name, opt_in, confirmation_mode,
                        public_visible, public_name, public_description)
     VALUES ($1, $2, 'double', $3, $4, $5, $6) RETURNING id`,
    [
      ctx.workspaceId,
      input.name,
      input.confirmationMode ?? 'two_step',
      input.publicVisible ?? false,
      input.publicName ?? null,
      input.publicDescription ?? null,
    ],
  );
  return rows[0]!.id;
}

/** Přepne nastavení projektu `settings.contacts.public_preference_center`. */
export async function setPreferenceCenter(ctx: WorkspaceContext, enabled: boolean): Promise<void> {
  await asMigrator().query(
    `UPDATE workspaces
        SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{contacts}',
              coalesce(settings -> 'contacts', '{}'::jsonb)
                || jsonb_build_object('public_preference_center', $2::boolean), true)
      WHERE id = $1`,
    [ctx.workspaceId, enabled],
  );
}

export async function subscribe(
  ctx: WorkspaceContext,
  input: { contactId: string; listId: string; status: string },
): Promise<void> {
  await asMigrator().query(
    `INSERT INTO list_subscriptions (contact_id, list_id, workspace_id, status, source)
     VALUES ($1, $2, $3, $4, 'manual')
     ON CONFLICT (contact_id, list_id) DO UPDATE SET status = excluded.status`,
    [input.contactId, input.listId, ctx.workspaceId, input.status],
  );
}

/** Vydá skutečný potvrzovací token, tedy tentýž, jaký by odešel v e-mailu. */
export async function issueConfirmationToken(
  ctx: WorkspaceContext,
  input: { contactId: string; listId: string; ttlHours?: number },
): Promise<string> {
  return withWorkspace(ctx, async (tx) => {
    const { token } = await issueConfirmationIn(tx, ctx, {
      contactId: input.contactId,
      listId: input.listId,
      ttlHours: input.ttlHours ?? 168,
    });
    return token;
  });
}

export async function expireConfirmation(ctx: WorkspaceContext, contactId: string): Promise<void> {
  await asMigrator().query(
    `UPDATE subscription_confirmations SET expires_at = now() - interval '1 day'
      WHERE workspace_id = $1 AND contact_id = $2 AND consumed_at IS NULL`,
    [ctx.workspaceId, contactId],
  );
}

export async function subscriptionStatus(
  ctx: WorkspaceContext,
  contactId: string,
  listId: string,
): Promise<string | null> {
  const { rows } = await asMigrator().query<{ status: string }>(
    `SELECT status FROM list_subscriptions
      WHERE workspace_id = $1 AND contact_id = $2 AND list_id = $3`,
    [ctx.workspaceId, contactId, listId],
  );
  return rows[0]?.status ?? null;
}

export async function contactRow(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<Record<string, unknown>> {
  const { rows } = await asMigrator().query<Record<string, unknown>>(
    `SELECT * FROM contacts WHERE workspace_id = $1 AND id = $2`,
    [ctx.workspaceId, contactId],
  );
  return rows[0]!;
}

/**
 * Odeslaná zpráva jedné kampaně, se zkompilovaným tělem a s daty pro personalizaci.
 * Pro stránku „Zobrazit v prohlížeči", která z těch dvou skládá výsledek.
 *
 * `fk_messages__campaign_audience` je složený cizí klíč (campaign_id, created_at) na
 * (campaigns.id, campaigns.audience_built_at), takže `created_at` zprávy MUSÍ být rovné
 * `audience_built_at` kampaně. Hodnota se proto čte poddotazem a nejde přes JavaScript:
 * `timestamptz` má mikrosekundy, `Date` jen milisekundy, a po zaokrouhlení by cizí klíč
 * spadl.
 */
export async function seedSentMessage(
  ctx: WorkspaceContext,
  input: { contactId: string; email: string; html: string; renderData: Record<string, unknown> },
): Promise<{ messageId: string; createdAt: Date }> {
  const { rows: campaignRows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO campaigns (workspace_id, name, status, subject, compiled_html, audience_built_at)
     VALUES ($1, 'Kampaň', 'sent', 'Předmět', $2, now()) RETURNING id`,
    [ctx.workspaceId, input.html],
  );
  const campaignId = campaignRows[0]!.id;

  const { rows } = await asMigrator().query<{ id: string; created_at: Date }>(
    `INSERT INTO messages (workspace_id, campaign_id, contact_id, email, render_data, status,
                           created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'sent',
             (SELECT audience_built_at FROM campaigns WHERE id = $2))
     RETURNING id, created_at`,
    [ctx.workspaceId, campaignId, input.contactId, input.email, JSON.stringify(input.renderData)],
  );
  return { messageId: rows[0]!.id, createdAt: new Date(rows[0]!.created_at) };
}

export async function latestConsent(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<{ source: string; status: string } | null> {
  const { rows } = await asMigrator().query<{ source: string; status: string }>(
    `SELECT source, status FROM consents
      WHERE workspace_id = $1 AND contact_id = $2
      ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    [ctx.workspaceId, contactId],
  );
  return rows[0] ?? null;
}

/** Požadavek na veřejnou stránku. Bez cookie, bez relace: tak ho pošle příjemce. */
export function publicRequest(
  url: string,
  init: { method?: string; body?: string; contentType?: string; ip?: string } = {},
): Request {
  const headers: Record<string, string> = {
    'user-agent': 'vitest',
    'x-forwarded-for': init.ip ?? '198.51.100.7',
  };
  if (init.contentType !== undefined) headers['content-type'] = init.contentType;
  return new Request(`https://mlain.test${url}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}
