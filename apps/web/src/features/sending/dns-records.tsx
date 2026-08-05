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

export type Finding = {
  code: string;
  severity: string;
  params?: Record<string, string | number>;
};

export type Check = { ok: boolean | null; findings?: Finding[] };

export type DomainChecks = {
  spf?: Check & { record?: string | null };
  dkim?: Check & { found?: number; expected?: number };
  dmarc?: Check & { record?: string | null };
  /**
   * `null` i chybějící klíč znamenají „nekontrolujeme", protože doména nemá
   * vlastní zpáteční adresu. Jádro tenhle stav posílá schválně (viz `runDomainChecks`)
   * a obrazovka pak MX vůbec nevypisuje: kontrola, kterou nejde splnit, do seznamu
   * nepatří.
   */
  mx?: (Check & { records?: string[] }) | null;
};

/** Klíče kontrol v pořadí, v jakém je uživatel řeší. */
const CHECK_KEYS = ['dkim', 'spf', 'dmarc', 'mx'] as const;
type CheckKey = (typeof CHECK_KEYS)[number];

/** Účel záznamu z API na klíč kontroly, ke které patří. */
const PURPOSE_TO_CHECK: Record<string, CheckKey> = {
  dkim: 'dkim',
  spf: 'spf',
  dmarc: 'dmarc',
  mail_from_mx: 'mx',
};

/**
 * Stav jedné kontroly. Rozlišuje se pět stavů, protože každý znamená jinou akci:
 *
 *  - `ok` nedělat nic,
 *  - `note` záznam platí, máme jen radu do budoucna,
 *  - `mismatch` v DNS je jiná hodnota, je co opravit,
 *  - `missing` záznam tam ještě není, čeká se na rozšíření,
 *  - `unknown` nedokázali jsme se zeptat, netvrdíme nic.
 *
 * Dřív se všechny nálezy slily do jednoho seznamu pod kontrolami a text se hledal
 * v krátkém výčtu, kde všechno neznámé spadlo na „Záznam existuje, ale má jinou
 * hodnotu". Uživatel tak u domény brevio.cz dostal tuhle větu dvakrát za sebou,
 * bez toho, které kontroly se týká: patřila k radě u DMARC (`dmarc_policy_none`)
 * a k neshodě MX (`mail_from_mx_wrong`). Ani jedna přitom „jinou hodnotu" neměla.
 */
export type CheckState = 'ok' | 'note' | 'mismatch' | 'missing' | 'unknown';

function stateOf(check: Check | null | undefined): CheckState {
  if (!check || check.ok === null || check.ok === undefined) return 'unknown';
  const findings = check.findings ?? [];
  if (check.ok === true) return findings.length === 0 ? 'ok' : 'note';
  if (findings.some((f) => f.code.endsWith('_missing'))) return 'missing';
  return 'mismatch';
}

const STATE_TONE: Record<CheckState, 'green' | 'amber' | 'red' | 'grey'> = {
  ok: 'green',
  note: 'amber',
  mismatch: 'red',
  missing: 'amber',
  unknown: 'grey',
};

