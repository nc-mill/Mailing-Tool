import { loadConfig } from '../../config/index';
import { ApiError } from '../../errors/api-error';
import { TRIAL_MAX_VERIFIED_ADDRESSES } from '../../campaigns/constants';
import {
  readWorkspaceSettings,
  writeWorkspaceSettingsKey,
  type WorkspaceCampaignSettings,
} from '../../campaigns/api/service';
import { revokePendingOutsideTrial } from '../../campaigns/repo/outbox';
import { createSystemContext } from '../../identity/context';
import { queueSystemMail } from '../../platform/system-mail';
import { readWorkspaceLocale } from '../../platform/workspace-locale';
import type { WorkspaceContext } from '../../tx';
import { addTrialAddress, resolveTrialSettings, type TrialSettings } from '../trial-mode';
import { issueTrialToken, verifyTrialToken } from '../trial-token';
import { listDomains, listProviders } from './service';

/**
 * Aplikační vrstva zkušebního režimu.
 *
 * Doménová logika (`providers/trial-mode.ts`) tenhle soubor NEOPISUJE, volá ji:
 * strop adres i podoba záznamu jsou tam a jsou otestované. Tady je jen to, co
 * doména vědět nemá, tedy odkud se nastavení čte, kam se zapisuje a jak se pošle
 * potvrzovací odkaz.
 *
 * Ukládá se do `workspaces.settings.campaigns`, nikdy do vlastní tabulky
 * (rozhodnutí D15). Zápis je proto čtení, změna a zápis CELÉHO klíče `campaigns`:
 * `writeWorkspaceSettingsKey` vyměňuje celou hodnotu, ne jedno pole.
 */

export type TrialAddress = { email: string; verified_at: string | null };

export type TrialState = {
  /** Platná hodnota, se kterou se rozhoduje o odeslání. */
  trial_mode: boolean;
  /** Co je opravdu uložené. `null` znamená „uživatel se nevyjádřil". */
  trial_mode_explicit: boolean | null;
  verified: TrialAddress[];
  verified_count: number;
  max_addresses: number;
  has_verified_domain: boolean;
  /**
   * Drží Amazon výchozí odesílací účet v testovacím režimu? `null` = nevíme,
   * protože se stav účtu ještě nenačetl. Je to druhý důvod, proč může být
   * zkušební režim zapnutý, a uživatel ho musí vidět: bez něj vypadá zapnutý
   * přepínač u ověřené domény jako chyba nástroje.
   */
  provider_sandbox: boolean | null;
};

/**
 * Platný zkušební režim.
 *
 * DOPLNĚK NAD PLÁN, vynucený rozporem R2. Plán mluví o přepínači, ale nikde neříká,
 * jaká je výchozí hodnota u čerstvého projektu. Kdyby byla „vypnuto", odešle první
 * kampaň z neověřené domény rovnou do spamu a zkušební režim by objevil až ten,
 * kdo si o něm někde přečte. Výchozí hodnota je proto ZAPNUTO, dokud není ověřená
 * doména. Jakmile se uživatel vyjádří, rozhoduje jeho hodnota, i kdyby doména
 * ověřená nebyla.
 */
export function resolveTrialMode(
  settings: TrialSettings,
  input: { hasVerifiedDomain: boolean; providerSandbox?: boolean | undefined },
): boolean {
  // Pravidlo samotné bydlí v doméně, ne tady. Materializace ho potřebuje taky
  // a dvě kopie by se rozešly právě u té výchozí hodnoty, na které vše stojí.
  return resolveTrialSettings(settings, input).trial_mode;
}

function addressesOf(settings: TrialSettings): TrialAddress[] {
  return (settings.trial_verified ?? []).map((a) => ({
    email: a.email,
    verified_at: a.verified_at,
  }));
}

/** Podklad, ze kterého se rozhoduje o zkušebním režimu. */
type TrialInputs = { hasVerifiedDomain: boolean; providerSandbox: boolean | null };

function stateOf(settings: TrialSettings, inputs: TrialInputs): TrialState {
  const verified = addressesOf(settings);
  return {
    trial_mode: resolveTrialMode(settings, {
      hasVerifiedDomain: inputs.hasVerifiedDomain,
      providerSandbox: inputs.providerSandbox ?? undefined,
    }),
    trial_mode_explicit: typeof settings.trial_mode === 'boolean' ? settings.trial_mode : null,
    verified,
    verified_count: verified.filter((a) => a.verified_at !== null).length,
    max_addresses: TRIAL_MAX_VERIFIED_ADDRESSES,
    has_verified_domain: inputs.hasVerifiedDomain,
    provider_sandbox: inputs.providerSandbox,
  };
}

