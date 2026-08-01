'use client';

import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogTitle } from '@mlain/ui/components/dialog';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { AssetSummary } from '../../../ports/types';
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
          <input
            type="file"
            accept="image/*"
            aria-label={t('asset.upload')}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file || !ports) return;
              const uploaded = await ports.uploadAsset(file);
              onChange(uploaded.id);
              setOpen(false);
            }}
          />
          <ul className="grid grid-cols-3 gap-2">
            {assets.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  className="w-full rounded border border-border p-1"
                  onClick={() => {
                    onChange(asset.id);
                    setOpen(false);
                  }}
                >
                  {/* Náhled z knihovny obrázků je obyčejný `img`: adresa přichází
                      z portu za běhu a `next/image` by na ni potřeboval statickou
                      konfiguraci domén, kterou vlastní P01. */}
                  <img src={asset.url} alt="" className="h-20 w-full object-contain" />
                  <span className="block truncate text-xs">{asset.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogBody>
      </Dialog>
    </div>
  );
}
