/* eslint-disable-next-line @typescript-eslint/triple-slash-reference -- deklarace `psl`
   se jinak do překladu `apps/web` nedostane, viz vysvětlení pod tímhle řádkem */
/// <reference path="../psl.d.ts" />
/*
 * Odkaz na deklaraci `psl` je tady schválně a je ověřený překladem. Balíček
 * své typy sice vozí, ale jeho mapa `exports` nemá podmínku `types`, takže se
 * k nim při `moduleResolution: Bundler` nedá dostat. V `packages/core` deklaraci
 * najde `include` z jeho tsconfigu; překlad `apps/web` ale bere soubory
 * `packages/core` jen přes importy, a `.d.ts` se neimportuje. Bez tohohle
 * řádku proto `pnpm --filter @mlain/web typecheck` padal na TS7016 ve dvou
 * cizích souborech (`ses/identity.ts` a `dns/dmarc.ts`), které tenhle modul
 * vtahuje do svého grafu.
 */
import {
  CreateEmailIdentityCommand,
  GetAccountCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
} from '@aws-sdk/client-sesv2';
import { loadConfig } from '../../config/index';
import { ApiError } from '../../errors/api-error';
import { rawSql } from '../../campaigns/repo/raw-sql';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { providerConfigSchema, derivePublicConfig } from '../config-schema';
import { encryptProviderConfig, decryptProviderConfig } from '../crypto';
import { checkDkim } from '../dns/dkim';
import { checkDmarc } from '../dns/dmarc';
import { checkMx } from '../dns/mx';
import { createResolver } from '../dns/resolver';
import { checkSpf } from '../dns/spf';
import { nextCheckAt, runDomainChecks, type DomainChecks } from '../dns/check-domain';
import { buildDnsRecords, mapIdentity, normalizeDomain, type DnsRecord } from '../ses/identity';
import { createAwsClients } from '../ses/client';
import { mapAccount } from '../ses/account';
import { verifySmtp } from '../smtp/verify';
import { getDomain, saveChecks, type DomainRow } from '../repo/domain';
import {
  createProvider,
  getProviderById,
  getProviderSecret,
  updateAccountSnapshot,
  type ProviderRow,
} from '../repo/provider';
import type { ProviderConfig, SesConfig } from '../types';

/**
 * Aplikační vrstva pro nastavení odesílání.
 *
 * Pravidlo, které tenhle soubor drží celý: **z API nikdy neodejde tajemství.**
 * Čtecí dotazy repository `config_encrypted` nevracejí vůbec, dešifruje se jen
 * v okamžiku, kdy se s ním volá AWS nebo SMTP, a do odpovědi jde výhradně
 * `config_public`, kde jsou přístupové údaje maskované.
 */

export function presentProvider(row: ProviderRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: row.config_public,
    is_default: row.is_default,
    status: row.status,
    status_detail: row.status_detail ?? null,
    verified_at: row.verified_at,
    quota_max_24h: row.quota_max_24h,
    quota_max_send_rate: row.quota_max_send_rate === null ? null : Number(row.quota_max_send_rate),
    quota_sent_24h: row.quota_sent_24h,
    production_access: row.production_access,
    enforcement_status: row.enforcement_status,
    sending_enabled: row.sending_enabled,
    quota_checked_at: row.quota_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const PROVIDER_COLUMNS = `id, workspace_id, name, type, config_public, is_default, status,
  status_detail, verified_at, quota_max24h AS quota_max_24h, quota_max_send_rate,
  quota_sent24h AS quota_sent_24h, production_access, enforcement_status, sending_enabled,
  quota_checked_at, created_at, updated_at`;

export async function listProviders(ctx: WorkspaceContext): Promise<ProviderRow[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<ProviderRow>(
      rawSql(
        `SELECT ${PROVIDER_COLUMNS} FROM sending_providers
          WHERE workspace_id = $1 ORDER BY is_default DESC, created_at`,
        [ctx.workspaceId],
      ),
    );
    return r.rows;
  });
}

export type CreateProviderApiInput =
  | {
      type: 'ses';
      name: string;
      region: string;
      access_key_id: string;
      secret_access_key: string;
      configuration_set_name?: string | undefined;
      is_default?: boolean | undefined;
    }
  | {
      type: 'smtp';
      name: string;
      host: string;
      port: number;
      username: string;
      password: string;
      encryption: 'starttls' | 'tls' | 'none';
      is_default?: boolean | undefined;
    };

