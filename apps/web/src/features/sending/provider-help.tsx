'use client';

import { useTranslations } from 'next-intl';
import { Collapsible } from '@mlain/ui/components/collapsible';
import { Alert } from '@mlain/ui/patterns/states';

/**
 * Nápověda k dialogu „Nový odesílací účet".
 *
 * Proč vůbec existuje: přístupové údaje k SES nevznikají u nás, ale v konzoli
 * Amazonu, a bez postupu je uživatel prostě nenajde. Naměřená stížnost zněla
 * doslova „bez vysvětlení, kde má co najít a udělat, nenajde nic".
 *
 * Proč je ROZBALOVACÍ: celý návod má přes dvacet odstavců a nesmí odsunout
 * formulář pod okraj obrazovky. Rozbalí ho jen ten, kdo ho potřebuje.
 *
 * Co se naopak NEROZBALUJE: upozornění na testovací režim u Amazonu. To je
 * zdaleka nejčastější důvod, proč první kampaň neodejde, a schované upozornění
 * je k ničemu. Stojí proto natvrdo vedle polí.
 *
 * Názvosloví drží slovník 9.2 (`packages/i18n/src/checks/glossary.ts`): stav,
 * kterému konzole AWS říká sandbox, se v katalogu jmenuje „Testovací režim
 * u Amazonu". Anglická verze mluví o „test mode at Amazon", protože slovo
 * sandbox brána zakazuje i ve tvaru, který sama nabízí jako náhradu.
 */

/**
 * Odkazy do dokumentace AWS. Adresy NEJSOU odhadnuté: každá byla stažená
 * a ověřená přes `<title>` a `<link rel="canonical">` stránky. Chybná adresa
 * u Amazonu totiž nevrací 404, ale mlčky přesměruje na úvod příručky, takže
 * pouhý stavový kód by tady nic nedokázal.
 */
const SES_LINKS = [
  { key: 'linkSetup', href: 'https://docs.aws.amazon.com/ses/latest/dg/setting-up.html' },
  {
    key: 'linkIamUser',
    href: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html',
  },
  {
    key: 'linkAccessKeys',
    href: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
  },
  {
    key: 'linkPolicies',
    href: 'https://docs.aws.amazon.com/ses/latest/dg/security-iam-awsmanpol.html',
  },
  { key: 'linkRegions', href: 'https://docs.aws.amazon.com/general/latest/gr/ses.html' },
  {
    key: 'linkIdentities',
    href: 'https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html',
  },
  {
    key: 'linkConfigSets',
    href: 'https://docs.aws.amazon.com/ses/latest/dg/using-configuration-sets.html',
  },
  {
    key: 'linkSandbox',
    href: 'https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html',
  },
] as const;

const SES_STEPS = ['sesStep1', 'sesStep2', 'sesStep3', 'sesStep4', 'sesStep5', 'sesStep6'] as const;

const SES_FIELDS = ['sesRegion', 'sesAccessKey', 'sesSecret', 'sesConfigSet'] as const;

const SMTP_FIELDS = [
  'smtpHost',
  'smtpPort',
  'smtpUsername',
  'smtpPassword',
  'smtpEncryption',
] as const;

type Translate = ReturnType<typeof useTranslations>;

/** Popisky se skládají výčtem sufixů, aby překlep našel překladač, ne uživatel. */
function Definitions({ t, items }: { t: Translate; items: readonly string[] }) {
  return (
    <dl className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item}>
          <dt className="text-sm font-medium text-text">{t(`${item}Title`)}</dt>
          <dd className="text-sm text-text-muted">{t(`${item}Text`)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium text-text">{children}</p>;
}

function SesHelp({ t }: { t: Translate }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{t('sesIntro')}</p>

      <SectionTitle>{t('sesStepsTitle')}</SectionTitle>
      <ol className="flex list-none flex-col gap-2 p-0">
        {SES_STEPS.map((step) => (
          <li key={step}>
            <span className="block text-sm font-medium text-text">{t(`${step}Title`)}</span>
            <span className="block text-sm text-text-muted">{t(`${step}Text`)}</span>
          </li>
        ))}
      </ol>

      <SectionTitle>{t('sesFieldsTitle')}</SectionTitle>
      <Definitions t={t} items={SES_FIELDS} />

      <SectionTitle>{t('sandboxHowTitle')}</SectionTitle>
      <p className="text-sm text-text-muted">{t('sandboxHowText')}</p>

      <SectionTitle>{t('linksTitle')}</SectionTitle>
      <ul className="flex list-none flex-col gap-1 p-0">
        {SES_LINKS.map((link) => (
          <li key={link.key}>
            <a
              href={link.href}
              target="_blank"
              // `noreferrer` je tady kvůli `noopener` ve starších prohlížečích,
              // ne kvůli soukromí: cizí karta nesmí sáhnout na naši přes `opener`.
              rel="noreferrer noopener"
              className="text-sm text-text underline underline-offset-2"
            >
              {t(link.key)}
              <span className="sr-only"> {t('linkNewWindow')}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SmtpHelp({ t }: { t: Translate }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{t('smtpIntro')}</p>

      <SectionTitle>{t('smtpFieldsTitle')}</SectionTitle>
      <Definitions t={t} items={SMTP_FIELDS} />

      <SectionTitle>{t('smtpLimitTitle')}</SectionTitle>
      <p className="text-sm text-text-muted">{t('smtpLimitText')}</p>
    </div>
  );
}

/** Rozbalovací návod „Kde tyhle údaje vezmu?" pro zvolený typ účtu. */
export function ProviderHelp({ type }: { type: 'ses' | 'smtp' }) {
  const t = useTranslations('campaigns.sending.addDialog.help');

  return (
    <div data-testid="provider-help">
      <Collapsible summary={<span>{type === 'ses' ? t('sesSummary') : t('smtpSummary')}</span>}>
        {type === 'ses' ? <SesHelp t={t} /> : <SmtpHelp t={t} />}
      </Collapsible>
    </div>
  );
}

/**
 * Upozornění na testovací režim u Amazonu. Vědomě NENÍ součástí nápovědy:
 * uživatel s novým účtem na tuhle zeď narazí vždycky a dozví se to teď,
 * ne až mu první kampaň skončí chybou.
 */
export function SesSandboxNotice() {
  const t = useTranslations('campaigns.sending.addDialog.help');

  return (
    <Alert tone="warning" title={t('sandboxTitle')} data-testid="provider-sandbox-notice">
      {t('sandboxText')}
    </Alert>
  );
}
