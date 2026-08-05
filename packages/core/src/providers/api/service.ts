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
  ListEmailIdentitiesCommand,
  PutAccountDetailsCommand,
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
import {
  isEmailIdentity,
  mapIdentityList,
  verificationState,
  verifiedIdentityNames,
  type SesIdentitySummary,
  type SesVerificationState,
} from '../ses/identities';
import { createAwsClients } from '../ses/client';
import { mapAccount, type AccountSnapshot } from '../ses/account';
import { classifySesError, type SesFailureReason } from '../ses/classify-error';
import { ensureConfigurationSet, ensureEventDestination } from '../ses/events-setup';
import { createSetupClient } from '../ses/setup-client';
import { verifySmtp } from '../smtp/verify';
import { getDomain, saveChecks, saveIdentity, type DomainRow } from '../repo/domain';
import {
  createProvider,
  getProviderById,
  getProviderSecret,
  setProviderStatus,
  updateAccountSnapshot,
  type ProviderRow,
} from '../repo/provider';
import {
  providerStatusDetail,
  providerStatusFrom,
  type ProviderFacts,
  type ProviderStatusDetail,
} from '../status';
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
  /*
   * Nastavení u Amazonu se dorovná HNED při zakládání, ne až někdy.
   *
   * Bez tohohle kroku vznikl účet, který má v konfiguraci jméno konfigurační
   * sady, ale u Amazonu žádnou sadu nemá. Vypadal hotově a neodeslal nic.
   * Selhání se tady NEVYHAZUJE: účet je založený a přístupové údaje jsou
   * uložené, takže shodit celý požadavek by uživatele připravilo i o to.
   * Důvod se uloží do `status_detail` a rovnou po založení ho ukáže ověření,
   * které obrazovka spouští sama.
   */
  if (config.kind === 'ses') {
    const setup = await ensureSesSetup(ctx, id, config);
    const created = await getProviderById(ctx, id);
    if (created) {
      await writeProviderStatus(ctx, created, {
        credentialsValid: setup.configurationSet !== 'error',
        account: null,
        setup,
        detail: setup.detail,
        // Region se zapisuje HNED při zakládání, ještě než proběhne první test.
        // Bez toho měl čerstvě založený účet v stavu `region: null` a obrazovka
        // o něm nesměla nic tvrdit, přestože ho uživatel právě vybral.
        region: config.region,
      });
    }
  }

  const row = await getProviderById(ctx, id);
  if (!row) throw new ApiError('not_found');
  return row;
}

/**
 * Tajemství se mění JEN když se pošle. Odpověď to říká polem `credentials_rotated`,
 * aby uživatel poznal rozdíl mezi „přejmenoval jsem účet" a „vyměnil jsem klíč".
 *
 * `region` a `configuration_set_name` jdou taky přepsat, a je to oprava vady, ne
 * rozšíření z rozmaru: špatný region je jedna ze čtyř věcí, na kterých test
 * připojení u SES nejčastěji selže. Bez tohohle pole by ho uživatel neměl jak
 * spravit a jediné východisko by bylo účet smazat a založit znovu.
 *
 * `credentialsRotated` se hlásí JEN u skutečných přihlašovacích údajů. Změna
 * regionu nebo portu je změna nastavení, ne přetočení klíče, a hlásit ji jako
 * přetočení by uživatele nutilo hledat, kdy si klíč vyměnil.
 */