const DOT_CLASS: Record<string, string> = {
  green: 'bg-success',
  amber: 'bg-warning',
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
 *
 * Pravidlo obrazovky: u KAŽDÉ kontroly musí být vidět stav, u neshody čekaná
 * i nalezená hodnota a věta, co s tím. Věta bez kontextu se sem nesmí dostat.
 */
export function DnsRecords({
  domain,
  records,
  checks,
  checkedAt,
  sesStatus,
  verifiedAt,
  onCheckNow,
}: {
  domain: string;
  records: DnsRecord[];
  checks: DomainChecks;
  checkedAt?: string | null;
  /** Doslovný verdikt poskytovatele: `SUCCESS`, `PENDING`, `FAILED`, `NOT_STARTED`. */
  sesStatus?: string | null;
  /** Vyplněné jen tehdy, když doménu za ověřenou uznal POSKYTOVATEL. */
  verifiedAt?: string | null;
  onCheckNow?: () => void | Promise<void>;
}) {
  const t = useTranslations('campaigns.dns');
  const format = useFormatter();
  const [checking, setChecking] = useState(false);

  const dkimExpected = records.filter((r) => r.purpose === 'dkim').length;

  /**
   * Železné pravidlo obrazovky: kontrola se ukazuje JEN k záznamu, který je
   * v tabulce k opsání. MX pro zpáteční adresu vzniká až s vlastní MAIL FROM
   * subdoménou, takže bez ní žádný MX řádek neexistuje a kontrola nemá co hlídat.
   *
   * Podmínka se schválně bere z `records`, ne z `checks`: `checks` je uložený
   * výsledek předchozího běhu a u domén zkontrolovaných starou verzí v něm MX
   * pořád visí. Vazba na tabulku je pravdivá hned, bez čekání na další kontrolu.
   */
  const hasMailFrom = records.some((r) => r.purpose === 'mail_from_mx');
  const visibleKeys = CHECK_KEYS.filter((key) => key !== 'mx' || hasMailFrom);

  /**
   * Text nálezu podle jeho kódu. Neznámý kód nespadne, dojde na obecnou větu.
   *
   * `try` tu není opatrnictví: `checks` je uložený JSON z dřívějších kontrol a
   * starý nález může postrádat parametr, který dnešní věta používá. next-intl
   * v takovém případě vyhodí chybu a shodila by celou obrazovku kvůli jedné větě.
   */
  function findingText(finding: Finding): string {
    const key = `findings.${finding.code}`;
    if (!t.has(key)) return t('findings.unrecognized');
    try {
      return t(key, (finding.params ?? {}) as Record<string, string | number>);
    } catch {
      return t('findings.unrecognized');
    }
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

  /** Očekávaná a nalezená hodnota u jednoho nálezu, když je čím je naplnit. */
  function values(key: CheckKey, finding: Finding): { expected?: string; found?: string } {
    const params = finding.params ?? {};
    const expected =
      typeof params['expected'] === 'string'
        ? params['expected']
        : (records.find((r) => PURPOSE_TO_CHECK[r.purpose] === key)?.value ?? undefined);

    let found: string | undefined;
    if (typeof params['actual'] === 'string' && params['actual'] !== '') {
      found = params['actual'];
    } else if (key === 'spf' && typeof checks.spf?.record === 'string') {
      found = checks.spf.record;
    } else if (key === 'dmarc' && typeof checks.dmarc?.record === 'string') {
      found = checks.dmarc.record;
    } else if (key === 'mx' && (checks.mx?.records?.length ?? 0) > 0) {
      found = checks.mx!.records!.join(', ');
    } else if (finding.code.endsWith('_missing')) {
      found = t('nothingFound');
    }

    return {
      ...(expected === undefined ? {} : { expected }),
      ...(found === undefined ? {} : { found }),
    };
  }

  return (
    <section aria-labelledby="dns-title" className="flex flex-col gap-6">
      <div>
        <h2 id="dns-title" className="text-lg font-semibold">
          {t('title', { domain })}
        </h2>
        {/* Počet se bere z počtu skutečně vygenerovaných karet, nikdy se nepíše natvrdo. */}
        <p className="text-text-muted">{t('recordCount', { count: records.length })}</p>
        {/* Kde je hledat u registrátora. Bez téhle věty je lidi hledají u jmenných
            serverů, protože „DNS" je pro ně nadpis celé sekce. */}
        <p className="text-sm text-text-muted">{t('recordTypes')}</p>
      </div>

      {/*
        VERDIKT POSKYTOVATELE, oddělený od našich kontrol.
        Kontroly níž říkají, co vidíme v DNS my. Jestli doménu uznal za ověřenou
        Amazon, ví jenom Amazon, a ty dvě odpovědi se běžně liší: `brevio.cz`
        měla všechny záznamy v pořádku a Amazon ji držel na `PENDING`. Dokud tady
        jeho verdikt nebyl, tvářila se doména jako hotová.
      */}
      <div data-testid="ses-identity" data-ses-status={sesStatus ?? 'unknown'}>
        <Alert
          tone={
            verifiedAt != null || sesStatus === 'SUCCESS'
              ? 'success'
              : sesStatus === 'FAILED'
                ? 'error'
                : 'info'
          }
        >
          <span className="flex flex-col gap-1">
            <span>
              {t(
                `sesIdentity.${
                  verifiedAt != null || sesStatus === 'SUCCESS'
                    ? 'verified'
                    : sesStatus === 'FAILED'
                      ? 'failed'
                      : sesStatus === 'PENDING'
                        ? 'pending'
                        : sesStatus === 'NOT_STARTED'
                          ? 'notStarted'
                          : 'unknown'
                }`,
              )}
            </span>
            <span className="text-sm text-text-muted">{t('sesIdentity.explanation')}</span>
          </span>
        </Alert>
      </div>

      <ul className="flex flex-col gap-4" data-testid="dns-status">
        {visibleKeys.map((key) => {
          const check = checks[key] ?? null;
          const state = stateOf(check);
          const tone = STATE_TONE[state];
          const findings = check?.findings ?? [];
          const hint = state === 'ok' || state === 'missing' || state === 'unknown';

          return (
            <li
              key={key}
              data-testid={`check-${key}`}
              data-state={state}
              className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  data-testid={`dot-${key}`}
                  data-tone={tone}
                  aria-hidden
                  className={`inline-block size-3 rounded-full ${DOT_CLASS[tone]}`}
                />
                <span className="font-medium" data-testid={`${key}-status`}>
                  {t(`status.${key}`)}
                  {key === 'dkim' && (
                    <span className="ml-1 font-normal text-text-muted">
                      {t('dkimProgress', {
                        found: checks.dkim?.found ?? 0,
                        expected: checks.dkim?.expected ?? dkimExpected,
                      })}
                    </span>
                  )}
                </span>
                {/* Stav je slovo, ne jen barva: bez něj se obrazovka nedá přečíst
                    ani nahlas, ani při poruše barvocitu. */}
                <span className="text-sm text-text-muted" data-testid={`state-${key}`}>
                  {t(`state.${state}`)}
                </span>
              </div>

              {hint && findings.length === 0 && (
                <p className="text-sm text-text-muted">{t(`stateHint.${state}`)}</p>
              )}

              {/* Nález stojí u SVOJÍ kontroly, ne ve společné hromadě pod seznamem.
                  Klíč nese i pořadí: týž kód přijde vícekrát, jednou za každý
                  chybějící DKIM token, a samotný kód by byl duplicitní klíč. */}
              {findings.map((finding, index) => {
                const { expected, found } = values(key, finding);
                return (
                  <Alert
                    key={`${finding.code}-${index}`}
                    tone={finding.severity === 'error' ? 'error' : 'warning'}
                    data-testid={`finding-${finding.code}`}
                  >
                    <span className="flex flex-col gap-1">
                      <span>{findingText(finding)}</span>
                      {expected !== undefined && (
                        <span className="text-sm" data-testid={`expected-${key}`}>
                          {t('expectedLabel')}: <span className="font-mono">{expected}</span>
                        </span>
                      )}
                      {found !== undefined && (
                        <span className="text-sm" data-testid={`found-${key}`}>
                          {t('foundLabel')}: <span className="font-mono">{found}</span>
                        </span>
                      )}
                    </span>
                  </Alert>
                );
              })}
            </li>
          );
        })}
      </ul>

      {/* Vysvětlení místo kontroly, kterou nejde splnit. Uživatel se ptal, kde je
          MX záznam pro zpáteční adresu; odpověď je, že žádný není a proč. */}
      {!hasMailFrom && (
        <Alert tone="info" data-testid="mail-from-off" title={t('mailFromOff.title')}>
          {t('mailFromOff.explanation')}
        </Alert>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title', { domain })}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">
                {t('columns.type')}
              </th>
              <th scope="col" className="text-left">
                {t('columns.purpose')}
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
                {/* Bez tohohle sloupce tabulka nijak nesouvisí se seznamem kontrol
                    nad ní a uživatel nepozná, který řádek která kontrola hlídá. */}
                <td>{t(`status.${PURPOSE_TO_CHECK[r.purpose] ?? 'dkim'}`)}</td>
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
