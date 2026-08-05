'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogTitle } from '@mlain/ui/components/dialog';
import { toAssetRow, type ApiAssetList, type AssetRow } from '@/features/assets/types';

export type BrandLogoValue = { id: string; url: string; name: string } | null;

export type BrandLogoFieldProps = {
  workspaceId: string;
  value: BrandLogoValue;
  onChange: (next: BrandLogoValue) => void;
  disabled?: boolean;
};

/**
 * Logo se VYBÍRÁ Z KNIHOVNY MÉDIÍ, nenahrává se tady bokem.
 *
 * Nahrávání má vlastní obrazovku (`/w/{slug}/assets`) se vším, co k němu
 * patří: kontrola typu a velikosti, deduplikace, alternativní text, přehled
 * „kde se obrázek používá". Druhé, tenčí nahrávání na obrazovce značky by
 * tyhle věci buď obešlo, nebo je muselo zopakovat, a logo by se v knihovně
 * objevilo jako soubor, o kterém nikdo neví, odkud přišel.
 *
 * Vzor je výběr obrázku v editoru (`features/editor/.../asset-control.tsx`):
 * týž dialog, tatáž mřížka náhledů, tentýž zdroj dat `GET /api/v1/assets`.
 */
export function BrandLogoField({
  workspaceId,
  value,
  onChange,
  disabled = false,
}: BrandLogoFieldProps) {
  const t = useTranslations('ai');
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setFailed(false);
    void fetch('/api/v1/assets?limit=200', {
      headers: { 'X-Workspace-Id': workspaceId, accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as ApiAssetList;
      })
      .then((payload) => {
        if (active) setAssets(payload.data.map(toAssetRow));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [open, workspaceId]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {value === null ? (
        <p className="text-sm text-text-muted">{t('brand.logoNone')}</p>
      ) : (
        // Náhled je obyčejný `img`: adresa přichází z API za běhu a `next/image`
        // by na ni potřeboval statickou konfiguraci domén. Týž důvod jako
        // v knihovně médií a v editoru.
        <img
          src={value.url}
          alt={value.name}
          data-testid="brand-logo-preview"
          className="h-12 w-auto max-w-48 rounded border border-border bg-surface object-contain p-1"
        />
      )}

      <Button type="button" variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
        {value === null ? t('brand.logoPick') : t('brand.logoReplace')}
      </Button>
      {value === null ? null : (
        <Button type="button" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
          {t('brand.logoRemove')}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTitle>{t('brand.logoDialogTitle')}</DialogTitle>
        <DialogBody>
          {failed ? <p role="alert">{t('brand.logoLoadFailed')}</p> : null}
          {!failed && assets.length === 0 ? <p>{t('brand.logoLibraryEmpty')}</p> : null}
          <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-auto">
            {assets.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  className="w-full rounded border border-border p-1 hover:border-border-strong"
                  onClick={() => {
                    onChange({ id: asset.id, url: asset.url, name: asset.originalFilename });
                    setOpen(false);
                  }}
                >
                  {/* Náhled z knihovny, ne `next/image`: adresa přichází z API
                      za běhu a `next/image` by na ni potřeboval statickou
                      konfiguraci domén. Týž důvod jako v knihovně médií. */}
                  <img
                    src={asset.thumbnailUrl}
                    alt=""
                    className="h-20 w-full object-contain"
                    loading="lazy"
                  />
                  <span className="block truncate text-xs">{asset.originalFilename}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogBody>
      </Dialog>
    </div>
  );
}