/**
 * Ověřená doména je ta, kterou za ověřenou uznal POSKYTOVATEL. `verified_at`
 * se od opravy plní výhradně z `GetEmailIdentity`, takže tenhle dotaz už
 * neodpovídá „naše kontrola DNS prošla", ale „Amazon doménu ověřil".
 */
async function trialInputs(ctx: WorkspaceContext): Promise<TrialInputs> {
  const [domains, providers] = await Promise.all([listDomains(ctx), listProviders(ctx)]);
  const chosen = providers.find((p) => p.is_default) ?? providers[0] ?? null;
  return {
    hasVerifiedDomain: domains.some((d) => d.verified_at !== null),
    // SMTP server o testovacím režimu nic neví, takže se u něj netvrdí ani ne.
    providerSandbox:
      chosen === null || chosen.type !== 'ses' || chosen.production_access === null
        ? null
        : chosen.production_access === false,
  };
}

export async function readTrialState(ctx: WorkspaceContext): Promise<TrialState> {
  const [settings, inputs] = await Promise.all([readWorkspaceSettings(ctx), trialInputs(ctx)]);
  return stateOf(settings.campaigns, inputs);
}

/** Zápis vždy skrz celý klíč `campaigns`, aby se nesmazalo časové pásmo ani okno undo. */
async function saveCampaignSettings(
  ctx: WorkspaceContext,
  next: WorkspaceCampaignSettings,
): Promise<void> {
  await writeWorkspaceSettingsKey(ctx, 'campaigns', next);
}

export async function setTrialMode(ctx: WorkspaceContext, enabled: boolean): Promise<TrialState> {
  const settings = await readWorkspaceSettings(ctx);
  const next: WorkspaceCampaignSettings = { ...settings.campaigns, trial_mode: enabled };
  await saveCampaignSettings(ctx, next);

  /**
   * Zapnutí režimu musí zabrat i na kampaň, která už je rozmaterializovaná.
   *
   * Brána v materializaci čte hodnotu platnou na začátku běhu, takže bez tohohle
   * kroku by zprávy vložené před přepnutím odešly a uživatel by viděl, že „zapnul
   * ochranu" a pošta stejně odchází. Je to táž okamžitá cesta, jakou má suppression:
   * zablokovaná adresa taky vznikne až po materializaci a čekající zprávy se ruší hned.
   *
   * Vypnutí režimu se NEVRACÍ zpět. Zprávy jsou ve stavu `skipped`, který je podle
   * kontraktu koncový, a oživit je by znamenalo rozeslat něco, co uživatel mezitím
   * považoval za zastavené.
   */
  if (enabled) {
    const verified = (next.trial_verified ?? [])
      .filter((a) => a.verified_at !== null)
      .map((a) => a.email);
    await revokePendingOutsideTrial(ctx, verified);
  }

  return stateOf(next, await trialInputs(ctx));
}

export type AddTrialAddressResult = {
  state: TrialState;
  /**
   * Odkaz se vrací JEN mimo produkci a je to týž ústupek, jaký dělá
   * `LoggingSystemMailer`: dokud instalace nemá zapojenou odesílací pipeline,
   * nešel by zkušební režim dokončit vůbec. V produkci odkaz odchází pouze
   * e-mailem, protože jinak by si vlastník projektu ověřil cizí adresu sám
   * a ověřování by nedokládalo nic.
   */
  verification_url: string | null;
};

