import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../tx';
import { validationFailed } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { IdentityAuditActions } from '../identity/audit';

/**
 * Stav a nastavení systémové pošty projektu.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Systémová pošta byla nepojmenovaný stav odvozený
 * uvnitř odesílatele. Instalace s jediným odesílacím účtem typu SES ji odeslat
 * neuměla a uživatel se to nedozvěděl NIKDE: pozvánka se tvářila jako odeslaná,
 * obnova hesla skončila v logu a adresa odesílatele (`mlain@doména`) se nikde
 * neukazovala ani nedala změnit. Zmatek nevznikal z jednoho chybějícího tlačítka,
 * ale z toho, že stav nebyl vidět. (Účet typu SES odesílat umí od doplnění
 * `platform/system-mail-ses.ts`; stav je ale pořád potřeba ukázat, protože účet
 * může chybět nebo být vypnutý.)
 *
 * Tenhle soubor je jediný zdroj pravdy pro tři otázky: KTERÝM účtem se systémová
 * pošta odešle, Z JAKÉ adresy, a CO chybí, když to nejde. Odpovídá na ně jak
 * obrazovka, tak `DefaultSystemMailer`, takže se nemůže stát, že obrazovka slíbí
 * něco jiného, než odesílatel udělá.
 */

/**
 * Typy odesílacích účtů, kterými se systémová pošta odsud poslat DÁ.
 *
 * Byl to jednoprvkový seznam `['smtp']` a bylo to popsané jako známé omezení
 * produktu: klient SES prý žije jen v odesílači v Go. To přestalo platit.
 * `@aws-sdk/client-sesv2` je v `packages/core` kvůli ověřování domén a
 * konfiguračních sad, takže odeslání přes SES je jedno volání navíc
 * (`platform/system-mail-ses.ts`), ne druhá implementace podpisu AWS.
 *
 * Kdo sem přidá další typ, musí zároveň doplnit větev v `DefaultSystemMailer.send`,
 * jinak obrazovka začne slibovat víc, než produkt umí.
 */
export const SYSTEM_MAIL_CAPABLE_TYPES: readonly string[] = ['smtp', 'ses'];

/** Účty, které jsou zablokované nebo vypnuté, se neberou v úvahu vůbec. */
export const SYSTEM_MAIL_ACCOUNT_FILTER = `p.status NOT IN ('blocked', 'disabled')`;

/**
 * Automatický výběr: rozhoduje `is_default`, pak stáří.
 *
 * Do teď měl přednost typ SMTP před výchozím účtem, protože jen jím systémová
 * pošta odešla. Ta přednost padá spolu s omezením: když projekt odešle oběma
 * typy, je správná odpověď ta, kterou si uživatel zvolil jako výchozí. Kdyby
 * SMTP přednost zůstala, odcházela by systémová pošta z jiné domény, než
 * uživatel v nastavení vidí jako výchozí, a nikde by se to nevysvětlilo.
 */
export const SYSTEM_MAIL_ACCOUNT_ORDER = `p.is_default DESC, p.created_at`;

/** Lokální část adresy odesílatele, když si uživatel nezvolil vlastní. */
export const SYSTEM_MAIL_DEFAULT_LOCAL_PART = 'mlain';

export type SystemMailUnavailableReason =
  /** Projekt nemá ani jeden použitelný odesílací účet. */
  | 'no_account'
  /** Účet je, ale jeho typ systémovou poštu odsud poslat neumí. */
  | 'provider_unsupported'
  /** Uživatel vybral konkrétní účet a ten už neexistuje nebo je vypnutý. */
  | 'selected_account_missing';

/**
 * Co si projekt nastavil. Obojí je nepovinné a `null` znamená „rozhodni za mě".
 *
 * Bydlí v `workspaces.settings` pod klíčem `systemMail`, stejně jako `trialMode`
 * a `demoData`. Vlastní tabulka by kvůli dvěma polím byla migrace navíc.
 */
export type SystemMailSettings = {
  /** Účet, kterým se má systémová pošta odesílat. `null` = vybrat automaticky. */
  provider_id: string | null;
  /** Adresa odesílatele. `null` = odvodit z ověřené domény, jinak z APP_URL. */
  from_address: string | null;
};

export const EMPTY_SYSTEM_MAIL_SETTINGS: SystemMailSettings = {
  provider_id: null,
  from_address: null,
};