export async function updateProviderFromApi(
  ctx: WorkspaceContext,
  id: string,
  patch: {
    name?: string | undefined;
    access_key_id?: string | undefined;
    secret_access_key?: string | undefined;
    region?: string | undefined;
    configuration_set_name?: string | undefined;
    password?: string | undefined;
    username?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    encryption?: 'starttls' | 'tls' | 'none' | undefined;
  },
): Promise<{ row: ProviderRow; credentialsRotated: boolean }> {
  const current = await getProviderById(ctx, id);
  if (!current) throw new ApiError('not_found');

  const credentialsRotated =
    patch.access_key_id !== undefined ||
    patch.secret_access_key !== undefined ||
    patch.password !== undefined ||
    patch.username !== undefined;

  const touchesConfig =
    credentialsRotated ||
    patch.region !== undefined ||
    patch.configuration_set_name !== undefined ||
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

  if (touchesConfig) {
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
            ...(patch.region === undefined ? {} : { region: patch.region }),
            ...(patch.configuration_set_name === undefined
              ? {}
              : { configuration_set_name: patch.configuration_set_name }),
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
  return { row, credentialsRotated };
}

async function loadConfigFor(ctx: WorkspaceContext, id: string): Promise<ProviderConfig> {
  const stored = await getProviderSecret(ctx, id);
  if (!stored) throw new ApiError('not_found');
  return decryptProviderConfig({ stored, workspaceId: ctx.workspaceId });
}

/** Zápis ARN topicu do uložené konfigurace. Tajemství se přitom nemění. */
async function saveSnsTopicArn(
  ctx: WorkspaceContext,
  id: string,
  topicArn: string | null,
): Promise<void> {
  const config = await loadConfigFor(ctx, id);
  if (config.kind !== 'ses' || config.sns_topic_arn === topicArn) return;
  const next = providerConfigSchema.parse({ ...config, sns_topic_arn: topicArn });
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

export type SesSetupResult = {
  configurationSet: ProviderStatusDetail['configuration_set'];
  configurationSetName: string;
  events: ProviderStatusDetail['events'];
  snsTopicArn: string | null;
  /** Syrová odpověď Amazonu u nezdaru. Pro uživatele je to podklad pro podporu. */
  detail: string | null;
};

/**
 * DOROVNÁNÍ NASTAVENÍ U AMAZONU. Tohle je ta chybějící spojka.
 *
 * Aplikace si od začátku vymýšlela jméno konfigurační sady (`mlain-<slug>`),
 * ukládala ho do konfigurace a u Amazonu ji NIKDO NEZALOŽIL. Funkce
 * `setupEventDestination` přitom existovala i s testy, jen ji nikdo nevolal.
 * Následek: `ListConfigurationSets` na účtu vracel prázdný seznam a každé
 * odeslání skončilo na `NotFoundException`, tedy `provider_event_config_missing`.
 * Za čtyři dny neodešla jediná zpráva.
 *
 * Volá se ze DVOU míst, a to schválně:
 *
 *  1. při zakládání účtu, kde je to přirozené místo,
 *  2. při testu připojení, aby se dal spravit i účet, který už existuje.
 *
 * Druhá cesta je vědomé rozhodnutí. Alternativou bylo samostatné tlačítko
 * „Dorovnat nastavení u Amazonu", ale to je název, kterému uživatel nerozumí,
 * a tlačítko, na které nemá důvod klikat. Test připojení je naopak přesně to,
 * co člověk zmáčkne, když se ptá „funguje mi to?". Odpověď na tuhle otázku
 * musí zahrnovat i konfigurační sadu, protože bez ní neodejde nic. Nikoho tedy
 * nenutíme účet smazat a založit znovu.
 *
 * DVA KROKY, DVA RŮZNÉ DOPADY. Konfigurační sada je podmínka odesílání a její
 * selhání se hlásí nahlas. Nastavení událostí je zpětná vazba: bez ní se dá
 * odesílat, jen se nedozvíme o odrazech, takže selhání účet nesloží.
 */
export async function ensureSesSetup(
  ctx: WorkspaceContext,
  providerId: string,
  config: SesConfig,
): Promise<SesSetupResult> {
  const cfg = loadConfig();
  const aws = createSetupClient(createAwsClients(config, cfg.AWS_API_TIMEOUT_MS));

  /*
   * JMÉNO SADY SE BERE Z ULOŽENÉ KONFIGURACE, ne se dopočítává ze slugu.
   *
   * Je to jediné rozhodnutí, které tuhle opravu drží pohromadě. Sender posílá
   * s tím, co je v `configuration_set_name`, a `configurationSetNameFor` počítá
   * `mlain-<slug>`. Dokud se obě hodnoty shodují, není to vidět, jenže dialog
   * úpravy účtu jméno sady VÝSLOVNĚ dovoluje přepsat. V tu chvíli by se založila
   * sada s jedním jménem a odesílalo by se pod druhým, tedy přesně tatáž vada,
   * jen o jedno kolečko dál. Zdroj pravdy je proto jeden: uložená konfigurace.
   *
   * Jméno SNS topicu se naopak počítá ze slugu projektu a na jméno sady se
   * neváže: topic patří projektu, ne konkrétní sadě, a přejmenování sady nesmí
   * založit druhý topic vedle toho, který má odběr.
   */
  const name = config.configuration_set_name;
  const workspaceSlug = ctx.workspaceId.slice(0, 8);

  try {
    await ensureConfigurationSet(aws, { configurationSetName: name, workspaceId: ctx.workspaceId });
  } catch (err) {
    return {
      configurationSet: 'error',
      configurationSetName: name,
      events: 'not_configured',
      snsTopicArn: config.sns_topic_arn,
      detail: err instanceof Error ? err.message : 'Amazon konfigurační sadu nezaložil.',
    };
  }

  try {
    const events = await ensureEventDestination(aws, {
      workspaceSlug,
      workspaceId: ctx.workspaceId,
      providerId,
      appUrl: cfg.APP_URL,
      region: config.region,
      configurationSetName: name,
    });
    // ARN topicu se ukládá i tehdy, když se odběr nepovedl: topic u Amazonu
    // vznikl a příští běh ho má najít, ne založit podruhé.
    await saveSnsTopicArn(ctx, providerId, events.topicArn);
    return {
      configurationSet: 'ok',
      configurationSetName: name,
      // Nezdařený odběr je `pending`, ne `error`. Cíl událostí u Amazonu stojí,
      // chybí jen potvrzení z naší strany, a na `localhost` chybět bude vždy.
      events: events.subscribed ? 'confirmed' : 'pending',
      snsTopicArn: events.topicArn,
      detail: events.subscribeError,
    };
  } catch (err) {
    // Sada existuje, takže odesílat lze. Chybí jen zpětná vazba.
    return {
      configurationSet: 'ok',
      configurationSetName: name,
      events: 'error',
      snsTopicArn: config.sns_topic_arn,
      detail: err instanceof Error ? err.message : 'Nastavení událostí u Amazonu selhalo.',
    };
  }
}

/**
 * Zápis stavu účtu. VŽDY po každém zjištění, ať dopadlo jakkoli.
 *
 * Úspěšné i neúspěšné ověření zapisuje stejnou cestou: odznak na obrazovce se
 * tak nemá jak rozejít s tím, co test právě zjistil. Do `status_detail` jde
 * i důvod, aby obrazovka uměla říct, co konkrétně chybí, ne jen „neověřený".
 */
async function writeProviderStatus(
  ctx: WorkspaceContext,
  provider: ProviderRow,
  input: {
    credentialsValid: boolean;
    account: AccountSnapshot | null;
    setup: SesSetupResult | null;
    detail: string | null;
    /**
     * REGION, ZE KTERÉHO SE ODESÍLÁ, a co má Amazon ověřené PRÁVĚ V NĚM.
     *
     * Obojí je nepovinné a `undefined` znamená „nezjišťovali jsme". Rozdíl proti
     * prázdnému poli je zásadní: prázdné pole se na obrazovce čte jako „v tomhle
     * regionu nemáte ověřenou ani jednu adresu", což je nejtvrdší možná zpráva.
     * Tvrdit ji bez dat je přesně ta chyba, kvůli které tenhle parametr vznikl.
     */
    region?: string | null | undefined;
    verifiedIdentities?: string[] | undefined;
    /** Úplný počet, když je předaný výčet zkrácený. Viz `providerStatusDetail`. */
    verifiedIdentityCount?: number | null | undefined;
  },
): Promise<{ status: string; statusDetail: ProviderStatusDetail }> {
  const identityCount = input.verifiedIdentityCount ?? input.verifiedIdentities?.length ?? null;
  const domains = await listDomains(ctx);
  const mine = domains.filter((d) => d.provider_id === provider.id);
  const facts: ProviderFacts = {
    kind: provider.type === 'smtp' ? 'smtp' : 'ses',
    disabled: provider.status === 'disabled',
    credentialsValid: input.credentialsValid,
    account:
      input.account === null
        ? null
        : {
            enforcement_status: input.account.enforcement_status,
            sending_enabled: input.account.sending_enabled,
            production_access: input.account.production_access,
          },
    configurationSet: input.setup?.configurationSet ?? 'not_applicable',
    events: input.setup?.events ?? 'not_applicable',
    domainVerified: mine.some((d) => d.verified_at !== null),
    // `null` znamená „nevíme" a doménu to nediskvalifikuje, viz kritérium 43 části 4a.
    dmarcOk: !mine.some((d) => d.dmarc_ok === false),
    verifiedIdentityCount: identityCount,
  };
  const status = providerStatusFrom(facts);
  const statusDetail = providerStatusDetail(facts, {
    now: new Date(),
    snsTopicArn: input.setup?.snsTopicArn ?? null,
    configurationSetName: input.setup?.configurationSetName ?? null,
    detail: input.detail ?? input.setup?.detail ?? null,
    region: input.region ?? null,
    ...(input.verifiedIdentities === undefined
      ? {}
      : { verifiedIdentities: input.verifiedIdentities, verifiedIdentityCount: identityCount }),
  });
  await setProviderStatus(ctx, provider.id, status, statusDetail);
  return { status, statusDetail };
}

/**
 * Ověřené identity účtu V REGIONU ÚČTU.
 *
 * Vrací `undefined`, když se seznam nepodařilo načíst, a je to vědomé:
 * „nedovolali jsme se" se nesmí zapsat jako „nemáte tu ověřeného nic".
 * Klíč bez oprávnění `ses:ListEmailIdentities` je běžný případ a nesmí kvůli
 * němu spadnout test připojení, který jinak dopadl dobře.
 */
async function loadVerifiedIdentities(config: SesConfig): Promise<string[] | undefined> {
  try {
    const aws = createAwsClients(config, loadConfig().AWS_API_TIMEOUT_MS);
    // Stránkuje se jen první stránka a je to schválně: `PageSize` je u Amazonu
    // nejvýš 1000 a stav účtu není adresář. Do stavu se stejně ukládá zkrácený
    // výčet, úplný počet a nic víc.
    const r = await aws.ses.send(new ListEmailIdentitiesCommand({ PageSize: 1000 }));
    return verifiedIdentityNames(r.EmailIdentities ?? []);
  } catch {
    return undefined;
  }
}

/**
 * Přepočet stavu účtu z toho, co už je uložené, bez volání poskytovatele.
 *
 * Potřebuje ho ověření domény: jakmile Amazon potvrdí identitu, přestává platit
 * blokující důvod `domain_not_verified` a účet se má posunout hned, ne až
 * u dalšího testu připojení.
 */
export async function recomputeProviderStatus(
  ctx: WorkspaceContext,
  providerId: string,
): Promise<void> {
  const provider = await getProviderById(ctx, providerId);
  if (!provider) return;
  const detail = (provider.status_detail ?? null) as ProviderStatusDetail | null;
  // Bez předchozího ověření se stav nepřepočítává: nevíme, jestli údaje fungují,
  // a hádat to znamená napsat na obrazovku tvrzení, které jsme nikdy neověřili.
  if (!detail || detail.credentials_ok !== true) return;
  await writeProviderStatus(ctx, provider, {
    // Region a ověřené identity se PŘENÁŠEJÍ z minulého ověření, ne zahazují.
    // Přepočet Amazona nevolá, takže by je jinak přepsal na `null` a obrazovka
    // by po ověření domény přestala umět říct, ve kterém regionu účet je.
    region: detail.region,
    ...(detail.verified_identity_count === null
      ? {}
      : {
          verifiedIdentities: detail.verified_identities,
          verifiedIdentityCount: detail.verified_identity_count,
        }),
    credentialsValid: true,
    account:
      provider.type === 'ses'
        ? {
            quota_max_24h: provider.quota_max_24h,
            quota_max_send_rate:
              provider.quota_max_send_rate === null ? null : Number(provider.quota_max_send_rate),
            quota_sent_24h: provider.quota_sent_24h,
            production_access: provider.production_access,
            enforcement_status: provider.enforcement_status,
            sending_enabled: provider.sending_enabled,
            review_status: null,
          }
        : null,
    setup:
      provider.type === 'ses'
        ? {
            configurationSet: detail.configuration_set,
            configurationSetName: detail.configuration_set_name ?? '',
            events: detail.events,
            snsTopicArn: detail.sns_topic_arn,
            detail: detail.detail,
          }
        : null,
    detail: detail.detail,
  });
}

export type TestConnectionResult =
  /**
   * `sandbox` je součást ÚSPĚŠNÉHO výsledku, ne chyba. Účet v sandboxu má platné
   * údaje a spojení funguje, jenom Amazon doručí výhradně na ověřené adresy.
   * Kdyby to byla chyba, uživatel by opravoval klíč, se kterým není nic špatně.
   *
   * `status` a `status_detail` jsou tu proto, aby si obrazovka NEMOHLA protiřečit.
   * Odznak i výsledek testu se od téhle chvíle kreslí z JEDNÉ odpovědi, takže
   * nemá jak vzniknout snímek s odznakem „Neověřený" a větou „Ověřeno".
   */
  | {
      ok: true;
      detail: string;
      sandbox: boolean;
      status: string;
      status_detail: ProviderStatusDetail;
    }
  /**
   * `reason` doplňuje `code` u SES, kde je registrovaný kód jenom jeden. Obrazovka
   * podle něj vybere radu, co konkrétně opravit. U SMTP je `null`, protože tam
   * nese tutéž informaci už samotný kód (`provider_smtp_auth_failed` a spol.).
   */
  | {
      ok: false;
      code: string;
      reason: SesFailureReason | null;
      detail: string;
      status: string;
      status_detail: ProviderStatusDetail;
    };

/**
 * Test připojení vrací výsledek INLINE, ne jako oznámení: uživatel právě zadal
 * přístupové údaje a čeká odpověď na jednu otázku.
 *
 * A ZAPISUJE VÝSLEDEK. Dokud to nedělal, byla to jediná obrazovka v nástroji,
 * která uměla tvrdit dvě protichůdné věci najednou: `sending_providers.status`
 * zůstával na `unverified`, protože ho nenastavoval vůbec nikdo, kdežto
 * výsledek testu se bral z čerstvé odpovědi Amazonu. Zapisuje se OBOJÍ, úspěch
 * i nezdar, protože jednosměrný zápis by jen posunul rozpor o krok dál.
 *
 * Součástí testu je i kontrola a dorovnání nastavení u Amazonu. Bez konfigurační
 * sady neodejde ani jedna zpráva, takže test, který se na ni nepodívá,
 * neodpovídá na otázku, kterou uživatel položil.
 */
export async function testProviderConnection(
  ctx: WorkspaceContext,
  id: string,
): Promise<TestConnectionResult> {
  const provider = await getProviderById(ctx, id);
  if (!provider) throw new ApiError('not_found');
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
    const written = await writeProviderStatus(ctx, provider, {
      credentialsValid: result.ok,
      account: null,
      setup: null,
      detail: result.ok ? null : (result.detail ?? result.code),
    });
    if (result.ok) {
      return {
        ok: true,
        detail: 'SMTP server přijal přihlášení.',
        sandbox: false,
        status: written.status,
        status_detail: written.statusDetail,
      };
    }
    return {
      ok: false,
      code: result.code,
      reason: null,
      detail: result.detail ?? result.code,
      status: written.status,
      status_detail: written.statusDetail,
    };
  }

  let snapshot;
  try {
    const aws = createAwsClients(config, cfg.AWS_API_TIMEOUT_MS);
    const account = await aws.ses.send(new GetAccountCommand({}));
    snapshot = mapAccount(account as never);
    await updateAccountSnapshot(ctx, id, snapshot);
  } catch (err) {
    const written = await writeProviderStatus(ctx, provider, {
      credentialsValid: false,
      account: null,
      setup: null,
      detail: err instanceof Error ? err.message : 'Amazon odmítl přístupové údaje.',
      // Region platí i u nezdaru: uživatel se právě dozvěděl, že mu nefunguje
      // účet, a musí u toho vidět, KTERÉHO REGIONU se to týká. Bez toho hledá
      // chybu v konzoli přepnuté někam jinam, což je celý ten čtyřdenní příběh.
      region: config.region,
    });
    return {
      ok: false,
      code: 'provider_credentials_invalid',
      reason: classifySesError(err),
      detail: err instanceof Error ? err.message : 'Amazon odmítl přístupové údaje.',
      status: written.status,
      status_detail: written.statusDetail,
    };
  }

  // Klíč funguje. Teď to podstatnější: existuje u Amazonu konfigurační sada,
  // bez které neodejde nic? Když ne, tenhle krok ji založí.
  const setup = await ensureSesSetup(ctx, id, config);
  /*
   * A nakonec otázka, kterou dosud nikdo nepoložil: CO MÁ ÚČET OVĚŘENÉ PRÁVĚ
   * V TOMHLE REGIONU? Účet v testovacím režimu doručí výhradně na ověřené
   * identity, a když v regionu, ze kterého odesíláme, žádná není, neodejde
   * vůbec nic, ani na vlastní adresu. Zadavatel měl ověřené tři adresy, jenže
   * v Severní Virginii, zatímco produkt posílal z Frankfurtu, a produkt o tom
   * mlčel. Seznam se proto tahá VŽDY a ve stejném regionu jako odesílání.
   */
  const verifiedIdentities = await loadVerifiedIdentities(config);
  const written = await writeProviderStatus(ctx, provider, {
    credentialsValid: true,
    account: snapshot,
    setup,
    detail: setup.detail,
    region: config.region,
    ...(verifiedIdentities === undefined ? {} : { verifiedIdentities }),
  });

  if (setup.configurationSet === 'error') {
    /*
     * Přístupové údaje platí, ale sada u Amazonu není a nejde založit. Je to
     * nezdar, a musí se ohlásit jako nezdar: kdyby test skončil úspěchem,
     * uživatel by se o vadě dozvěděl až tím, že mu neodejde kampaň. Přesně
     * tohle se stalo a stálo to čtyři dny.
     */
    return {
      ok: false,
      code: 'provider_credentials_invalid',
      reason: 'permissions',
      detail: setup.detail ?? 'Konfigurační sadu u Amazonu se nepodařilo založit.',
      status: written.status,
      status_detail: written.statusDetail,
    };
  }

  return {
    ok: true,
    detail: 'Amazon odpověděl na dotaz na stav účtu.',
    // Neznámá hodnota se NEPOVAŽUJE za sandbox. Tvrdit uživateli omezení,
    // které jsme si nepřečetli, je horší než o něm mlčet.
    sandbox: snapshot.production_access === false,
    status: written.status,
    status_detail: written.statusDetail,
  };
}

export async function refreshQuota(
  ctx: WorkspaceContext,
  id: string,
): Promise<Record<string, unknown>> {
  const provider = await getProviderById(ctx, id);
  if (!provider) throw new ApiError('not_found');
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
  // Čerstvý stav účtu mění i to, jestli se s ním smí odesílat: `SHUTDOWN`
  // nebo vypnuté odesílání musí účet posunout na `blocked` hned, ne až
  // u příštího testu připojení.
  await recomputeProviderStatus(ctx, id);
  return { ...snapshot };
}

/* ------------------------------------------------------------------ *
 * OVĚŘENÍ ADRESY ODESÍLATELE PŘÍMO Z NAŠÍ APLIKACE
 * ------------------------------------------------------------------ */

/**
 * Načte konfiguraci SES, nebo srozumitelně odmítne.
 *
 * U účtu SMTP nemá „ověření adresy u Amazonu" žádný význam a odpověď musí být
 * odmítnutí, ne tichý úspěch nad nic nedělající operací.
 */
async function sesConfigFor(ctx: WorkspaceContext, id: string): Promise<SesConfig> {
  const provider = await getProviderById(ctx, id);
  if (!provider) throw new ApiError('not_found');
  const config = await loadConfigFor(ctx, id);
  if (config.kind !== 'ses') {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: 'provider_id',
          code: 'invalid_value',
          message: 'Adresy u Amazonu se ověřují jen u účtu Amazon SES, ne u vlastního SMTP.',
        },
      ],
    });
  }
  return config;
}

