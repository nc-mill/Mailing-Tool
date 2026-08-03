'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { EmptyState } from '@mlain/ui/patterns/states';

/**
 * Historie souhlasů jednoho kontaktu, tak jak ji vrací
 * `GET /api/v1/contacts/{contact_id}/consents`.
 *
 * Je to DOKLADOVÁ obrazovka, ne přehled. Proto tu není žádná akce: tabulka
 * `consents` je append only a endpoint na úpravu ani smazání záznamu neexistuje
 * (a podle P07 vzniknout nesmí). Tlačítko „Upravit" by tady slibovalo něco,
 * co server odmítne, a hlavně by popíralo smysl celé evidence.
 */
export type ConsentRecord = {
  id: string;
  purpose: string;
  scope_list_id: string | null;
  status: 'granted' | 'withdrawn';
  legal_basis: string;
  source: string;
  consent_text: string | null;
  evidence: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
};

/**
 * Účely mají texty už v bloku `privacy`, protože se stejná pětice ukazuje
 * i v nastavení soukromí. Duplikovat je pod `consents` by znamenalo, že se
 * jednou přejmenují na jednom místě a na druhém zůstane staré znění.
 */
const PURPOSE_KEY: Record<string, string> = {
  email_marketing: 'privacy.purpose.emailMarketing',
  analytics: 'privacy.purpose.analytics',
  personalization: 'privacy.purpose.personalization',
  profiling: 'privacy.purpose.profiling',
  third_party: 'privacy.purpose.thirdParty',
};

const LEGAL_BASIS_KEY: Record<string, string> = {
  consent: 'consents.legalBasis.consent',
  legitimate_interest: 'consents.legalBasis.legitimateInterest',
  contract: 'consents.legalBasis.contract',
  soft_opt_in: 'consents.legalBasis.softOptIn',
};

/** Dvanáct hodnot omezení `ck_consents__source` z migrace 0001. */
const SOURCE_KEY: Record<string, string> = {
  form: 'consents.source.form',
  import: 'consents.source.import',
  api: 'consents.source.api',
  double_opt_in: 'consents.source.doubleOptIn',
  admin: 'consents.source.admin',
  webhook: 'consents.source.webhook',
  preference_center: 'consents.source.preferenceCenter',
  one_click: 'consents.source.oneClick',
  complaint: 'consents.source.complaint',
  objection: 'consents.source.objection',
  reactivation: 'consents.source.reactivation',
  migration: 'consents.source.migration',
};

