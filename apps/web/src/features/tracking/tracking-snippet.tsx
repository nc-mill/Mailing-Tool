'use client';

import { useTranslations } from 'next-intl';
import { CopyButton } from '@mlain/ui/components/copy-button';

export type TrackingSnippetProps = {
  publicKey: string;
  /** Adresa, ze které se stahuje skript a kam chodí události. */
  host: string;
  /** Velikost sestaveného skriptu, například „4,1 kB". */
  size: string;
};

/**
 * Úryvek ke zkopírování.
 *
 * Fronta `Mlain.q` je v úryvku schválně: kdo zavolá `Mlain.track()` dřív, než
 * se skript stáhne, by jinak dostal `undefined is not a function` a událost by
 * se ztratila. Úryvek proto nejdřív vyrobí zástupný objekt s frontou, skript ji
 * po načtení přehraje.
 *
 * `async` u značky `script` je taky schválně: měřicí kód nesmí zdržet
 * vykreslení stránky zákazníka. Bez fronty výš by to nešlo, protože by nebylo
 * jisté, kdy je `Mlain` k dispozici.
 */
export function buildSnippet(host: string, publicKey: string): string {
  return `<script>
  (function (w, d) {
    w.Mlain = w.Mlain || { q: [] };
    ['init', 'consent', 'track', 'page', 'identify', 'reset'].forEach(function (m) {
      w.Mlain[m] = w.Mlain[m] || function () { w.Mlain.q.push([m].concat([].slice.call(arguments))); };
    });
    var s = d.createElement('script');
    s.src = '${host}/e/ml.js';
    s.async = true;
    d.head.appendChild(s);
  })(window, document);

  Mlain.init({ key: '${publicKey}', host: '${host}' });
  // Zavolejte, jakmile návštěvník udělí souhlas. Bez něj se nic neuloží.
  Mlain.consent({ analytics: true, personalization: true });
</script>`;
}

export function TrackingSnippet({ publicKey, host, size }: TrackingSnippetProps) {
  const t = useTranslations('tracking');
  const snippet = buildSnippet(host, publicKey);

  return (
    <section aria-labelledby="tracking-snippet">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="tracking-snippet" className="text-xl font-semibold">
            {t('settings.snippet.title')}
          </h2>
          <p className="mt-2 text-text-muted">{t('settings.snippet.description', { size })}</p>
        </div>
        <CopyButton
          value={snippet}
          label={t('settings.snippet.copy')}
          copiedLabel={t('settings.snippet.copied')}
        />
      </div>

      <pre className="mt-4 overflow-x-auto rounded-md bg-surface-muted p-4 text-sm">
        <code>{snippet}</code>
      </pre>

      <dl className="mt-4">
        <dt className="text-sm font-medium">{t('settings.snippet.key_label')}</dt>
        <dd className="mt-1 flex items-center gap-2">
          <code className="rounded bg-surface-muted px-2 py-1 text-sm">{publicKey}</code>
          {/* Vlastní popisek, ne „Zkopírovat kód": dvě tlačítka se stejným
              přístupným jménem se v seznamu ovládacích prvků nedají rozlišit. */}
          <CopyButton
            value={publicKey}
            label={t('settings.snippet.copy_key')}
            copiedLabel={t('settings.snippet.copied')}
            variant="link"
          />
        </dd>
      </dl>
      <p className="mt-2 text-sm text-text-muted">{t('settings.snippet.key_hint')}</p>
      <p className="mt-1 text-sm text-text-muted">{t('settings.snippet.consent_note')}</p>
    </section>
  );
}
