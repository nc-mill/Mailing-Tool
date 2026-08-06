'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { useToast } from '@mlain/ui/patterns/toast';
import { unsubscribeContactAction } from './actions';

/**
 * Ruční odhlášení jednoho kontaktu ze všech seznamů, ve kterých ještě je.
 *
 * VYTAŽENO Z DETAILU KONTAKTU, když se odhlášení nabídlo i v nabídce „…" v řádku
 * seznamu. Zkopírovat těch pár řádků by znamenalo dvě místa, která se rozejdou:
 * odhlášení je v API operace NAD SEZNAMEM, ne nad kontaktem, takže volající musí
 * poslat identifikátory seznamů, a je snadné poslat i ty, ze kterých je člověk
 * odhlášený dávno.
 *
 * VRÁTIT ZPĚT MÍSTO OKNA je podle 6.6 části 6: ruční odhlášení bývá omyl a je
 * vratné, takže se provede rovnou a nabídne se odpočet. Samotné vrácení dnes jen
 * obnoví stránku, protože opačná cesta („přihlásit zpět") je vědomé rozhodnutí
 * správce s vlastním oknem; tenhle rozpor je starší než tahle funkce a je popsaný
 * v detailu kontaktu.
 */
export function useUnsubscribeContact(workspaceId: string) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const toast = useToast();

  return async function unsubscribe(input: { email: string; listIds: string[] }): Promise<void> {
    const result = await unsubscribeContactAction({
      workspaceId,
      email: input.email,
      listIds: input.listIds,
    });
    // Neúspěch se HLÁSÍ. Do vytažení sem se chyba mlčky spolkla a uživatel odešel
    // s tím, že kontakt odhlásil, přestože se nestalo nic.
    if (result.status !== 'success') {
      toast.error(t('detail.actionFailed', { code: result.code }));
      return;
    }
    toast.undoable({ message: t('detail.unsubscribed'), onUndo: () => router.refresh() });
    router.refresh();
  };
}