/** Chyba od Amazonu přeložená na odpověď API. Syrový text jde s ní, ne místo ní. */
function sesCallFailed(err: unknown, fallback: string): ApiError {
  const detail = err instanceof Error && err.message !== '' ? err.message : fallback;
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'ConflictException') {
    return new ApiError('conflict', { params: { detail, reason: 'ses_conflict' } });
  }
  return new ApiError('provider_credentials_invalid', {
    params: { detail, reason: classifySesError(err) },
  });
}

export type ProviderIdentitiesView = {
  /** Region, ve kterém se ptáme. Bez něj je seznam identit tvrzení bez kontextu. */
  region: string;
  identities: SesIdentitySummary[];
};

/**
 * Co má účet ověřené v regionu účtu.
 *
 * Region se vrací VŽDY a je to hlavní část odpovědi, ne ozdoba. Právě rozpor
 * mezi regionem v konzoli a regionem, ze kterého produkt odesílá, stál zadavatele
 * čtyři dny, a seznam identit bez uvedení regionu ten rozpor jen zopakuje.
 */
export async function listProviderIdentities(
  ctx: WorkspaceContext,
  id: string,
): Promise<ProviderIdentitiesView> {
  const config = await sesConfigFor(ctx, id);
  const aws = createAwsClients(config, loadConfig().AWS_API_TIMEOUT_MS);
  try {
    const r = await aws.ses.send(new ListEmailIdentitiesCommand({ PageSize: 1000 }));
    return { region: config.region, identities: mapIdentityList(r.EmailIdentities ?? []) };
  } catch (err) {
    throw sesCallFailed(err, 'Seznam ověřených identit se od Amazonu nepodařilo načíst.');
  }
}

