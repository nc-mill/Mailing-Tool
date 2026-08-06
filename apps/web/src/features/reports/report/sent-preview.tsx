'use client';

import { EmailPreview } from '@mlain/ui/patterns/email-preview';
import { Alert, ReadOnlyBanner } from '@mlain/ui/patterns/states';
import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { useEffect, useState } from 'react';
import { campaignSentContentUrl, fetchJson } from '../api-client';

export type SentPreviewPayload = {
  html: string | null;
  text: string | null;
  compiled_at: string | null;
  revision: number;
  status: string;
  subject: string;
  /**
   * `missing` = kampaň nemá dokument, `empty` = má ho, ale není v něm jediný
   * obsahový blok, `ok` = obsah je. Patička se za obsah nepočítá.
   */
  content_state: 'missing' | 'empty' | 'ok';
  personalized_for: string | null;
};

/**
 * Odeslaná podoba kampaně, JEN KE ČTENÍ.
 *
 * Kreslí to, co vrátí `GET /api/v1/campaigns/{id}/sent-content`, tedy
 * `campaigns.compiled_html` VYRENDEROVANÉ daty skutečné odeslané zprávy.
 * Nic se tu nekompiluje znovu a není tu žádná cesta k úpravě: odeslaná kampaň
 * je doklad o tom, co příjemci dostali, a přepsat se nesmí.
 *
 * PROČ SE PŘESTALO ČÍST Z `/campaigns/{id}/preview`. Ta cesta vrací uložené
 * sloupce tak, jak jsou, tedy se syrovými Liquid výrazy. Uživatel pak v sekci
 * „Co se doopravdy rozeslalo" viděl `{{ workspace.sender_address }}` a odkazy
 * mířící na `{{ unsubscribe_url }}`, což je podoba, kterou nikdo nedostal.
 * Report je doklad, takže se ptá na vyrenderovanou podobu.
 *
 * PRÁZDNO SE VYSVĚTLUJE, NE MLČÍ. Kampaň, ve které není nic než patička, se
 * odeslat MŮŽE a taky se to stalo. Rám je pak skoro bílý a bez věty nad ním
 * to vypadá jako rozbitá obrazovka; nález přišel přesně takhle („nic
 * nezobrazuje, je to prázdný"). `content_state` proto rozlišuje, jestli
 * nemáme co ukázat, nebo jestli ukazujeme prázdný e-mail, který takhle
 * doopravdy odešel.
 *
 * HTML jde do rámce přes `srcdoc` a `sandbox` bez jediné výjimky, stejně jako
 * v náhledu editoru. Bez `allow-scripts` a bez `allow-same-origin`: tělo e-mailu
 * je uživatelský obsah a chováme se k němu jako k cizímu. O rámec i o zákaz
 * odchozích požadavků se stará `EmailPreview` z návrhového systému, aby v
 * repozitáři nevznikl druhý, jinak zabezpečený náhled.
 */