function buildConfig(input: CreateProviderApiInput, workspaceSlug: string): ProviderConfig {
  if (input.type === 'ses') {
    return providerConfigSchema.parse({
      kind: 'ses',
      region: input.region,
      access_key_id: input.access_key_id,
      secret_access_key: input.secret_access_key,
      configuration_set_name: input.configuration_set_name ?? `mlain-${workspaceSlug}`,
      sns_topic_arn: null,
      max_send_rate: 14,
      max_24h_send: null,
    });
  }
  return providerConfigSchema.parse({
    kind: 'smtp',
    host: input.host,
    port: input.port,
    username: input.username,
    password: input.password,
    encryption: input.encryption,
    max_send_rate: 10,
    max_connections: 5,
    max_messages_per_connection: 100,
  });
}

export async function createProviderFromApi(
  ctx: WorkspaceContext,
  input: CreateProviderApiInput,
  workspaceSlug: string,
): Promise<ProviderRow> {
  const config = buildConfig(input, workspaceSlug);
  const id = await createProvider(ctx, {
    name: input.name,
    type: input.type,
    configEncrypted: encryptProviderConfig({ config, workspaceId: ctx.workspaceId }),
    configPublic: derivePublicConfig(config),
    isDefault: input.is_default ?? false,
  });
  const row = await getProviderById(ctx, id);
  if (!row) throw new ApiError('not_found');
  return row;
}

/**
 * Tajemství se mění JEN když se pošle. Odpověď to říká polem `credentials_rotated`,
 * aby uživatel poznal rozdíl mezi „přejmenoval jsem účet" a „vyměnil jsem klíč".
 */
export async function updateProviderFromApi(
  ctx: WorkspaceContext,
  id: string,
  patch: {
    name?: string | undefined;
    access_key_id?: string | undefined;
    secret_access_key?: string | undefined;
    password?: string | undefined;
    username?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    encryption?: 'starttls' | 'tls' | 'none' | undefined;
  },
): Promise<{ row: ProviderRow; credentialsRotated: boolean }> {
  const current = await getProviderById(ctx, id);
  if (!current) throw new ApiError('not_found');

  const touchesSecret =
    patch.access_key_id !== undefined ||
    patch.secret_access_key !== undefined ||
    patch.password !== undefined ||
    patch.username !== undefined ||
    patch.host !== undefined ||
    patch.port !== undefined ||
    patch.encryption !== undefined;

  if (patch.name !== undefined) {
    await withWorkspace(ctx, (tx) =>
      tx.execute(
        rawSql(
          `UPDATE sending_providers SET name = $3, updated_at = now()
            WHERE id = $1 AND workspace_id = $2`,
          [id, ctx.workspaceId, patch.name],
        ),
      ),
    );
  }

  if (touchesSecret) {
    const stored = await getProviderSecret(ctx, id);
    if (!stored) throw new ApiError('not_found');
    const config = decryptProviderConfig({ stored, workspaceId: ctx.workspaceId });
    const next = providerConfigSchema.parse(
      config.kind === 'ses'
        ? {
            ...config,
            ...(patch.access_key_id === undefined ? {} : { access_key_id: patch.access_key_id }),
            ...(patch.secret_access_key === undefined
              ? {}
              : { secret_access_key: patch.secret_access_key }),
          }
        : {
            ...config,
            ...(patch.host === undefined ? {} : { host: patch.host }),
            ...(patch.port === undefined ? {} : { port: patch.port }),
            ...(patch.username === undefined ? {} : { username: patch.username }),
            ...(patch.password === undefined ? {} : { password: patch.password }),
            ...(patch.encryption === undefined ? {} : { encryption: patch.encryption }),
          },
    );
    await withWorkspace(ctx, (tx) =>
      tx.execute(
        rawSql(
          `UPDATE sending_providers
              SET config_encrypted = $3, config_public = $4::jsonb, updated_at = now()
            WHERE id = $1 AND workspace_id = $2`,
          [
            id,
            ctx.workspaceId,
            encryptProviderConfig({ config: next, workspaceId: ctx.workspaceId }),
            JSON.stringify(derivePublicConfig(next)),
          ],
        ),
      ),
    );
  }

  const row = await getProviderById(ctx, id);
  if (!row) throw new ApiError('not_found');
  return { row, credentialsRotated: touchesSecret };
}

async function loadConfigFor(ctx: WorkspaceContext, id: string): Promise<ProviderConfig> {
  const stored = await getProviderSecret(ctx, id);
  if (!stored) throw new ApiError('not_found');
  return decryptProviderConfig({ stored, workspaceId: ctx.workspaceId });
}

/**
 * Test připojení vrací výsledek INLINE, ne jako oznámení: uživatel právě zadal
 * přístupové údaje a čeká odpověď na jednu otázku.
 */
