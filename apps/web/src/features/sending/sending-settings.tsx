'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { CheckIcon, ClockIcon, SlashIcon, WarningIcon } from '@/lib/ui/status-icons';
import { GuardThresholds, type GuardLimits, type GuardSettings } from './guard-thresholds';
import { ProviderRegionFacts, type RegionFacts } from './provider-region-panel';

type ProviderActionResult =
  { status: 'success'; detail?: string } | { status: 'error'; code?: string };

/**
 * Tvar je `config_public` z `presentProvider`, tedy odvozená kopie nastavení
 * BEZ tajemství: klíč i uživatelské jméno jsou maskované a heslo tu není vůbec.
 * Přesně proto má dialog úpravy tahle pole prázdná a mění je jen na vyžádání.
 */
export type ProviderConfigView = {
  kind?: string;
  region?: string;
  configuration_set_name?: string | null;
  access_key_id_masked?: string;
  host?: string;
  port?: number;
  encryption?: 'starttls' | 'tls' | 'none';
  username_masked?: string;
};

export type ProviderView = {
  id: string;
  name: string;
  type: string;
  status: string;
  is_default: boolean;
  config: ProviderConfigView | null;
  quota_max_24h: number | null;
  quota_sent_24h: number | null;
  /**
   * Co konkrétně brání odesílání, zapsané při posledním ověření. Odznak sám
   * o sobě řekne jen „Ověřuje se"; teprve tenhle seznam řekne, na co se čeká.
   */
  status_detail?: {
    blockers?: string[];
    /**
     * REGION, ZE KTERÉHO SE ODESÍLÁ, a co má Amazon ověřené PRÁVĚ V NĚM.
     * Bez obojího nešlo na obrazovce odpovědět na otázku, která stála zadavatele
     * čtyři dny: „mám v tom regionu, ze kterého posíláme, vůbec něco ověřeného?"
     */
    region?: string | null;
    verified_identities?: string[];
    /** `null` je „nezjišťovali jsme", NE „ani jedna". Rozdíl je zásadní. */
    verified_identity_count?: number | null;
  } | null;
  /** `false` = Amazon drží účet v testovacím režimu. `null` = nevíme. */
  production_access?: boolean | null;
};

/**
 * Stav ověření jednoho účtu. Drží ho obrazovka nad seznamem, protože ověření
 * spouštějí TŘI různá místa: tlačítko u účtu, dokončené založení a dokončená
 * úprava. Kdyby si stav držel seznam sám, výsledek z dialogu by neměl kudy
 * doputovat k řádku, kterého se týká.
 *
 * `providerStatus` a `blockers` chodí ze STEJNÉ odpovědi jako věta o výsledku.
 * Je to jádro opravy rozporu: odznak se od téhle chvíle kreslí z výsledku testu,
 * ne z odděleně načteného seznamu, takže nemůže vzniknout snímek s odznakem
 * „Neověřený" vedle věty „Ověřeno, účet je připravený odesílat".
 */
/** Region a ověřené identity z téhož ověření jako stav. Viz `ProviderStatusView`. */
type VerificationFacts = {
  providerStatus: string;
  blockers: string[];
  region: string | null;
  verifiedIdentities: string[];
  verifiedIdentityCount: number | null;
};

export type ProviderVerification =
  | { state: 'running' }
  | ({ state: 'ok'; detail: string; sandbox: boolean } & VerificationFacts)
  | ({ state: 'failed'; code: string; reason: string | null; detail: string } & VerificationFacts);

export type DomainView = {
  id: string;
  domain: string;
  dkim_ok: boolean | null;
  spf_ok: boolean | null;
  dmarc_ok: boolean | null;
  verified_at: string | null;
  /** Doslovný verdikt Amazonu: `SUCCESS`, `PENDING`, `FAILED`, `NOT_STARTED`, `null`. */
  ses_verification_status?: string | null;
};

/** Stavy, na které je katalog připravený. Cokoli jiného je „neznámý stav". */
const KNOWN_STATUSES = [
  'unverified',
  'verifying',
  'ready',
  'degraded',
  'blocked',
  'disabled',
] as const;

/**
 * Verdikt poskytovatele o doméně, přeložený na klíč katalogu.
 *
 * `verified_at` má přednost před syrovou hodnotou: plní se výhradně z odpovědi
 * Amazonu na `SUCCESS`, takže je to totéž tvrzení, jen už uložené. Neznámý stav
 * se hlásí jako neznámý, ne jako čekání ani jako selhání.
 */
