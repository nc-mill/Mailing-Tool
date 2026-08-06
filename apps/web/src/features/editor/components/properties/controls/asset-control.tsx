'use client';

import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogTitle } from '@mlain/ui/components/dialog';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ACCEPT_ATTRIBUTE } from '@/features/assets/upload-assets';
import type { AssetSummary } from '../../../ports/types';
import { useAddAsset } from '../../canvas/render/canvas-context';
import type { ControlProps } from '../prop-field';

/**
 * ODCHYLKA OD PLÁNU: `DialogTrigger` a `DialogContent` v `@mlain/ui/components/dialog`
 * nejsou. Dialog P05 se otevírá řízeně propem `open` z libovolného tlačítka
 * a obsah nese `DialogBody`, takže spouštěč je obyčejné tlačítko.
 */
export function AssetControl({ descriptor, value, onChange, id, ports, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const addAsset = useAddAsset();

  useEffect(() => {
    if (!open || !ports) return;
    let active = true;
    void ports.listAssets().then((list) => {
      if (active) setAssets(list);
    });
    return () => {
      active = false;
    };
  }, [open, ports]);

  if (descriptor.kind !== 'asset') return <></>;

  return (
    <div className="flex items-center gap-2">
      <Button
        id={id}
        variant="secondary"
        data-autofocus={autoFocus ? '' : undefined}
        onClick={() => setOpen(true)}
      >
        {value ? t('asset.change') : t('asset.pick')}
      </Button>
      {value && descriptor.nullable ? (
        <Button variant="ghost" onClick={() => onChange(null)}>
          {t('asset.remove')}
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTitle>{t('asset.title')}</DialogTitle>
        <DialogBody>
          {/*
            `accept` je výčet, ne `image/*`. Hvězdička v dialogu systému nabídne
            i HEIC, TIFF a BMP, které server odmítne s 415, takže by si uživatel
            vybral soubor a chybu se dozvěděl až po nahrání.
          */}
          <input
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            aria-label={t('asset.upload')}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file || !ports) return;
              setUploadError(null);
              try {
                const uploaded = await ports.uploadAsset(file);
                // Doplnění do mapy plátna je POVINNÉ, ne optimalizace. Bez něj
                // se uloží platné id, ale plátno obrázek ve své mapě nenajde
                // a napíše „Tenhle obrázek už v knihovně není."
                addAsset(uploaded);
                onChange(uploaded.id);
                setOpen(false);
              } catch (error) {
                // Bez odchycení skončí odmítnutí (415, 413, kvóta) jako
                // neošetřené zamítnutí příslibu a uživatel nevidí vůbec nic.
                setUploadError(error instanceof Error ? error.message : t('asset.uploadFailed'));
              }
            }}
          />
          {uploadError !== null && (
            <p role="alert" className="text-sm text-danger-text">
              {uploadError}
            </p>
          )}
          <ul className="grid grid-cols-3 gap-2">
            {assets.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  className="w-full rounded-[var(--radius-control)] border border-border p-1"
                  onClick={() => {
                    onChange(asset.id);
                    setOpen(false);
                  }}
                >
                  {/* Náhled z knihovny obrázků je obyčejný `img`: adresa přichází
                      z portu za běhu a `next/image` by na ni potřeboval statickou
                      konfiguraci domén, kterou vlastní P01. */}
                  <img src={asset.url} alt="" className="h-20 w-full object-contain" />
                  <span className="block truncate text-meta">{asset.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogBody>
      </Dialog>
    </div>
  );
}