export type EmailIdentityView = {
  region: string;
  email: string;
  status: SesVerificationState;
  /** Amazon z téhle adresy odesílat dovolí. Jediné, co rozhoduje o odeslání. */
  verified: boolean;
  /** Adresa u Amazonu existovala už předtím. Znamená to, že další e-mail nepřišel. */
  already_existed: boolean;
};

/**
 * ZALOŽENÍ IDENTITY PRO E-MAILOVOU ADRESU (`CreateEmailIdentity`).
 *
 * Tohle je ta cesta, kvůli které uživatel nemusí do konzole Amazonu vůbec.
 * Amazon po tomhle volání pošle na zadanou adresu potvrzovací e-mail; identita
 * je ověřená až ve chvíli, kdy někdo klikne na odkaz v NĚM. Potvrzení tedy
 * neposíláme my a nemáme jak ho urychlit ani zopakovat jinak než opakovaným
 * voláním.
 *
 * ADRESA, KTERÁ UŽ EXISTUJE, NENÍ CHYBA. `AlreadyExistsException` znamená, že
 * identitu má účet v tomhle regionu založenou z dřívějška, a jediná správná
 * reakce je přečíst si její stav a ukázat ho. Kdyby se vracela chyba, uživatel
 * by opravoval adresu, se kterou není nic špatně, a hlavně by se nedozvěděl to
 * jediné podstatné: jestli je už potvrzená.
 *
 * DOMÉNA SEM NEPATŘÍ. Odesílací doména má vlastní cestu (`addDomain`) s DKIM
 * záznamy a vlastní obrazovkou; kdyby ji brala i tahle akce, vznikla by druhá
 * cesta k témuž a obě by se rozešly v tom, co se ukládá.
 */
