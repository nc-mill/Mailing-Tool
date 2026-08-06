'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardFooter } from '@mlain/ui/components/card';
import { cn } from '@mlain/ui/lib/cn';
import { StatValue } from './stat-tile';
import { isStale } from './dashboard-slots';

export type WebActivePerson = {
  contactId: string;
  name: string | null;
  email: string;
  lastSeenAt: string;
};

/**
 * Iniciály do čtverečku. Z jména, a když ho kontakt nemá, z e-mailu.
 * Je to ozdoba řádku, ne informace, proto ji odečítač obrazovky přeskočí.
 */
function initialsOf(person: WebActivePerson): string {
  const source = person.name ?? person.email;
  const words = source
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2);
  return words.map((word) => word.charAt(0).toLocaleUpperCase('cs')).join('') || '?';
}

/**
 * Kdo je na webu právě teď. Dlaždice počítá LIDI za posledních 24 hodin,
 * takže se s obdobím 7/30/90 dní nemění; server ji drží v pětiminutové cache.
 *
 * Musí někam vést a musí říct KDO. Do teď to bylo jediné číslo na Přehledu,
 * ze kterého se nedalo nikam kliknout, a „3 kontakty za 24 h" samo o sobě
 * neodpovídá na nic: uživatel chce vědět, kdo to byl a co si prohlédl.
 * Server proto vedle počtu posílá i prvních pár jmen podle poslední návštěvy.
 */
export function WebActiveCard({
  contacts,
  people,
  computedAt,
  webHref,
  error,
}: {
  contacts: number;
  /** Prvních pár lidí podle poslední návštěvy. Zbytek je za odkazem v patičce. */
  people: WebActivePerson[];
  computedAt: string;
  webHref: string;
  /** Dlaždice se nenačetla. Zbytek přehledu tím nepadá. */
  error?: boolean;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const labelId = useId();
  const stale = !error && isStale(computedAt, 300_000, new Date());

  // `self-start` drží kartu na výšce obsahu. V návrhu je seznam lidí dlouhý
  // právě tak, aby karta sahala stejně vysoko jako graf vedle ní; ve skutečném
  // projektu jich bývá míň a natažená karta by měla uprostřed prázdné místo.
  return (
    <Card aria-labelledby={labelId} className="col-span-12 self-start lg:col-span-4">
      <div className="flex items-center justify-between gap-[var(--spacing-inline)]">
        <h2 id={labelId} className="meta-caps text-text-muted">
          {t('dashboard.webActive')}
        </h2>
        {/* Tečka jen doplňuje číslo pod sebou, sama nic nesděluje. */}
        <span
          aria-hidden
          className={cn(
            'size-2.5 shrink-0 rounded-full',
            error || contacts === 0 ? 'bg-border-strong' : 'bg-success',
          )}
        />
      </div>

      {error ? (
        <p role="alert" className="text-ui text-text-muted">
          {t('dashboard.tileError')}
        </p>
      ) : (
        <>
          <StatValue unit={t('dashboard.webActiveUnit', { count: contacts })}>
            {format.number(contacts)}
          </StatValue>
          <p className="text-sm text-text-muted">{t('dashboard.webActiveHint')}</p>

          {people.length > 0 ? (
            <ul className="mt-[var(--spacing-hairline)] grid gap-2">
              {people.map((person) => (
                <li
                  key={person.contactId}
                  className="flex items-center gap-[var(--spacing-inline)]"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex size-6 shrink-0 items-center justify-center',
                      'rounded-[var(--radius-control)] bg-surface-muted',
                      'font-mono text-micro text-text-muted',
                    )}
                  >
                    {initialsOf(person)}
                  </span>
                  <span className="truncate text-sm text-text">{person.name ?? person.email}</span>
                  <span className="ml-auto font-mono text-label text-text-muted">
                    {format.dateTime(new Date(person.lastSeenAt), { timeStyle: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <CardFooter className="justify-between">
            <Link href={webHref} data-testid="web-active-link" className="text-sm">
              {t('dashboard.webActiveAction')}
            </Link>
            {stale ? (
              <span className="font-mono text-label text-text-muted">
                {t('dashboard.computedAt', {
                  time: format.dateTime(new Date(computedAt), { timeStyle: 'short' }),
                })}
              </span>
            ) : null}
          </CardFooter>
        </>
      )}
    </Card>
  );
}
