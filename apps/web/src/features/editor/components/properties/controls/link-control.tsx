'use client';

import { Input } from '@mlain/ui/components/input';
import { Switch } from '@mlain/ui/components/switch';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ControlProps } from '../prop-field';

const ALLOWED = ['https:', 'http:', 'mailto:', 'tel:'];
const SYSTEM_TAGS = ['{{ unsubscribe_url }}', '{{ preferences_url }}', '{{ webview_url }}'];

/**
 * Validace schématu (content_link_scheme_forbidden) a zákaz Liquidu
 * v trackovaném odkazu (3.1.5).
 *
 * `trackable` je POVINNÝ kontext, ne kosmetika. Dřív ho funkce nebrala v úvahu
 * a proměnnou v odkazu odmítala vždy, i když měl blok sledování vypnuté. Byl
 * to rozpor mezi rozhraním a datovým modelem: `semantic-structure.ts` hlásí
 * u nesledovaného odkazu jen VAROVÁNÍ, kdežto tenhle control hodnotu vůbec
 * nezapsal do dokumentu, takže ji nešlo uložit ani odeslat přes API.
 *
 * Kvůli tomu nešel v editoru postavit transakční e-mail typu „odkaz na reset
 * hesla přijde při volání API a dosadí se do tlačítka", což je hlavní důvod,
 * proč transakční pošta existuje.
 *
 * Kód `liquid` proto zůstává jen tam, kde ho hlásí i validace dokumentu:
 * u SLEDOVANÉHO odkazu. Tam je to pravda, ne obtěžování: dynamický odkaz nejde
 * trackovat, protože `campaign_links` drží jednu pevnou URL na dvojici kampaň
 * a pozice, takže není kam ten cíl uložit.
 */
export function validateHref(
  raw: string,
  options: { trackable?: boolean } = {},
): 'ok' | 'scheme' | 'liquid' {
  const value = raw.trim();
  if (value === '' || SYSTEM_TAGS.includes(value)) return 'ok';
  if (value.includes('{{') || value.includes('{%')) {
    return options.trackable === false ? 'ok' : 'liquid';
  }
  try {
    if (!ALLOWED.includes(new URL(value).protocol)) return 'scheme';
  } catch {
    return 'scheme';
  }
  return 'ok';
}

export function LinkControl({
  descriptor,
  value,
  onChange,
  id,
  block,
  templateKind,
  autoFocus,
}: ControlProps) {
  const t = useTranslations('editor');
  const [draft, setDraft] = useState(String(value ?? ''));
  const [problem, setProblem] = useState<'ok' | 'scheme' | 'liquid'>('ok');
  if (descriptor.kind !== 'link') return <></>;
  const trackableKey = descriptor.trackableKey;
  // Bez `trackableKey` blok sledování nezná (například odkaz v patičce nebo
  // v sociálních ikonách) a takový odkaz se nesleduje. Proto `false`, ne `true`:
  // výchozí hodnota se musí shodovat s tím, co o bloku ví `checkStructure`.
  //
  // V TRANSAKČNÍM PROFILU je sledování vypnuté vždy, bez ohledu na vlastnost
  // bloku: transakční šablona se kompiluje s `trackClicks: false`, takže je
  // `trackable` v ní mrtvá hodnota. Je to táž úvaha jako v `tracksLinks`
  // v `semantic-structure.ts` a musí vyjít stejně, jinak editor odmítne obsah,
  // který server přijme.
  const declaredTrackable = trackableKey ? block.props[trackableKey] !== false : false;
  const trackable = templateKind === 'transactional' ? false : declaredTrackable;

  return (
    <div className="space-y-1">
      <Input
        id={id}
        data-autofocus={autoFocus ? '' : undefined}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const state = validateHref(next, { trackable });
          setProblem(state);
          if (state === 'ok') onChange(next);
        }}
      />
      {problem !== 'ok' ? (
        <p role="alert" className="text-meta text-danger-text">
          {problem === 'scheme' ? t('link.schemeForbidden') : t('link.liquidForbidden')}
        </p>
      ) : null}
      {trackableKey ? (
        <label className="flex items-center gap-2 text-meta">
          <Switch
            checked={declaredTrackable}
            onCheckedChange={(checked) => {
              // Přepnutí sledování mění i to, jestli je odkaz s proměnnou
              // v pořádku, takže se hodnota přehodnotí. Bez toho by nad
              // odkazem zůstala viset hláška, která už neplatí, a hodnota
              // napsaná při zapnutém sledování by se do dokumentu nedostala.
              const state = validateHref(draft, { trackable: checked });
              setProblem(state);
              onChange(state === 'ok' ? draft : block.props[descriptor.key], {
                [trackableKey]: checked,
              });
            }}
          />
          {t('link.trackable')}
        </label>
      ) : null}
    </div>
  );
}