export async function verifyEmailIdentity(
  ctx: WorkspaceContext,
  id: string,
  emailInput: string,
): Promise<EmailIdentityView> {
  const email = emailInput.trim().toLowerCase();
  if (!isEmailIdentity(email)) {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: 'email',
          code: 'invalid_value',
          message: `${emailInput} není e-mailová adresa.`,
        },
      ],
    });
  }

  const config = await sesConfigFor(ctx, id);
  const aws = createAwsClients(config, loadConfig().AWS_API_TIMEOUT_MS);

  let alreadyExisted = false;
  try {
    await aws.ses.send(new CreateEmailIdentityCommand({ EmailIdentity: email }));
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AlreadyExistsException') {
      alreadyExisted = true;
    } else {
      throw sesCallFailed(err, 'Amazon adresu k ověření nepřijal.');
    }
  }

  /*
   * Stav se čte HNED po založení, ne odhaduje. `CreateEmailIdentity` sice vrací
   * `VerifiedForSendingStatus`, ale u adresy, kterou účet zná z dřívějška,
   * jsme ho vůbec nedostali (volání skončilo na `AlreadyExistsException`).
   * Jeden dotaz navíc je levnější než dvě různé cesty ke stejné odpovědi.
   */
  try {
    const got = await aws.ses.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
    const status = verificationState({
      VerificationStatus: got.VerificationStatus,
      VerifiedForSendingStatus: got.VerifiedForSendingStatus,
    });
    return {
      region: config.region,
      email,
      status,
      verified: status === 'verified',
      already_existed: alreadyExisted,
    };
  } catch (err) {
    throw sesCallFailed(err, 'Stav adresy se od Amazonu nepodařilo přečíst.');
  }
}

