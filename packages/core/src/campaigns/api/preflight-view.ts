import { loadConfig } from '../../config/index';
import { compileAudienceToSql } from '../../segments/repo';
import { campaignAudienceGates, ZERO_GATE_COUNTS } from './audience-gates';
import type { WorkspaceContext } from '../../tx';
import { buildAudienceSql } from '../audience/build-sql';
import { AUDIENCE_PREVIEW_TIMEOUT_MS } from '../constants';
import type { AudienceGateCounts, AudiencePort } from '../ports';
import { countWithTimeout } from '../repo/audience';
import { campaignAudienceSchema, type CampaignAudience } from '../types';
import { getDomain } from '../../providers/repo/domain';
import { getProviderById } from '../../providers/repo/provider';
import { readWorkspaceSettings, undoWindowSeconds, type CampaignRowFull } from './service';

/**
 * ODCHYLKA OD PLÁNU, VĚDOMÁ A OHLÁŠENÁ.
 *
 * Kontrolní seznam připravenosti podle úkolu 49 patří doménové fázi J, kterou
 * píše souběžně jiný agent. Tenhle soubor je jeho VOLAJÍCÍ vrstva pro API,
 * ne druhá kopie: skládá kontroly z hodnot, které už doména a repository vracejí
 * (stav kampaně, stav odesílacího účtu, výsledky DNS kontrol, rozpad publika
 * z části 2). Až `runPreflight` v `campaigns/preflight/checks.ts` vznikne,
 * nahradí se tělo `runCampaignPreflight` jeho voláním a zbytek souboru
 * (překlad na tvar odpovědi) zůstane. Je to jediné místo, kde se to bude měnit.
 *
 * Co tady VĚDOMĚ NENÍ, protože na to nemám zdroj:
 *  - nálezy doručitelnosti (`deliverability_*`), ty počítá fáze I,
 *  - kontrola personalizací proti katalogu polí (`campaign_unknown_merge_field`),
 *    ta patří ke kompilaci z úkolu 47,
 *  - `contract_mismatch`, ten vzniká rekompilací před odesláním (rozhodnutí D17).
 */

export type PreflightFinding = {
  code: string;
  severity: 'error' | 'warning';
  params?: Record<string, unknown>;
};

/**
 * Jedenáct bran z `AudienceGateCounts` plus vlastní řádek `excluded_by_selection`.
 * Bez něj by u kampaně s vylučujícím výběrem přestal sedět součet bran na vstupní
 * počet a řádek „Vyloučeno" by musel být souhrnný, což část 6 v 8.6.2 zakazuje.
 */
export type PreflightBreakdown = AudienceGateCounts & { excluded_by_selection: number };

export type PreflightView = {
  can_send: boolean;
  audience_estimate: number;
  breakdown: PreflightBreakdown;
  quota_remaining: number | null;
  undo_window_seconds: number;
  findings: PreflightFinding[];
  checked_at: string;
};

export const EMPTY_BREAKDOWN: PreflightBreakdown = {
  ...ZERO_GATE_COUNTS,
  excluded_by_selection: 0,
};

/**
 * Jediná podporovaná cesta k publiku je kompilátor části 2 (uzávěr z 1.3).
 * Adaptér je tenký a existuje jen proto, že port bere `workspaceId` jako hodnotu,
 * kdežto kompilátor celý transakční kontext.
 */
export function audiencePort(ctx: WorkspaceContext, timezone: string): AudiencePort {
  return {
    compileToSql: async (input) => {
      const compiled = await compileAudienceToSql(
        ctx,
        {
          ...(input.selection.listIds === undefined ? {} : { listIds: input.selection.listIds }),
          ...(input.selection.segmentIds === undefined
            ? {}
            : { segmentIds: input.selection.segmentIds }),
        },
        { alias: input.alias, paramOffset: input.paramOffset, asOf: input.asOf, timezone },
      );
      return { sql: compiled.sql, params: compiled.params };
    },
    countGates: async () => {
      throw new Error('countGates dodává část 2 přes R-P07.1, API ho nevolá.');
    },
  };
}

