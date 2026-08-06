'use client';

import { Dialog, DialogBody, DialogTitle } from '@mlain/ui/components/dialog';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { AssetSummary, EditorPorts } from '../../../ports/types';

/**
 * Výběr obrázku z knihovny otevřený PŘÍMO Z PLÁTNA.
 *
 * Bez něj musel uživatel po vložení obrázku najít v postranním panelu skupinu
 * Obsah a v ní tlačítko „Vybrat obrázek". Do té doby měl blok prázdné `assetId`,
 * což schéma P08 odmítá (chce formát `uuid`), takže se šablona nedala uložit
 * a editor jen opakoval „Nepodařilo se uložit". Klikací plocha na plátně tenhle
 * mezistav zkracuje na jedno kliknutí.
 */
export function AssetPickerDialog(props: {
  open: boolean;
  ports: EditorPorts | undefined;
  /**
   * Předává se CELÝ obrázek, ne jen jeho id.
   *
   * Plátno si drží mapu obrázků načtenou při otevření editoru a samo se
   * nedozví, že přibyl nový. Kdyby se vracelo jen id, čerstvě nahraný soubor
   * by v mapě nebyl a plátno by na něj hlásilo, že už v knihovně není.
   */
  onPick: (asset: AssetSummary) => void;
  onClose: () => void;
}) {
  const t = useTranslations('editor');
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const { open, ports } = props;

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

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      <DialogTitle>{t('asset.title')}</DialogTitle>
      <DialogBody>
        <input
          type="file"
          accept="image/*"
          aria-label={t('asset.upload')}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file || !props.ports) return;
            const uploaded = await props.ports.uploadAsset(file);
            props.onPick(uploaded);
          }}
        />
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {assets.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                className="w-full rounded-[var(--radius-control)] border border-border p-1"
                onClick={() => props.onPick(asset)}
              >
                {/* Obyčejný `img`: adresa přichází z portu za běhu a `next/image`
                    by na ni potřeboval statickou konfiguraci domén (vlastní P01). */}
                <img src={asset.url} alt="" className="h-20 w-full object-contain" />
                <span className="block truncate text-meta">{asset.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogBody>
    </Dialog>
  );
}