/** Stav jedné adresy. Tlačítko „Zjistit stav" se ptá Amazonu, ne naší paměti. */
export async function emailIdentityStatus(
  ctx: WorkspaceContext,
  id: string,
  emailInput: string,
): Promise<EmailIdentityView> {
  const email = emailInput.trim().toLowerCase();
  const config = await sesConfigFor(ctx, id);
  const aws = createAwsClients(config, loadConfig().AWS_API_TIMEOUT_MS);
  try {
    const got = await aws.ses.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
    const status = verificationState({
      VerificationStatus: got.VerificationStatus,
      VerifiedForSendingStatus: got.VerifiedForSendingStatus,
    });
    return {
      region: config.region,
      email,
      status,
      verified: status === 'verified',
      already_existed: true,
    };
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'NotFoundException') {
      throw new ApiError('not_found', {
        params: { detail: `${email} u Amazonu nemáte založenou.` },
      });
    }
    throw sesCallFailed(err, 'Stav adresy se od Amazonu nepodařilo přečíst.');
  }
}

/**
 * ŽÁDOST O PRODUKČNÍ PŘÍSTUP (`PutAccountDetails`).
 *
 * Ověřeno v dokumentaci `docs.aws.amazon.com/ses/latest/APIReference-V2/API_PutAccountDetails.html`
 * (4. 8. 2026): jde to a je to běžná cesta, ne obcházení konzole. Příručka SES
 * ji sama nabízí i přes AWS CLI. Povinné jsou přesně dva údaje, `MailType`
 * a `WebsiteURL`; o vyřazení z testovacího režimu se žádá polem
 * `ProductionAccessEnabled`.
 *
 * TŘI VĚCI, KTERÉ MUSÍ VĚDĚT UŽIVATEL PŘEDEM, a proto je říká i obrazovka:
 *
 *  1. Žádost posuzuje ČLOVĚK z podpory AWS. První odpověď přijde do 24 hodin.
 *  2. Během posuzování NEJDE údaje změnit. Druhé volání skončí na
 *     `ConflictException`, tedy 409, a čekat se musí do konce posouzení.
 *  3. Testovací režim je vázaný NA REGION. Schválení v Irsku neznamená nic pro
 *     Frankfurt. Žádost proto odchází do regionu účtu a obrazovka ho pojmenuje.
 *
 * `UseCaseDescription` se NEPOSÍLÁ: dokumentace ho označuje za deprecated.
 */
