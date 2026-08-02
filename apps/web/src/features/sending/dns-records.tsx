'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { CopyButton } from '@mlain/ui/components/copy-button';
import { Alert } from '@mlain/ui/patterns/states';

export type DnsRecord = {
  type: string;
  name: string;
  value: string;
  ttl: number;
  purpose: string;
  required: boolean;
};

export type Check = {
  ok: boolean | null;
  findings?: Array<{ code: string; severity: string; params?: Record<string, string | number> }>;
};

export type DomainChecks = {
  spf?: Check & { record?: string | null };
  dkim?: Check & { found?: number; expected?: number };
  dmarc?: Check;
  mx?: Check;
};

/** `null` znamená „nevíme", a takový stav nesmí blokovat ani strašit červenou. */
function tone(ok: boolean | null | undefined): 'green' | 'red' | 'grey' {
  if (ok === true) return 'green';
  if (ok === false) return 'red';
  return 'grey';
}

const DOT_CLASS: Record<string, string> = {
  green: 'bg-success',
  red: 'bg-danger',
  grey: 'bg-border-strong',
};

function csv(records: DnsRecord[]): string {
  const head = 'type,name,value,ttl';
  const rows = records.map((r) => `${r.type},"${r.name}","${r.value}",${r.ttl}`);
  return [head, ...rows].join('\n');
}

/**
 * DNS záznamy k opsání a kontrola na jedno kliknutí.
 *
 * Hodnoty se nikdy neskládají v komponentě: přicházejí z API, kam je dodává
 * `buildDnsRecords` z odpovědi Amazonu. Počet záznamů je ICU plurál nad tím,
 * co se opravdu vygenerovalo, ne pevné slovo.
 */
export function DnsRecords({
  domain,
  records,
  checks,
  checkedAt,
  onCheckNow,
}: {
  domain: string;
  records: DnsRecord[];
  checks: DomainChecks;
  checkedAt?: string | null;
  onCheckNow?: () => void | Promise<void>;
}) {
  const t = useTranslations('campaigns.dns');
  const format = useFormatter();
  const [checking, setChecking] = useState(false);

  const dkim = checks.dkim ?? {
    ok: null,
    found: 0,
    expected: records.filter((r) => r.purpose === 'dkim').length,
  };
  const findings = [
    ...(checks.spf?.findings ?? []),
    ...(checks.dkim?.findings ?? []),
    ...(checks.dmarc?.findings ?? []),
    ...(checks.mx?.findings ?? []),
  ];

  function findingText(code: string): string {
    if (code === 'spf_multiple_records') return t('spfMultiple');
    if (code === 'dkim_name_duplicated') return t('nameDuplicated', { found: '', expected: '' });
    if (code === 'dkim_cloudflare_proxy') return t('cloudflareProxy');
    if (code.endsWith('_unknown')) return t('unknown');
    if (code.endsWith('_missing')) return t('waiting');
    return t('wrongValue');
  }

  function downloadCsv() {
    const blob = new Blob([csv(records)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dns-${domain}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="dns-title" className="flex flex-col gap-6">
      <div>
        <h2 id="dns-title" className="text-lg font-semibold">
          {t('title', { domain })}
        </h2>
        {/* Počet se bere z počtu skutečně vygenerovaných karet, nikdy se nepíše natvrdo. */}
        <p className="text-text-muted">{t('recordCount', { count: records.length })}</p>
      </div>

      <ul className="flex flex-wrap gap-4" data-testid="dns-status">
        {(['dkim', 'spf', 'dmarc', 'mx'] as const).map((key) => {
          const value = tone(checks[key]?.ok);
          return (
            <li key={key} className="flex items-center gap-2">
              <span
                data-testid={`dot-${key}`}
                data-tone={value}
                aria-hidden
                className={`inline-block size-3 rounded-full ${DOT_CLASS[value]}`}
              />
              <span data-testid={`${key}-status`}>
                {t(`status.${key}`)}
                {key === 'dkim' && (
                  <span className="ml-1 text-text-muted">
                    {t('dkimProgress', {
                      found: dkim.found ?? 0,
                      expected: dkim.expected ?? records.filter((r) => r.purpose === 'dkim').length,
                    })}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Klíč nese i pořadí: týž kód přijde vícekrát, jednou za každý chybějící
          DKIM token, a samotný kód by byl duplicitní klíč. Ověřeno v prohlížeči,
          React to hlásil jako „two children with the same key". */}
      {findings.map((f, index) => (
        <Alert key={`${f.code}-${index}`} tone={f.severity === 'error' ? 'error' : 'warning'}>
          {findingText(f.code)}
        </Alert>
      ))}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title', { domain })}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">
                {t('columns.type')}
              </th>
              <th scope="col" className="text-left">
                {t('columns.name')}
              </th>
              <th scope="col" className="text-left">
                {t('columns.value')}
              </th>
              <th scope="col" className="text-left">
                {t('columns.ttl')}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={`${r.purpose}-${r.name}-${r.value}`} data-purpose={r.purpose}>
                <td>{r.type}</td>
                <td className="break-all">
                  <span className="font-mono">{r.name}</span>
                  <CopyButton
                    value={r.name}
                    label={t('copy')}
                    copiedLabel={t('copied')}
                    variant="link"
                  />
                </td>
                <td className="break-all">
                  <span className="font-mono">{r.value}</span>
                  <CopyButton
                    value={r.value}
                    label={t('copy')}
                    copiedLabel={t('copied')}
                    variant="link"
                  />
                </td>
                <td>{format.number(r.ttl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={async () => {
            setChecking(true);
            try {
              await onCheckNow?.();
            } finally {
              setChecking(false);
            }
          }}
          pending={checking}
        >
          {t('checkNow')}
        </Button>
        <Button onClick={downloadCsv}>{t('downloadCsv')}</Button>
        <span className="text-sm text-text-muted" data-testid="dns-checked-at">
          {checkedAt
            ? t('checkedAt', { time: format.dateTime(new Date(checkedAt), 'short') })
            : t('neverChecked')}
        </span>
      </div>

      <p className="text-sm text-text-muted">{t('propagation')}</p>
    </section>
  );
}