export type SystemMailAccount = {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  status: string;
  is_default: boolean;
  config_encrypted: string;
  /** První ověřená doména účtu, nebo `null`. */
  domain: string | null;
  capable: boolean;
};

const ACCOUNT_COLUMNS = `
    p.id, p.workspace_id, p.name, p.type, p.status, p.is_default, p.config_encrypted,
    (SELECT d.domain FROM sender_domains d
      WHERE d.provider_id = p.id AND d.verified_at IS NOT NULL
      ORDER BY d.created_at LIMIT 1) AS domain`;

type AccountRowRaw = Omit<SystemMailAccount, 'capable'>;

function toAccount(row: AccountRowRaw): SystemMailAccount {
  return { ...row, capable: SYSTEM_MAIL_CAPABLE_TYPES.includes(row.type) };
}

/**
 * Nastavení projektu. Čte se v transakci volajícího, protože `workspaces` má
 * politiku `ws_isolation_self` a bez kontextu vrátí nula řádků.
 */
export async function readSystemMailSettings(
  tx: Tx,
  workspaceId: string,
): Promise<SystemMailSettings> {
  const { rows } = await tx.execute<{ settings: Record<string, unknown> | null }>(sql`
    SELECT settings FROM workspaces WHERE id = ${workspaceId}::uuid LIMIT 1
  `);
  const raw = rows[0]?.settings?.['systemMail'] as Partial<SystemMailSettings> | undefined;
  return {
    provider_id: typeof raw?.provider_id === 'string' ? raw.provider_id : null,
    from_address: typeof raw?.from_address === 'string' ? raw.from_address : null,
  };
}

/** Účty projektu v pořadí, ve kterém by je vybíral automat. */
export async function listSystemMailAccounts(
  tx: Tx,
  workspaceId: string,
): Promise<SystemMailAccount[]> {
  const { rows } = await tx.execute<AccountRowRaw>(sql`
    SELECT ${sql.raw(ACCOUNT_COLUMNS)}
      FROM sending_providers p
     WHERE p.workspace_id = ${workspaceId}::uuid
       AND ${sql.raw(SYSTEM_MAIL_ACCOUNT_FILTER)}
     ORDER BY ${sql.raw(SYSTEM_MAIL_ACCOUNT_ORDER)}
  `);
  return rows.map(toAccount);
}

export type ResolvedSystemMailAccount = {
  account: SystemMailAccount | null;
  reason: SystemMailUnavailableReason | null;
};

/**
 * Který účet systémovou poštu odešle.
 *
 * VYBRANÝ ÚČET SE NEOBCHÁZÍ. Kdyby se při jeho výpadku tiše sáhlo po jiném,
 * odešla by pošta z adresy, kterou si uživatel nezvolil, a nastavení by bylo
 * jen dekorace. Chybějící vybraný účet je proto vlastní důvod nedostupnosti
 * a řekne se to nahlas.
 */
export async function resolveSystemMailAccount(
  tx: Tx,
  workspaceId: string,
  settings: SystemMailSettings,
): Promise<ResolvedSystemMailAccount> {
  const accounts = await listSystemMailAccounts(tx, workspaceId);

  if (settings.provider_id !== null) {
    const selected = accounts.find((a) => a.id === settings.provider_id);
    if (!selected) return { account: null, reason: 'selected_account_missing' };
    return { account: selected, reason: selected.capable ? null : 'provider_unsupported' };
  }

  const first = accounts[0];
  if (!first) return { account: null, reason: 'no_account' };
  return { account: first, reason: first.capable ? null : 'provider_unsupported' };
}

export type FromAddressSource =
  /** Adresu zadal uživatel v nastavení. */
  | 'configured'
  /** Odvozeno z ověřené domény účtu, tedy jediná adresa, která projde SPF a DKIM. */
  | 'verified_domain'
  /** Nouzově z hostu v APP_URL. Doručitelná zpráva se špatnou adresou je pořád lepší než žádná. */
  | 'app_url';

export type ResolvedFromAddress = { address: string; source: FromAddressSource };

export function resolveSystemMailFrom(
  account: SystemMailAccount | null,
  settings: SystemMailSettings,
  appUrl: string,
): ResolvedFromAddress {
  if (settings.from_address !== null) {
    return { address: settings.from_address, source: 'configured' };
  }
  if (account?.domain) {
    return {
      address: `${SYSTEM_MAIL_DEFAULT_LOCAL_PART}@${account.domain}`,
      source: 'verified_domain',
    };
  }
  return {
    address: `${SYSTEM_MAIL_DEFAULT_LOCAL_PART}@${new URL(appUrl).hostname}`,
    source: 'app_url',
  };
}