export type ProductionAccessInput = {
  mail_type: 'MARKETING' | 'TRANSACTIONAL';
  website_url: string;
  additional_contact_emails?: string[] | undefined;
  contact_language?: 'EN' | 'JA' | undefined;
};

export async function requestProductionAccess(
  ctx: WorkspaceContext,
  id: string,
  input: ProductionAccessInput,
): Promise<{ region: string; submitted: true }> {
  const config = await sesConfigFor(ctx, id);
  const aws = createAwsClients(config, loadConfig().AWS_API_TIMEOUT_MS);
  const contacts = (input.additional_contact_emails ?? []).filter((e) => e.trim() !== '');
  try {
    await aws.ses.send(
      new PutAccountDetailsCommand({
        MailType: input.mail_type,
        WebsiteURL: input.website_url,
        ProductionAccessEnabled: true,
        // Amazon bere nejvýš čtyři adresy. Páté by shodilo celé volání, takže
        // se zbytek zahodí tady, kde to jde vysvětlit, ne u Amazonu.
        ...(contacts.length === 0 ? {} : { AdditionalContactEmailAddresses: contacts.slice(0, 4) }),
        ...(input.contact_language === undefined
          ? {}
          : { ContactLanguage: input.contact_language }),
      }),
    );
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'ConflictException') {
      throw new ApiError('conflict', {
        params: {
          reason: 'production_access_review_in_progress',
          detail:
            'Amazon už jednu žádost posuzuje. Než ji dokončí, další podat ani údaje změnit nejde.',
        },
      });
    }
    throw sesCallFailed(err, 'Amazon žádost o produkční přístup nepřijal.');
  }
  // Stav účtu se hned přečte znovu: `production_access` je součást odznaku
  // i seznamu překážek a čekat s ním na příští test připojení nemá důvod.
  await refreshQuota(ctx, id);
  return { region: config.region, submitted: true };
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

  const inserted = await withWorkspace(ctx, async (tx) => {
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

  /*
   * Doména, kterou má Amazon ověřenou už z dřívějška, je ověřená OD TÉTO CHVÍLE,
   * ne až po první kontrole. Stává se to běžně: identita se u Amazonu nemaže ani
   * při odebrání domény z nástroje (viz `deleteDomain`), takže druhé přidání téže
   * domény ji zastihne hotovou. `verified_at` se přitom plní jen tudy, aby existoval
   * jediný zdroj pravdy.
   */
  if (identity) {
    await saveIdentity(ctx, inserted.id, {
      sesVerificationStatus: identity.ses_verification_status,
      dkimStatus: identity.dkim_status,
      dkimTokens: identity.dkim_tokens,
      dkimHostedZone: identity.dkim_hosted_zone,
      mailFromStatus: identity.mail_from_status,
    });
    return (await getDomain(ctx, inserted.id)) ?? inserted;
  }
  return inserted;
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
 * Dotaz Amazonu na SKUTEČNÝ stav identity (`GetEmailIdentity`).
 *
 * Tohle je odpověď na otázku „ověřil už Amazon naši doménu?". Naše kontrola DNS
 * ji nezodpoví: ta jen říká, co vidíme my. Doména `brevio.cz` měla v DNS všechno
 * v pořádku a Amazon ji přesto držel na `PENDING`, protože se ho na to od
 * založení nikdo nezeptal.
 *
 * Vrací `null`, když se Amazona nedovoláme. Uložený stav se v takovém případě
 * nemění: „nedovolali jsme se" není „není ověřeno".
 */
export async function refreshDomainIdentity(
  ctx: WorkspaceContext,
  domainId: string,
): Promise<string | null> {
  const row = await getDomain(ctx, domainId);
  if (!row) throw new ApiError('not_found');
  const provider = await getProviderById(ctx, row.provider_id);
  if (!provider || provider.type !== 'ses') return null;

  try {
    const config = (await loadConfigFor(ctx, row.provider_id)) as SesConfig;
    const aws = createAwsClients(config, loadConfig().AWS_API_TIMEOUT_MS);
    const got = await aws.ses.send(new GetEmailIdentityCommand({ EmailIdentity: row.domain }));
    const identity = mapIdentity(got as never);
    await saveIdentity(ctx, domainId, {
      sesVerificationStatus: identity.ses_verification_status,
      dkimStatus: identity.dkim_status,
      dkimTokens: identity.dkim_tokens,
      dkimHostedZone: identity.dkim_hosted_zone,
      mailFromStatus: identity.mail_from_status,
    });
    // Ověřená doména je poslední chybějící podmínka `verifying → ready`, takže
    // se stav účtu přepočítá hned. Jinak by účet zůstal viset na `verifying`
    // až do dalšího testu připojení a uživatel by nevěděl, na co čeká.
    await recomputeProviderStatus(ctx, row.provider_id);
    return identity.ses_verification_status;
  } catch {
    return null;
  }
}

/**
 * Kontrola domény na jedno kliknutí. Tuhle funkci potřebuje tlačítko na obrazovce
 * i job `domain.recheck`, takže je jen jedna: dvě kopie by se rozešly přesně v tom,
 * co se ukládá do `checks`.
 *
 * Kontroluje se DVOJE a v tomhle pořadí: nejdřív DNS, pak verdikt Amazonu.
 * Pořadí je věcné, ne náhodné. Amazon se dívá do téhož DNS, takže dotaz položený
 * až po naší kontrole má šanci vrátit čerstvější odpověď. Dotaz na Amazona nesmí
 * shodit kontrolu DNS: výsledek DNS je uložený dřív a nezávisle.
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
    /*
     * MX se kontroluje JEN u domény s vlastní zpáteční adresou (MAIL FROM).
     * Bez ní SES používá vlastní zpáteční doménu, žádný MX záznam se uživateli
     * neukazuje a `buildDnsRecords` ho ani negeneruje. Dřív se kontrola pouštěla
     * pořád, proti apexu domény, takže brala MX uživatelovy poštovní schránky
     * (u brevio.cz `mail.brevio.cz`) a hlásila neshodu proti
     * `feedback-smtp.<region>.amazonses.com`. Uživatel dostal požadavek na záznam,
     * který nikde neviděl, a splnit ho nemohl: přepsáním apexového MX by si
     * odstřihl příchozí poštu.
     */
    mx: row.mail_from_subdomain
      ? () => checkMx(resolver, { mailFromDomain: spfHost, region })
      : null,
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
    // Nekontrolované MX se ukládá jako `null`, tedy „nevíme", ne jako `false`.
    mx: checks.mx?.ok ?? null,
    nextCheckSeconds: nextCheckAt({
      ageMinutes,
      verified: checks.dkim.ok === true && checks.spf.ok === true,
    }),
  });

  await refreshDomainIdentity(ctx, domainId);

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