export async function addTrialVerifiedAddress(
  ctx: WorkspaceContext,
  email: string,
): Promise<AddTrialAddressResult> {
  const cfg = loadConfig();
  const settings = await readWorkspaceSettings(ctx);
  const normalized = email.trim().toLowerCase();

  const current = settings.campaigns.trial_verified ?? [];
  if (
    current.length >= TRIAL_MAX_VERIFIED_ADDRESSES &&
    !current.some((a) => a.email.toLowerCase() === normalized)
  ) {
    // Strop hlídá i `addTrialAddress`, ale ta hází obyčejnou výjimku s českým textem.
    // Přes API musí odejít RFC 9457 s kódem, na který se klient umí zeptat.
    throw new ApiError('conflict', {
      params: { reason: 'trial_max_addresses', max: TRIAL_MAX_VERIFIED_ADDRESSES },
    });
  }

  const next = addTrialAddress(settings.campaigns, normalized) as WorkspaceCampaignSettings;
  await saveCampaignSettings(ctx, next);

  const token = issueTrialToken({ workspaceId: ctx.workspaceId, email: normalized });
  const url = `${cfg.APP_URL}/verify-sender/${token}`;
  await queueSystemMail({
    template: 'trial_address_verification',
    to: normalized,
    /**
     * JAZYK PROJEKTU, ne jazyk instalace, stejně jako u pozvánky.
     *
     * Dřív tu stálo `cfg.DEFAULT_LOCALE`, takže instalace s vícejazyčnými
     * projekty poslala do anglického projektu český e-mail. Vlastní jazyk
     * adresáta se vzít nedá: ověřuje se ODESÍLACÍ adresa, která nemusí patřit
     * žádnému uživateli produktu. Z toho, co k dispozici je, je projekt ta
     * správná volba, protože se ověřuje jeho odesílatel. `DEFAULT_LOCALE`
     * zůstává pojistkou pro případ, že by řádek projektu nešel přečíst.
     * Týž vzorec a týž důvod jsou v `identity/invitation-service.ts`.
     */
    locale: (await readWorkspaceLocale(ctx)) ?? cfg.DEFAULT_LOCALE,
    data: { url },
    workspaceId: ctx.workspaceId,
  });

  return {
    state: stateOf(next, await trialInputs(ctx)),
    verification_url: cfg.NODE_ENV === 'production' ? null : url,
  };
}

/**
 * Odebrání adresy ze seznamu.
 *
 * DOPLNĚK NAD PLÁN, vynucený stropem. Plán zná jen přidání, ale adres je nejvýš
 * deset a nic je nemaže; bez odebrání by projekt po deseti pokusech zůstal zaseknutý
 * navždy. Rozeslaný potvrzovací odkaz na odebranou adresu tím přestane platit,
 * protože potvrzení odmítne adresu, která v seznamu není.
 */
export async function removeTrialVerifiedAddress(
  ctx: WorkspaceContext,
  email: string,
): Promise<TrialState> {
  const normalized = email.trim().toLowerCase();
  const settings = await readWorkspaceSettings(ctx);
  const current = settings.campaigns.trial_verified ?? [];
  if (!current.some((a) => a.email.toLowerCase() === normalized)) throw new ApiError('not_found');

  const next: WorkspaceCampaignSettings = {
    ...settings.campaigns,
    trial_verified: current.filter((a) => a.email.toLowerCase() !== normalized),
  };
  await saveCampaignSettings(ctx, next);
  return stateOf(next, await trialInputs(ctx));
}

export type ConfirmTrialAddressResult =
  | { ok: true; email: string; workspaceId: string }
  | { ok: false; reason: 'malformed' | 'expired' | 'invalid' | 'unknown_address' };

/**
 * Potvrzení adresy z odkazu v e-mailu.
 *
 * Bez kontextu projektu, protože odkaz otevírá majitel schránky, který v nástroji
 * účet nemá. Projekt je uvnitř podepsaného tokenu, takže se nebere z requestu:
 * kdo token nepodepsal, nedostane se ani k cizímu projektu, ani k cizí adrese.
 * Zapisuje systémový aktér, stejně jako u jobů.
 */
export async function confirmTrialAddress(
  token: string,
  options: { now?: Date } = {},
): Promise<ConfirmTrialAddressResult> {
  const verified = verifyTrialToken(token, options);
  if (!verified.ok) return { ok: false, reason: verified.reason };

  const ctx = createSystemContext(verified.workspaceId, 'trial.verify_address');
  const settings = await readWorkspaceSettings(ctx);
  const current = settings.campaigns.trial_verified ?? [];
  const found = current.find((a) => a.email.toLowerCase() === verified.email);
  // Adresa mezitím zmizela ze seznamu. Odkaz ji NEPŘIDÁVÁ zpátky: obešlo by to strop
  // i rozhodnutí toho, kdo ji ze seznamu odebral.
  if (!found) return { ok: false, reason: 'unknown_address' };

  const at = (options.now ?? new Date()).toISOString();
  const next: WorkspaceCampaignSettings = {
    ...settings.campaigns,
    trial_verified: current.map((a) =>
      a.email.toLowerCase() === verified.email ? { ...a, verified_at: a.verified_at ?? at } : a,
    ),
  };
  await saveCampaignSettings(ctx, next);
  return { ok: true, email: verified.email, workspaceId: verified.workspaceId };
}