export type SystemMailAccountSummary = {
  id: string;
  name: string;
  type: string;
  status: string;
  is_default: boolean;
  /** Umí tímhle účtem systémová pošta odejít? */
  capable: boolean;
  /** Ověřená doména účtu, ze které by adresa odesílatele vznikla. */
  domain: string | null;
};

export type SystemMailStatus = {
  available: boolean;
  reason: SystemMailUnavailableReason | null;
  /** Účet, kterým to odejde, nebo který uživatel vybral, i když neumí. */
  provider_id: string | null;
  provider_type: string | null;
  from_address: string;
  from_source: FromAddressSource;
  /**
   * Typy účtů, kterými systémová pošta odejít umí, viz komentář výš.
   * Pole je zapisovatelné, protože jde do odpovědi API, a `readonly string[]`
   * se do schématu odpovědi (`z.array(z.string())`) nepřiřadí.
   */
  capable_types: string[];
  settings: SystemMailSettings;
  accounts: SystemMailAccountSummary[];
};

/** Celý stav pro obrazovku i pro API. */
export async function getSystemMailStatus(
  tx: Tx,
  workspaceId: string,
  appUrl: string,
): Promise<SystemMailStatus> {
  const settings = await readSystemMailSettings(tx, workspaceId);
  const accounts = await listSystemMailAccounts(tx, workspaceId);

  const selected =
    settings.provider_id !== null
      ? (accounts.find((a) => a.id === settings.provider_id) ?? null)
      : (accounts[0] ?? null);

  const reason: SystemMailUnavailableReason | null =
    settings.provider_id !== null && selected === null
      ? 'selected_account_missing'
      : selected === null
        ? 'no_account'
        : selected.capable
          ? null
          : 'provider_unsupported';

  const from = resolveSystemMailFrom(selected, settings, appUrl);

  return {
    available: reason === null,
    reason,
    provider_id: selected?.id ?? null,
    provider_type: selected?.type ?? null,
    from_address: from.address,
    from_source: from.source,
    capable_types: [...SYSTEM_MAIL_CAPABLE_TYPES],
    settings,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      status: a.status,
      is_default: a.is_default,
      capable: a.capable,
      domain: a.domain,
    })),
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * Uloží nastavení systémové pošty.
 *
 * Zapisuje se JEN klíč `systemMail`, zbytek `workspaces.settings` zůstává:
 * ve stejném objektu bydlí zkušební režim i ukázková data a přepsání celého
 * sloupce by je zahodilo.
 */
export async function updateSystemMailSettings(
  tx: Tx,
  ctx: WorkspaceContext,
  input: SystemMailSettings,
  actorLabel: string,
): Promise<SystemMailSettings> {
  const fromAddress = input.from_address?.trim() ?? null;
  if (fromAddress !== null && fromAddress !== '' && !EMAIL_PATTERN.test(fromAddress)) {
    throw validationFailed([
      {
        path: 'from_address',
        code: 'invalid_email',
        message: 'Adresa odesílatele musí být platná e-mailová adresa.',
      },
    ]);
  }

  const providerId = input.provider_id;
  if (providerId !== null) {
    const accounts = await listSystemMailAccounts(tx, ctx.workspaceId);
    if (!accounts.some((a) => a.id === providerId)) {
      throw validationFailed([
        {
          path: 'provider_id',
          code: 'not_found',
          message: 'Takový odesílací účet v projektu není, nebo je vypnutý.',
        },
      ]);
    }
  }

  const next: SystemMailSettings = {
    provider_id: providerId,
    from_address: fromAddress === '' ? null : fromAddress,
  };

  await tx.execute(sql`
    UPDATE workspaces
       SET settings = jsonb_set(
             coalesce(settings, '{}'::jsonb),
             '{systemMail}',
             ${JSON.stringify(next)}::jsonb,
             true
           ),
           updated_at = now()
     WHERE id = ${ctx.workspaceId}::uuid
  `);

  await writeAuditLog(tx, {
    action: IdentityAuditActions['settings.updated'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'workspace',
    targetId: ctx.workspaceId,
    metadata: { section: 'system_mail', ...next },
  });

  return next;
}