export async function testProviderConnection(
  ctx: WorkspaceContext,
  id: string,
): Promise<{ ok: true; detail: string } | { ok: false; code: string; detail: string }> {
  const config = await loadConfigFor(ctx, id);
  const cfg = loadConfig();

  if (config.kind === 'smtp') {
    const result = await verifySmtp({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      encryption: config.encryption,
      timeoutMs: cfg.AWS_API_TIMEOUT_MS,
    });
    if (result.ok) return { ok: true, detail: 'SMTP server přijal přihlášení.' };
    return { ok: false, code: result.code, detail: result.detail ?? result.code };
  }

  try {
    const aws = createAwsClients(config, cfg.AWS_API_TIMEOUT_MS);
    const account = await aws.ses.send(new GetAccountCommand({}));
    const snapshot = mapAccount(account as never);
    await updateAccountSnapshot(ctx, id, snapshot);
    return { ok: true, detail: 'Amazon odpověděl na dotaz na stav účtu.' };
  } catch (err) {
    return {
      ok: false,
      code: 'provider_credentials_invalid',
      detail: err instanceof Error ? err.message : 'Amazon odmítl přístupové údaje.',
    };
  }
}

export async function refreshQuota(
  ctx: WorkspaceContext,
  id: string,
): Promise<Record<string, unknown>> {
  const config = await loadConfigFor(ctx, id);
  if (config.kind !== 'ses') {
    // SMTP server denní limit nehlásí. Vracet nulu by bylo tvrzení, které neplatí.
    return {
      quota_max_24h: null,
      quota_max_send_rate: config.max_send_rate,
      quota_sent_24h: null,
      production_access: null,
      enforcement_status: null,
      sending_enabled: null,
    };
  }
  const cfg = loadConfig();
  const aws = createAwsClients(config, cfg.AWS_API_TIMEOUT_MS);
  const account = await aws.ses.send(new GetAccountCommand({}));
  const snapshot = mapAccount(account as never);
  await updateAccountSnapshot(ctx, id, snapshot);
  return { ...snapshot };
}

export async function listDomains(ctx: WorkspaceContext): Promise<DomainRow[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<DomainRow>(
      rawSql(`SELECT * FROM sender_domains WHERE workspace_id = $1 ORDER BY domain`, [
        ctx.workspaceId,
      ]),
    );
    return r.rows;
  });
}

/**
 * Založení odesílací domény. U SES se hned volá CreateEmailIdentity, protože bez
 * DKIM tokenů z odpovědi se nedá ukázat, co má uživatel vložit do DNS. Hodnoty
 * se NIKDY neskládají natvrdo: `SigningHostedZone` má v některých regionech jiný
 * tvar a natvrdo složená hodnota vede k doméně, která se nikdy neověří.
 *
 * Když AWS volání selže, doména se založí bez tokenů a uživatel dostane SPF a DMARC
 * záznam. Je to lepší než nezaložit nic: DKIM se doplní při první úspěšné kontrole.
 */
export async function addDomain(
  ctx: WorkspaceContext,
  input: { domain: string; providerId: string },
): Promise<DomainRow> {
  const domain = normalizeDomain(input.domain);
  const provider = await getProviderById(ctx, input.providerId);
  if (!provider) throw new ApiError('not_found');

  let identity: ReturnType<typeof mapIdentity> | null = null;
  if (provider.type === 'ses') {
    try {
      const config = (await loadConfigFor(ctx, input.providerId)) as SesConfig;
      const aws = createAwsClients(config, loadConfig().AWS_API_TIMEOUT_MS);
      await aws.ses.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));
      const got = await aws.ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      identity = mapIdentity(got as never);
    } catch {
      identity = null;
    }
  }

  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<DomainRow>(
      rawSql(
        `INSERT INTO sender_domains
           (workspace_id, provider_id, domain, dkim_tokens, dkim_hosted_zone, dkim_status,
            ses_verification_status)
         VALUES ($1, $2, $3, $4::text[], $5, COALESCE($6,'not_started'), $7)
         ON CONFLICT (workspace_id, lower(domain)) DO UPDATE
           SET provider_id = EXCLUDED.provider_id, updated_at = now()
         RETURNING *`,
        [
          ctx.workspaceId,
          input.providerId,
          domain,
          identity?.dkim_tokens ?? [],
          identity?.dkim_hosted_zone ?? null,
          identity?.dkim_status ?? null,
          identity?.ses_verification_status ?? null,
        ],
      ),
    );
    return r.rows[0]!;
  });
}

/** Záznamy k opsání. Počet se bere z toho, co se opravdu vygeneruje, nikdy natvrdo. */
export function domainRecords(row: DomainRow, region: string): DnsRecord[] {
  return buildDnsRecords({
    domain: row.domain,
    tokens: row.dkim_tokens,
    hostedZone: row.dkim_hosted_zone ?? 'dkim.amazonses.com',
    region,
    mailFromSubdomain: row.mail_from_subdomain,
  });
}

export async function providerRegion(ctx: WorkspaceContext, providerId: string): Promise<string> {
  const provider = await getProviderById(ctx, providerId);
  const config = provider?.config_public as { kind?: string; region?: string } | null;
  return config?.region ?? 'eu-central-1';
}