/**
 * Odebrání odesílací domény.
 *
 * Odmítnutí má DVA různé důvody a uživatel musí poznat který, protože se řeší
 * úplně jinak:
 *
 *  - `domain_in_use`: přes doménu právě běží nebo je naplánovaná kampaň. Řešení
 *    je počkat nebo kampaň zrušit, pak odebrání projde.
 *  - `domain_has_campaigns`: doménu drží HOTOVÁ kampaň, tedy rozepsaná, odeslaná
 *    nebo zrušená. Cizí klíč `campaigns.sender_domain_id` je `ON DELETE RESTRICT`
 *    (ověřeno v `information_schema` na `mlain_clean`), takže mazání zablokuje
 *    i odeslaná kampaň z loňska a i kampaň smazaná do koše, protože měkké smazání
 *    řádek nezahodí. Bez téhle větve se DELETE utopil v chybě 23503 a uživatel
 *    dostal obecnou chybu serveru.
 *
 * Výchozí doména neexistuje: příznak `is_default` má odesílací ÚČET, ne doména,
 * takže odebrání domény žádný „výchozí" stav neruší.
 *
 * Identita u poskytovatele se NERUŠÍ. `DeleteEmailIdentityCommand` se v celém
 * repozitáři nevolá a volat se nebude: tentýž účet SES může být připojený k víc
 * projektům a zrušením identity by se rozbily i ony. Doména tedy u Amazonu
 * zůstane ověřená a po opětovném přidání se použije znovu.
 */
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

    // Bez filtru na `deleted_at` a bez filtru na stav: cizí klíč je nezná.
    const held = await tx.execute<{ n: number }>(
      rawSql(
        `SELECT count(*)::int AS n FROM campaigns
          WHERE workspace_id = $1 AND sender_domain_id = $2`,
        [ctx.workspaceId, domainId],
      ),
    );
    const count = held.rows[0]?.n ?? 0;
    if (count > 0) {
      throw new ApiError('conflict', { params: { reason: 'domain_has_campaigns', count } });
    }

    await tx.execute(
      rawSql(`DELETE FROM sender_domains WHERE id = $1 AND workspace_id = $2`, [
        domainId,
        ctx.workspaceId,
      ]),
    );
  });
}