function sesStatusKey(d: DomainView): 'verified' | 'pending' | 'failed' | 'notStarted' | 'unknown' {
  if (d.verified_at !== null) return 'verified';
  switch (d.ses_verification_status) {
    case 'SUCCESS':
      return 'verified';
    case 'PENDING':
      return 'pending';
    case 'FAILED':
      return 'failed';
    case 'NOT_STARTED':
      return 'notStarted';
    default:
      return 'unknown';
  }
}

function statusTone(status: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  if (status === 'ready') return 'success';
  if (status === 'degraded') return 'warning';
  if (status === 'blocked') return 'danger';
  if (status === 'verifying') return 'accent';
  return 'neutral';
}

/**
 * Nastavení odesílání: odesílací účty, domény a brzdy doručitelnosti na jedné
 * obrazovce, protože jsou to tři strany téže věci a uživatel je řeší najednou.
 */
export function SendingSettings({
  providers,
  domains,
  guards,
  limits,
  basePath,
  verification,
  onSaveGuards,
  onAddProvider,
  onAddDomain,
  onTestProvider,
  onEditProvider,
  onDeleteProvider,
  onDeleteDomain,
  onMakeDefault,
  onVerifyIdentity,
  onRequestProductionAccess,
}: {
  providers: ProviderView[];
  domains: DomainView[];
  guards: GuardSettings;
  limits: GuardLimits;
  basePath: string;
  /** Klíčováno podle id účtu: výsledek u jednoho účtu nesmí přepsat druhý. */
  verification?: Record<string, ProviderVerification>;
  onSaveGuards?: (next: GuardSettings) => Promise<{ status: 'success' | 'error'; code?: string }>;
  onAddProvider?: () => void;
  onAddDomain?: () => void;
  onTestProvider?: (providerId: string) => void;
  onEditProvider?: (providerId: string) => void;
  onDeleteProvider?: (providerId: string) => void;
  /** Odebrání domény ze seznamu. Bez něj byla doména jednosměrka: šla přidat, ne odebrat. */
  onDeleteDomain?: (domainId: string) => void;
  onMakeDefault?: (providerId: string) => Promise<ProviderActionResult>;
  /** Otevře ověření adresy odesílatele u Amazonu. Jen u účtu SES. */
  onVerifyIdentity?: (providerId: string) => void;
  /** Otevře žádost o vyřazení z testovacího režimu. Jen u účtu SES v sandboxu. */
  onRequestProductionAccess?: (providerId: string) => void;
}) {
  const t = useTranslations('campaigns');
  const format = useFormatter();
  const hasSmtp = providers.some((p) => p.type === 'smtp');
  const [defaulting, setDefaulting] = useState<Record<string, boolean>>({});

  /**
   * Text u nezdařeného ověření. Pořadí je věcné: nejdřív `reason`, protože ten
   * je u SES jediný rozlišovač mezi špatným klíčem, chybějícím oprávněním
   * a špatným regionem, teprve pak kód, který je u SMTP naopak přesný sám o sobě.
   * Neznámá kombinace nespadne, jen dojde na obecnou větu; výčty jsou otevřené.
   */
  function failureAdvice(result: { code: string; reason: string | null }): string {
    const byReason = `sending.verify.reasons.${result.reason ?? ''}`;
    if (result.reason !== null && t.has(byReason)) return t(byReason);
    const byCode = `sending.verify.codes.${result.code}`;
    if (t.has(byCode)) return t(byCode);
    return t('sending.verify.failed');
  }

  /**
   * JEDINÉ místo, které rozhoduje, co je na odznaku. Odznak se kreslí z výsledku
   * právě proběhlého ověření, a teprve když žádný není, z uloženého stavu.
   *
   * Bez tohohle vznikal rozpor: `sending_providers.status` zůstával na
   * `unverified`, protože ho nikdo nezapisoval, kdežto věta pod ním pocházela
   * z čerstvé odpovědi Amazonu. Uživatel viděl „Neověřený" a hned pod tím
   * „Ověřeno, účet je připravený odesílat".
   */
  function badgeStatus(p: ProviderView, result: ProviderVerification | undefined): string {
    if (result?.state === 'running') return 'verifying';
    if (result?.state === 'ok' || result?.state === 'failed') return result.providerStatus;
    return p.status;
  }

  /**
   * Neznámý stav se NEVYDÁVÁ za selhání ani za úspěch. Dřív se hodnota mimo
   * výčet předala do `t()` a katalog na ni odpověděl chybějícím klíčem, takže
   * na obrazovce skončil syrový identifikátor.
   */
  function statusLabel(status: string): string {
    return (KNOWN_STATUSES as readonly string[]).includes(status)
      ? t(`sending.providerStatus.${status}`)
      : t('sending.providerStatus.unknown');
  }

  /** Věta k tomu, co brání odesílání. Neznámý kód se mlčky přeskočí. */
  function blockerText(code: string): string | null {
    const key = `sending.blockers.${code}`;
    return t.has(key) ? t(key) : null;
  }

  function blockersOf(p: ProviderView, result: ProviderVerification | undefined): string[] {
    if (result?.state === 'ok' || result?.state === 'failed') return result.blockers;
    if (result?.state === 'running') return [];
    return p.status_detail?.blockers ?? [];
  }

  /**
   * Region a ověřené identity. Stejné pravidlo jako u odznaku: přednost má
   * PRÁVĚ PROBĚHLÉ ověření, teprve pak uložený stav. Kdyby se region bral ze
   * seznamu a stav z testu, vznikl by přesně ten rozpor, kvůli kterému tahle
   * obrazovka celá vznikla.
   */
  function regionFactsOf(p: ProviderView, result: ProviderVerification | undefined): RegionFacts {
    const sandbox =
      p.production_access === null || p.production_access === undefined
        ? null
        : p.production_access === false;
    if (result?.state === 'ok' || result?.state === 'failed') {
      return {
        region: result.region,
        identities: result.verifiedIdentities,
        count: result.verifiedIdentityCount,
        // U právě proběhlého testu je nejčerstvější pravda o testovacím režimu
        // v seznamu překážek, protože `production_access` ve sloupci se
        // překreslí až po obnově stránky.
        sandbox: result.blockers.includes('sandbox') ? true : sandbox,
      };
    }
    const detail = p.status_detail ?? {};
    return {
      region: detail.region ?? null,
      identities: detail.verified_identities ?? [],
      count: detail.verified_identity_count ?? null,
      sandbox,
    };
  }

  /**
   * Překážky BEZ těch, které obrazovka ukazuje vlastním, hlasitějším způsobem.
   *
   * `sandbox_no_identities` znamená, že neodejde vůbec nic, ani zkušební zpráva
   * na vlastní adresu. Nechat ji jako odrážku mezi ostatními poznámkami by tuhle
   * zprávu utopilo; má vlastní hlášení v panelu regionu a tady by stála podruhé.
   */
  function bulletBlockers(codes: string[]): string[] {
    return codes.filter((code) => code !== 'sandbox_no_identities');
  }

  async function runMakeDefault(id: string) {
    if (!onMakeDefault) return;
    setDefaulting((prev) => ({ ...prev, [id]: true }));
    try {
      await onMakeDefault(id);
    } finally {
      setDefaulting((prev) => ({ ...prev, [id]: false }));
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="providers-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="providers-title" className="text-lg font-semibold">
            {t('sending.providersTitle')}
          </h2>
          {/* Druhý účet se zakládá stejně často jako první, například záložní SMTP
              vedle SES. Dokud tlačítko viselo jen v prázdném stavu, nebylo po
              založení prvního účtu kam kliknout. */}
          {onAddProvider && providers.length > 0 && (
            <Button variant="primary" data-testid="add-provider" onClick={onAddProvider}>
              {t('sending.addProvider')}
            </Button>
          )}
        </div>

        {providers.length === 0 ? (
          <EmptyState
            variant="first"
            title={t('sending.providersEmpty')}
            explanation={t('sending.providersEmptyExplanation')}
            actions={[{ label: t('sending.addProvider'), onClick: () => onAddProvider?.() }]}
          />
        ) : (
          <ul className="flex flex-col gap-3" data-testid="provider-list">
            {providers.map((p) => {
              const result = verification?.[p.id];
              const shown = badgeStatus(p, result);
              const blockers = blockersOf(p, result);
              const facts = regionFactsOf(p, result);
              const isSes = p.type === 'ses';
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{p.name}</span>
                    {/* Obal nese testovací značku: `Badge` cizí atributy nepředává. */}
                    <span data-testid={`provider-status-${p.id}`} data-status={shown}>
                      <Badge
                        tone={statusTone(shown)}
                        icon={
                          shown === 'ready'
                            ? CheckIcon
                            : shown === 'blocked'
                              ? SlashIcon
                              : ClockIcon
                        }
                      >
                        {statusLabel(shown)}
                      </Badge>
                    </span>
                    {p.is_default && (
                      <Badge tone="accent" icon={CheckIcon}>
                        {t('sending.defaultBadge')}
                      </Badge>
                    )}
                    <span className="text-sm text-text-muted">
                      {isSes ? (p.config?.region ?? 'ses') : (p.config?.host ?? 'smtp')}
                    </span>
                    {p.quota_max_24h !== null && (
                      <span className="text-sm text-text-muted">
                        {t('deliverability.dailyQuota')}: {format.number(p.quota_sent_24h ?? 0)} /{' '}
                        {format.number(p.quota_max_24h)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {onTestProvider && (
                      <Button
                        data-testid={`test-provider-${p.id}`}
                        pending={result?.state === 'running'}
                        onClick={() => onTestProvider(p.id)}
                      >
                        {t('sending.testConnection')}
                      </Button>
                    )}
                    {/* Popisky tlačítek sedí ve svých dialogových katalozích schválně:
                        tlačítko a dialog, který otevře, musí říkat totéž slovo,
                        a když stojí vedle sebe, nerozejde se to při překladu. */}
                    {onEditProvider && (
                      <Button
                        data-testid={`edit-provider-${p.id}`}
                        onClick={() => onEditProvider(p.id)}
                      >
                        {t('sending.editDialog.open')}
                      </Button>
                    )}
                    {onDeleteProvider && (
                      <Button
                        variant="ghost"
                        data-testid={`delete-provider-${p.id}`}
                        onClick={() => onDeleteProvider(p.id)}
                      >
                        {t('sending.deleteDialog.open')}
                      </Button>
                    )}
                    {onMakeDefault && !p.is_default && (
                      <Button
                        data-testid={`make-default-${p.id}`}
                        pending={defaulting[p.id] === true}
                        onClick={() => void runMakeDefault(p.id)}
                      >
                        {t('sending.makeDefault')}
                      </Button>
                    )}
                    {/* Ověření adresy u Amazonu jde jen u účtu SES: SMTP server
                        žádné identity nezná a tlačítko by nedělalo nic. */}
                    {onVerifyIdentity && isSes && (
                      <Button
                        data-testid={`verify-identity-${p.id}`}
                        onClick={() => onVerifyIdentity(p.id)}
                      >
                        {t('sending.identity.open')}
                      </Button>
                    )}
                    {/* Žádost o produkční přístup má smysl jen tehdy, když účet
                        v testovacím režimu PROKAZATELNĚ je. U `null`, tedy
                        „nevíme", se nenabízí: bylo by to tvrzení o stavu, který
                        jsme si nepřečetli. */}
                    {onRequestProductionAccess && isSes && facts.sandbox === true && (
                      <Button
                        data-testid={`production-access-${p.id}`}
                        onClick={() => onRequestProductionAccess(p.id)}
                      >
                        {t('sending.productionAccess.open')}
                      </Button>
                    )}
                  </div>

                  {/* V jakém regionu účet je a co v něm má Amazon ověřené.
                      Stojí NAD výsledkem testu i nad seznamem překážek, protože
                      obojí se bez regionu nedá správně přečíst. */}
                  {isSes && (
                    <ProviderRegionFacts facts={facts} testId={`provider-region-facts-${p.id}`} />
                  )}

                  {/*
                    Výsledek ověření stojí na vlastním řádku pod tlačítky, ne vedle
                    nich: rada, co opravit, je celá věta a v řadě tlačítek by se
                    zalomila na nečitelný proužek. Tón nese ikonu, takže věta dává
                    smysl i bez barvy.
                  */}
                  {result && (
                    <div data-testid={`test-result-${p.id}`} data-state={result.state}>
                      {result.state === 'running' && (
                        <Alert tone="info">{t('sending.verify.running')}</Alert>
                      )}
                      {/*
                        Věta o výsledku mluví JEN o tom, co test opravdu zjistil,
                        tedy že přístupové údaje fungují. Netvrdí „účet je
                        připravený odesílat": to je tvrzení o stavu účtu a to patří
                        odznaku, který se teď kreslí z téže odpovědi. Právě tahle
                        věta stála na snímku pod odznakem „Neověřený".
                      */}
                      {result.state === 'ok' && (
                        <Alert
                          tone={
                            result.providerStatus === 'ready'
                              ? 'success'
                              : result.providerStatus === 'unknown'
                                ? 'info'
                                : 'warning'
                          }
                        >
                          <span className="flex flex-col gap-1">
                            <span>{t('sending.verify.ok')}</span>
                            {result.providerStatus === 'unknown' && (
                              <span>{t('sending.verify.statusUnknown')}</span>
                            )}
                          </span>
                        </Alert>
                      )}
                      {result.state === 'failed' && (
                        <Alert tone="error" title={failureAdvice(result)}>
                          {result.detail === '' ? null : (
                            <span className="text-text-muted">
                              {t('sending.verify.detailLabel')}: {result.detail}
                            </span>
                          )}
                        </Alert>
                      )}
                    </div>
                  )}

                  {/*
                    Co brání odesílání, visí TRVALE, ne jen chvíli po testu.
                    Uložený seznam pochází z posledního ověření, takže se ho
                    uživatel dozví i po obnovení stránky, a hlavně dřív, než mu
                    kampaň uvázne. Testovací režim Amazonu je jedna z položek.
                  */}
                  {bulletBlockers(blockers).length > 0 && result?.state !== 'running' && (
                    <ul
                      data-testid={`provider-blockers-${p.id}`}
                      className="flex list-disc flex-col gap-1 pl-5 text-sm text-text-muted"
                    >
                      {bulletBlockers(blockers).map((code) => {
                        const text = blockerText(code);
                        return text === null ? null : (
                          <li key={code} data-blocker={code}>
                            {text}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* U SMTP se seznam blokovaných adres nedoplňuje sám. Musí to být vidět trvale,
            ne jen jednou při zakládání účtu. */}
        {hasSmtp && (
          <Alert tone="warning" data-testid="smtp-warning">
            {t('smtpWarning')}
          </Alert>
        )}
      </section>

      <section aria-labelledby="domains-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="domains-title" className="text-lg font-semibold">
            {t('sending.domainsTitle')}
          </h2>
          {/* Tatáž vada jako u odesílacích účtů: dokud tlačítko viselo jen
              v prázdném stavu, po první doméně nebylo kam kliknout, a druhá
              doména přitom vzniká běžně (jiná značka, jiný e-shop). */}
          {onAddDomain && domains.length > 0 && (
            <Button variant="primary" data-testid="add-domain" onClick={onAddDomain}>
              {t('sending.addDomain')}
            </Button>
          )}
        </div>

        {domains.length === 0 ? (
          <EmptyState
            variant="first"
            title={t('sending.domainsEmpty')}
            explanation={t('sending.domainsEmptyExplanation')}
            actions={[{ label: t('sending.addDomain'), onClick: () => onAddDomain?.() }]}
          />
        ) : (
          <ul className="flex flex-col gap-3" data-testid="domain-list">
            {domains.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 rounded-[var(--radius-surface)] border border-border p-4"
              >
                <span className="font-mono">{d.domain}</span>
                <Badge
                  tone={d.dkim_ok === true ? 'success' : d.dkim_ok === false ? 'danger' : 'neutral'}
                  icon={
                    d.dkim_ok === true ? CheckIcon : d.dkim_ok === false ? WarningIcon : ClockIcon
                  }
                >
                  {t('dns.status.dkim')}
                </Badge>
                {/*
                  Vedle NAŠÍ kontroly stojí verdikt AMAZONU, protože se můžou
                  lišit a rozhoduje ten druhý. Doména `brevio.cz` měla záznamy
                  v DNS v pořádku a Amazon ji držel na `PENDING`; dokud tady byl
                  jen náš odznak, vypadala jako hotová.
                */}
                <span
                  data-testid={`domain-ses-${d.id}`}
                  data-ses-status={d.ses_verification_status ?? 'unknown'}
                >
                  <Badge
                    tone={
                      d.verified_at !== null
                        ? 'success'
                        : d.ses_verification_status === 'FAILED'
                          ? 'danger'
                          : 'neutral'
                    }
                    icon={
                      d.verified_at !== null
                        ? CheckIcon
                        : d.ses_verification_status === 'FAILED'
                          ? WarningIcon
                          : ClockIcon
                    }
                  >
                    {t(`dns.sesStatus.${sesStatusKey(d)}`)}
                  </Badge>
                </span>
                <Link
                  href={`${basePath}/settings/sending/domains/${d.id}`}
                  className="text-accent-text underline underline-offset-4"
                >
                  {t('sending.openDomain')}
                </Link>
                {onDeleteDomain && (
                  <Button
                    variant="ghost"
                    data-testid={`delete-domain-${d.id}`}
                    onClick={() => onDeleteDomain(d.id)}
                  >
                    {t('sending.deleteDomainDialog.open')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <GuardThresholds
        settings={guards}
        limits={limits}
        {...(onSaveGuards ? { onSave: onSaveGuards } : {})}
      />
    </div>
  );
}