export function SentPreview({ campaignId }: { campaignId: string }) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [payload, setPayload] = useState<SentPreviewPayload | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * PŮVODY OBRÁZKŮ SE PŘEDÁVAJÍ ZVENČÍ A JE TO OPRAVA PRÁZDNÉHO RÁMU, NE LADĚNÍ.
   *
   * `EmailPreview` si bez tohohle příznaku dosazuje `window.location.origin`
   * až ve VLASTNÍM efektu po připojení. První vykreslení tedy složí `srcdoc`
   * s `img-src data:` a hned nato ho přepíše druhou podobou. Chromium takový
   * rám, kterému se `srcdoc` změní bezprostředně po vložení do stránky,
   * nechá NEVYKRESLENÝ: dokument se rozparsuje (obsah je v DOM), ale rám
   * zůstane prázdný bílý obdélník. Naměřeno v prohlížeči na běžící instalaci
   * proti čerstvě vloženému rámu s týmž `srcdoc`, který se vykreslil správně.
   *
   * Hodnota se drží v `useState` s líným inicializátorem, takže je STÁLÁ přes
   * všechna vykreslení. `EmailPreview` pak `srcdoc` po připojení nemění vůbec
   * a rám se načte jednou. Na serveru okno není, tam je pole prázdné a náhled
   * se stejně kreslí až po klientském načtení dat.
   */
  const [imageOrigins] = useState<readonly string[]>(() =>
    typeof window === 'undefined' ? [] : [window.location.origin],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchJson<SentPreviewPayload>(campaignSentContentUrl(campaignId))
      .then((result) => {
        if (cancelled || result.status !== 'ok') return;
        setPayload(result.data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (failed) {
    return (
      <Card aria-labelledby="sent-preview-heading">
        <CardTitle>
          <span id="sent-preview-heading">{t('report.sentPreview.heading')}</span>
        </CardTitle>
        <Alert tone="error">{t('report.sentPreview.failed')}</Alert>
      </Card>
    );
  }

  if (!payload) {
    return (
      <div
        aria-busy="true"
        className="h-64 animate-pulse rounded-[var(--radius-surface)] bg-surface-muted"
      />
    );
  }

  // Patička není obsah, takže `empty` znamená e-mail, ve kterém nebylo nic než
  // ona. Rám se přesto kreslí: uživatel má vidět, co příjemci doopravdy přišlo.
  const emptyContent = payload.html !== null && payload.content_state === 'empty';

  return (
    <Card data-testid="sent-preview" aria-labelledby="sent-preview-heading">
      <CardTitle>
        <span id="sent-preview-heading">{t('report.sentPreview.heading')}</span>
      </CardTitle>

      {/* Pruh stojí nad obsahem, ne pod ním: uživatel má vědět, že se na tohle
          dívá jen zvenčí, dřív než začne hledat, kde se to upravuje. */}
      <ReadOnlyBanner reason={t('report.sentPreview.readOnly')} />

      <dl className="grid gap-x-[var(--spacing-card)] gap-y-1 sm:grid-cols-[auto_1fr] [&_dd]:font-mono [&_dd]:text-sm [&_dd]:text-text">
        <dt className="meta-caps text-text-muted">{t('report.sentPreview.subject')}</dt>
        <dd>{payload.subject}</dd>
        {payload.compiled_at === null ? null : (
          <>
            <dt className="meta-caps text-text-muted">{t('report.sentPreview.compiledAt')}</dt>
            <dd>
              {format.dateTime(new Date(payload.compiled_at), {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </dd>
          </>
        )}
        <dt className="text-text-muted">{t('report.sentPreview.revision')}</dt>
        <dd className="tabular-nums">{format.number(payload.revision)}</dd>
        {payload.personalized_for === null ? null : (
          <>
            {/*
             * Podle koho se dosadily osobní údaje. Bez téhle řádky by uživatel
             * nevěděl, čí podobu vidí, a u kampaně s oslovením by si myslel,
             * že všem odešlo právě tohle jméno.
             */}
            <dt className="text-text-muted">{t('report.sentPreview.personalizedFor')}</dt>
            <dd data-testid="sent-preview-personalized-for">{payload.personalized_for}</dd>
          </>
        )}
      </dl>

      {payload.html === null ? (
        // Prázdný stav vysvětluje, ne obviňuje: kampaň existuje, jen zatím nemá
        // uloženou podobu. Akci tu záměrně žádnou nenabízíme, protože z reportu
        // se odeslaná podoba nevyrábí.
        <Alert tone="info" title={t('report.sentPreview.notCompiledTitle')}>
          {t('report.sentPreview.notCompiledBody')}
        </Alert>
      ) : (
        <>
          {emptyContent ? (
            /*
             * Není to varování o vadě rozhraní, ale nález o kampani: takhle
             * doopravdy odešla. Tón je proto `warning`, ne `error`, a věta
             * říká, co se stalo, ne že si má uživatel něco opravit zpětně.
             */
            <Alert
              tone="warning"
              title={t('report.sentPreview.emptyContentTitle')}
              data-testid="sent-preview-empty-content"
            >
              {t('report.sentPreview.emptyContentBody')}
            </Alert>
          ) : null}
          <div data-testid="sent-preview-frame">
            <EmailPreview
              html={payload.html}
              title={t('report.sentPreview.frameTitle')}
              imageOrigins={imageOrigins}
            />
          </div>
          {/*
           * Systémové odkazy v náhledu nikam nevedou a musí se to říct.
           * Odhlašovací adresu skládá odesílač z podepsaného tokenu pro
           * konkrétní zprávu, takže report ji nemá odkud vzít a vyrábět
           * ji znovu jen kvůli náhledu by znamenalo funkční odhlášení
           * cizího kontaktu na jedno kliknutí.
           */}
          <p className="text-meta text-text-muted">{t('report.sentPreview.systemLinksNote')}</p>
        </>
      )}

      {payload.text === null || payload.text.trim() === '' ? null : (
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-ui text-accent-text">
            {t('report.sentPreview.textHeading')}
          </summary>
          <pre
            data-testid="sent-preview-text"
            className="mt-[var(--spacing-inline)] whitespace-pre-wrap rounded-[var(--radius-control)] bg-surface-muted p-3 font-mono text-meta text-text"
          >
            {payload.text}
          </pre>
        </details>
      )}
    </Card>
  );
}