function text(evidence: Record<string, unknown>, key: string): string | null {
  const value = evidence[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function ConsentHistory({
  basePath,
  contact,
  records,
}: {
  /** Kořen kontaktů, tedy `/w/{slug}/contacts`. */
  basePath: string;
  contact: { id: string; name: string };
  records: ConsentRecord[];
}) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const router = useRouter();

  /**
   * Doklady jednoho záznamu jako věty, ne jako výpis JSON. `evidence` je otevřený
   * jsonb, takže se vypisuje jen to, čemu obrazovka rozumí; zbytek by stejně nikdo
   * nepřečetl. Chybějící IP se hlásí VĚTOU, ne prázdnem: `ip: null` znamená
   * „projekt si adresy neukládá" (rozhodnutí R8), ne „nevíme".
   */
  function evidenceLines(record: ConsentRecord): string[] {
    const lines: string[] = [];
    const wording = record.consent_text ?? text(record.evidence, 'consent_text');
    if (wording) lines.push(t('consents.evidenceText', { text: wording }));

    const hash = text(record.evidence, 'consent_text_sha256');
    if (hash && !wording) lines.push(t('consents.evidenceTextHash', { hash: hash.slice(0, 12) }));

    const page = text(record.evidence, 'page_url');
    if (page) lines.push(t('consents.evidencePage', { url: page }));

    const form = text(record.evidence, 'form_id');
    if (form) lines.push(t('consents.evidenceForm', { id: form }));

    const confirmed = text(record.evidence, 'double_opt_in_at');
    if (confirmed) {
      lines.push(
        t('consents.evidenceDoubleOptIn', {
          date: format.dateTime(new Date(confirmed), 'short'),
        }),
      );
    }

    const importId = text(record.evidence, 'import_id');
    if (importId) lines.push(t('consents.evidenceImport', { id: importId }));

    if (record.evidence['declaration'] === true) lines.push(t('consents.evidenceDeclaration'));

    const agent = text(record.evidence, 'user_agent');
    if (agent) lines.push(t('consents.evidenceUserAgent', { agent }));

    const ip = text(record.evidence, 'ip');
    if (ip) lines.push(t('consents.evidenceIp', { ip }));
    else if ('ip' in record.evidence) lines.push(t('consents.evidenceIpOff'));

    return lines.length > 0 ? lines : [t('consents.evidenceNone')];
  }

  return (
    <article className="flex flex-col gap-6">
      <Link href={`${basePath}/${contact.id}`}>{t('consents.back')}</Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-text">{t('consents.title')}</h1>
        <p className="text-sm text-text-muted">{t('consents.subject', { name: contact.name })}</p>
        <p>{t('consents.lead')}</p>
      </header>

      {records.length === 0 ? (
        <EmptyState
          variant="first"
          title={t('consents.emptyTitle')}
          explanation={t('consents.emptyBody')}
          // Prázdný stav musí podle P05 nabídnout aspoň jednu akci. Zakládat souhlas
          // odsud se NENABÍZÍ schválně: souhlas vzniká projevem vůle toho člověka,
          // ne kliknutím správce. Jediná pravdivá cesta odsud vede zpátky na kontakt.
          actions={[
            { label: t('consents.back'), onClick: () => router.push(`${basePath}/${contact.id}`) },
          ]}
        />
      ) : (
        <>
          <p data-testid="consents-count">{t('consents.count', { count: records.length })}</p>
          {/* Seznam, ne tabulka: doklad má u každého řádku různě dlouhý výčet důkazů
              a v buňce tabulky by se z něj stal nečitelný chuchvalec. */}
          <ol className="flex flex-col gap-4">
            {records.map((record) => (
              <li
                key={record.id}
                data-testid="consent-record"
                className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="font-semibold text-text">
                    {t(PURPOSE_KEY[record.purpose] ?? 'privacy.purpose.emailMarketing')}
                  </h2>
                  <span data-testid="consent-status" className="text-sm text-text">
                    {record.status === 'granted' ? t('consents.granted') : t('consents.withdrawn')}
                  </span>
                  <time dateTime={record.occurred_at} className="text-sm text-text-muted">
                    {format.dateTime(new Date(record.occurred_at), 'short')}
                  </time>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="font-medium text-text">{t('consents.columnLegalBasis')}</dt>
                  <dd className="text-text">
                    {LEGAL_BASIS_KEY[record.legal_basis]
                      ? t(LEGAL_BASIS_KEY[record.legal_basis]!)
                      : t('consents.legalBasis.unknown', { value: record.legal_basis })}
                  </dd>

                  <dt className="font-medium text-text">{t('consents.columnSource')}</dt>
                  <dd className="text-text">
                    {SOURCE_KEY[record.source]
                      ? t(SOURCE_KEY[record.source]!)
                      : t('consents.source.unknown', { value: record.source })}
                  </dd>

                  {/* Rozsah rozhoduje o tom, čeho se souhlas týká: `null` je celý
                      projekt, jinak jediný seznam. Bez toho by dva řádky se stejným
                      účelem vypadaly jako protiřečící si duplicita. */}
                  <dt className="font-medium text-text">{t('consents.columnScope')}</dt>
                  <dd className="text-text">
                    {record.scope_list_id === null
                      ? t('consents.scopeWorkspace')
                      : t('consents.scopeList')}
                  </dd>

                  <dt className="font-medium text-text">{t('consents.columnEvidence')}</dt>
                  <dd className="flex flex-col gap-1 text-text">
                    {evidenceLines(record).map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </dd>
                </dl>

                {/* Kdy se to stalo versus kdy jsme to zapsali. U importu historického
                    souhlasu se obojí liší o roky a bez druhého data by nešlo poznat,
                    že jde o dodatečně doložený souhlas. Minutová tolerance je tam
                    schválně: u běžného zápisu se obě hodnoty liší o zlomek sekundy
                    a věta „Zapsáno" by pak byla u každého řádku a nic by neříkala. */}
                {Math.abs(
                  new Date(record.created_at).getTime() - new Date(record.occurred_at).getTime(),
                ) > 60_000 ? (
                  <p className="text-xs text-text-muted">
                    {t('consents.recordedAt', {
                      date: format.dateTime(new Date(record.created_at), 'short'),
                    })}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </article>
  );
}