export function parseAudience(value: unknown): CampaignAudience | null {
  const parsed = campaignAudienceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Rozpad publika po pojmenovaných branách. Číslo v řádku Publikum, číslo na tlačítku
 * i číslo v potvrzovacím dialogu pocházejí z TOHOHLE jednoho volání (část 6, 8.6.2).
 */
export async function audienceState(
  ctx: WorkspaceContext,
  audience: CampaignAudience,
  opts: { asOf: Date; timezone: string },
): Promise<{ estimate: number; exact: boolean; breakdown: PreflightBreakdown }> {
  // Překlad na jedenáct pojmenovaných bran dělá `audience-gates.ts`, ne tenhle soubor:
  // tentýž tvar potřebuje i `countGates` jobu materializace, který ho zapisuje do
  // `campaigns.audience_breakdown`. Dvě kopie překladu by se rozešly a rozdíl by
  // se projevil až tím, že kontrolní seznam a report po odeslání ukazují jiná čísla.
  const gates = await campaignAudienceGates(ctx, audience, opts);
  const breakdown: PreflightBreakdown = { ...gates, excluded_by_selection: 0 };

  const hasExclude = audience.exclude.lists.length + audience.exclude.segments.length > 0;
  if (!hasExclude) {
    return { estimate: gates.eligible, exact: true, breakdown };
  }

  // S vylučujícím výběrem se musí počítat znovu, protože rozpad po branách
  // vylučující stranu nezná. Rozdíl se ukazuje jako vlastní pojmenovaný řádek,
  // aby součet bran dál seděl na vstupní počet a nevznikl souhrnný řádek.
  const where = await buildAudienceSql(audiencePort(ctx, opts.timezone), {
    workspaceId: ctx.workspaceId,
    audience,
    paramOffset: 1,
    asOf: opts.asOf,
  });
  const counted = await countWithTimeout(ctx, where, AUDIENCE_PREVIEW_TIMEOUT_MS);
  breakdown.eligible = counted.count;
  breakdown.excluded_by_selection = Math.max(0, gates.eligible - counted.count);
  return { estimate: counted.count, exact: counted.exact, breakdown };
}

/** Odkaz na odhlášení se pozná podle značky, kterou do HTML vkládá kompilace P08. */
function hasUnsubscribeLink(html: string | null): boolean {
  if (!html) return false;
  return html.includes('unsubscribe_url') || html.includes('/u/') || html.includes('{{ml_unsub');
}

export async function runCampaignPreflight(
  ctx: WorkspaceContext,
  campaign: CampaignRowFull,
  opts: { asOf: Date; timezone: string },
): Promise<PreflightView> {
  const config = loadConfig();
  const findings: PreflightFinding[] = [];
  const settings = await readWorkspaceSettings(ctx);

  const audience = parseAudience(campaign.audience);
  let estimate = 0;
  let breakdown = EMPTY_BREAKDOWN;

  if (!audience) {
    findings.push({ code: 'campaign_audience_empty', severity: 'error' });
  } else {
    const state = await audienceState(ctx, audience, opts);
    estimate = state.estimate;
    breakdown = state.breakdown;
    if (estimate === 0) findings.push({ code: 'campaign_audience_empty', severity: 'error' });
    if (estimate > config.CAMPAIGN_MAX_RECIPIENTS) {
      findings.push({
        code: 'campaign_audience_too_large',
        severity: 'error',
        params: { max: config.CAMPAIGN_MAX_RECIPIENTS },
      });
    }
  }

  if (campaign.subject.trim() === '') {
    findings.push({ code: 'campaign_subject_missing', severity: 'error' });
  }
  if (!campaign.compiled_html) {
    findings.push({ code: 'campaign_not_compiled', severity: 'error' });
  } else if (!hasUnsubscribeLink(campaign.compiled_html)) {
    findings.push({ code: 'campaign_no_unsubscribe', severity: 'error' });
  }

  let quotaRemaining: number | null = null;
  if (!campaign.provider_id) {
    findings.push({ code: 'provider_not_ready', severity: 'error' });
  } else {
    const provider = await getProviderById(ctx, campaign.provider_id);
    if (!provider) {
      findings.push({ code: 'provider_not_ready', severity: 'error' });
    } else {
      if (provider.status === 'blocked' || provider.sending_enabled === false) {
        findings.push({ code: 'provider_sending_paused', severity: 'error' });
      } else if (provider.status !== 'ready' && provider.status !== 'degraded') {
        findings.push({
          code: 'provider_not_ready',
          severity: 'error',
          params: { status: provider.status },
        });
      }
      if (provider.production_access === false) {
        findings.push({ code: 'provider_sandbox', severity: 'error' });
      }
      if (provider.quota_max_24h !== null) {
        quotaRemaining = Math.max(0, provider.quota_max_24h - (provider.quota_sent_24h ?? 0));
        if (estimate > quotaRemaining) {
          findings.push({
            code: 'provider_quota_exceeded',
            severity: 'error',
            params: { count: estimate, remaining: quotaRemaining },
          });
        }
      }
    }
  }

  if (campaign.sender_domain_id) {
    const domain = await getDomain(ctx, campaign.sender_domain_id);
    if (domain) {
      // `false` znamená ověřeno a špatně, `null` znamená nevíme (třeba SERVFAIL).
      // Kritérium 43 části 4a říká, že nevědomost doménu blokovat nesmí.
      if (domain.dkim_ok === false) {
        findings.push({
          code: 'domain_dkim_missing',
          severity: 'error',
          params: { domain: domain.domain },
        });
      } else if (domain.dkim_ok === null) {
        findings.push({
          code: 'domain_dkim_missing',
          severity: 'warning',
          params: { domain: domain.domain },
        });
      }
      if (domain.spf_ok !== true)
        findings.push({ code: 'domain_spf_missing', severity: 'warning' });
      if (domain.dmarc_ok !== true) {
        findings.push({ code: 'domain_dmarc_missing', severity: 'warning' });
      }
    }
  }

  return {
    can_send: !findings.some((f) => f.severity === 'error'),
    audience_estimate: estimate,
    breakdown,
    quota_remaining: quotaRemaining,
    undo_window_seconds: undoWindowSeconds(settings.campaigns),
    findings,
    checked_at: opts.asOf.toISOString(),
  };
}