export async function secondsSinceLastCheck(
  ctx: WorkspaceContext,
  domainId: string,
): Promise<number | null> {
  const row = await getDomain(ctx, domainId);
  if (!row?.checked_at) return null;
  return Math.floor((Date.now() - new Date(row.checked_at).getTime()) / 1000);
}

/**
 * Kontrola DNS na jedno kliknutí. Tuhle funkci potřebuje tlačítko na obrazovce
 * i job `domain.recheck`, takže je jen jedna: dvě kopie by se rozešly přesně v tom,
 * co se ukládá do `checks`.
 */
export async function checkDomainNow(
  ctx: WorkspaceContext,
  domainId: string,
): Promise<{ domain: DomainRow; checks: DomainChecks }> {
  const row = await getDomain(ctx, domainId);
  if (!row) throw new ApiError('not_found');

  const region = await providerRegion(ctx, row.provider_id);
  const cfg = loadConfig();
  const resolver = createResolver(cfg.DNS_CHECK_TIMEOUT_MS);
  const spfHost = row.mail_from_subdomain ? `${row.mail_from_subdomain}.${row.domain}` : row.domain;

  const checks = await runDomainChecks({
    spf: () => checkSpf(resolver, spfHost),
    dkim: () =>
      checkDkim(resolver, {
        domain: row.domain,
        tokens: row.dkim_tokens,
        hostedZone: row.dkim_hosted_zone ?? 'dkim.amazonses.com',
      }),
    dmarc: () =>
      checkDmarc(resolver, row.domain, { hasCustomMailFrom: row.mail_from_subdomain !== null }),
    mx: () => checkMx(resolver, { mailFromDomain: spfHost, region }),
    overallTimeoutMs: cfg.DNS_CHECK_TIMEOUT_MS * 4,
  });

  // Stáří domény se počítá od poslední kontroly, ne od založení: `DomainRow`
  // sloupec `created_at` nenese a přidávat ho do cizí repository nebudu.
  // Doména, která se ještě nekontrolovala, spadne do nejčastější kadence,
  // což je přesně to, co uživatel u nové domény čeká.
  const ageMinutes = row.checked_at
    ? Math.max(0, Math.floor((Date.now() - new Date(row.checked_at).getTime()) / 60_000))
    : 0;
  await saveChecks(ctx, domainId, {
    checks,
    spf: checks.spf.ok,
    dkim: checks.dkim.ok,
    dmarc: checks.dmarc.ok,
    mx: checks.mx.ok,
    nextCheckSeconds: nextCheckAt({
      ageMinutes,
      verified: checks.dkim.ok === true && checks.spf.ok === true,
    }),
  });

  const updated = await getDomain(ctx, domainId);
  return { domain: updated ?? row, checks };
}

export async function setMailFrom(
  ctx: WorkspaceContext,
  domainId: string,
  subdomain: string,
): Promise<DomainRow> {
  const row = await getDomain(ctx, domainId);
  if (!row) throw new ApiError('not_found');

  try {
    const config = (await loadConfigFor(ctx, row.provider_id)) as SesConfig;
    const aws = createAwsClients(config, loadConfig().AWS_API_TIMEOUT_MS);
    await aws.ses.send(
      new PutEmailIdentityMailFromAttributesCommand({
        EmailIdentity: row.domain,
        MailFromDomain: `${subdomain}.${row.domain}`,
        BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
      }),
    );
  } catch {
    // Nastavení u Amazonu se nepovedlo. Sloupec se přesto uloží, aby uživatel viděl
    // záznamy k vložení; kontrola MX pak ukáže, že hotovo ještě není.
  }

  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<DomainRow>(
      rawSql(
        `UPDATE sender_domains
            SET mail_from_subdomain = $3, mail_from_status = 'pending', updated_at = now()
          WHERE id = $1 AND workspace_id = $2
          RETURNING *`,
        [domainId, ctx.workspaceId, subdomain],
      ),
    );
    if (!r.rows[0]) throw new ApiError('not_found');
    return r.rows[0];
  });
}

export async function deleteDomain(ctx: WorkspaceContext, domainId: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const used = await tx.execute<{ n: number }>(
      rawSql(
        `SELECT count(*)::int AS n FROM campaigns
          WHERE workspace_id = $1 AND sender_domain_id = $2
            AND status IN ('scheduled','queueing','sending','paused') AND deleted_at IS NULL`,
        [ctx.workspaceId, domainId],
      ),
    );
    if ((used.rows[0]?.n ?? 0) > 0) {
      throw new ApiError('conflict', { params: { reason: 'domain_in_use' } });
    }
    await tx.execute(
      rawSql(`DELETE FROM sender_domains WHERE id = $1 AND workspace_id = $2`, [
        domainId,
        ctx.workspaceId,
      ]),
    );
  });
}
