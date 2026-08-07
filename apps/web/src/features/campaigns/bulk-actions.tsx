'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Trash2 } from '@mlain/ui/icons';
import { useToast } from '@mlain/ui/patterns/toast';
import { deleteCampaignAction } from './actions';
import { BulkDeleteCampaignsDialog } from './bulk-delete-campaigns-dialog';
import { canDeleteCampaign } from './campaign-state';
import type { CampaignRow } from './campaign-list';

/**
 * Hromadné akce nad označenými kampaněmi.
 *
 * VZNIKLO Z NÁLEZU, ŽE VÝBĚR NIKAM NEVEDL. Zaškrtávátka v tabulce kampaní byla
 * od začátku, protože je `DataTable` kreslí vždycky, ale pruh nad tabulkou nabízel
 * jedině „Vybrat všech 12" a „Zrušit výběr". Doslova od zadavatele: „Multivýběr.
 * Nemůžu s nimi nic dělat. Třeba je smazat, pokud jsou rozepsané."
 *
 * JE TU JEDINÁ AKCE, A JE TO ZÁMĚR. Přejmenování ani úprava obsahu nad výběrem
 * nedávají smysl (obojí míří na jednu kampaň), duplikace deseti kampaní naráz je
 * akce, kterou nikdo nechce, a pozastavení či zrušení rozesílky se dělá na obrazovce
 * průběhu, kde je vidět, co se s kampaní zrovna děje. Zbývá mazání, tedy přesně to,
 * co zadavatel jmenoval. Ovládání, které slibuje víc, než co endpointy unesou, se
 * sem dodělávat nebude.
 *
 * HROMADNÝ ENDPOINT V API NENÍ. `DELETE /campaigns/{id}` je po jedné, takže se volá
 * v cyklu. Nad seznamem kampaní je to únosné (jde o desítky řádků, ne o statisíce
 * jako u kontaktů, které proto mají vlastní úlohu na pozadí).
 */
export function CampaignsBulkActions({
  workspaceId,
  selected,
  onCompleted,
}: {
  workspaceId: string;
  /** Označené řádky, ne jen jejich identifikátory: rozhoduje se podle stavu. */
  selected: CampaignRow[];
  /**
   * Akce doběhla a výběr se má srovnat. Dostane identifikátory kampaní, které
   * ve výběru ZŮSTÁVAJÍ, tedy ty, které se smazat nepodařily.
   *
   * Není to prosté „ukliď výběr": po částečném nezdaru by se uživateli ztratilo
   * z očí právě to, co si má prohlédnout. Po úplném úspěchu přijde prázdné pole
   * a pruh nad tabulkou zmizí.
   */
  onCompleted: (remainingIds: string[]) => void;
}) {
  const t = useTranslations('campaigns');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  /*
   * Rozdělení výběru podle toho, co jádro dovolí. `canDeleteCampaign` je tentýž
   * výčet stavů, jaký má `DELETABLE_STATUSES` v jádru, takže se rozhraní neptá
   * na něco, co server odmítne.
   *
   * POČÍTÁ SE Z `selected`, TEDY Z ŘÍZENÉHO VÝBĚRU, ne z toho, co hlásí pruh.
   * Odkaz „Vybrat všech N" v pruhu přepíná režim UVNITŘ `DataTable` a pole
   * `selectedIds` se jím nemění, takže se po jeho stisku pruh a tlačítko rozejdou:
   * pruh napíše „Vybráno všech 12", tlačítko „Smazat 1 kampaň". Vidět to je,
   * tiché to není a smaže se přesně to, co tlačítko slibuje, ale správně to není.
   * Spravit to jde jedině v `packages/ui/src/patterns/data-table` (buď ať režim
   * teče ven, nebo ať se odkaz nenabízí tam, kde je celá tabulka na jedné stránce)
   * a ta složka je zabraná jiným agentem. Zapsáno v `STAV-UKOLU.md`.
   */
  const target = selected;
  const deletable = target.filter((row) => canDeleteCampaign(row.status));
  const skipped = target.length - deletable.length;

  /**
   * Smazání označených kampaní.
   *
   * Chyba u jedné kampaně NEZASTAVÍ zbytek: každý řádek je samostatný požadavek
   * a zastavit se v půlce by nechalo výběr v nepoznatelném stavu. Sečte se tedy
   * všechno a teprve výsledek se ohlásí.
   */
  async function deleteSelected(): Promise<{ failed: number; detail: string | null }> {
    const failures: { id: string; detail: string }[] = [];
    for (const row of deletable) {
      const result = await deleteCampaignAction({ workspaceId, campaignId: row.id });
      if (result.status === 'error') {
        failures.push({ id: row.id, detail: result.detail === '' ? result.code : result.detail });
      }
    }

    // Obnova běží vždycky: i při částečném nezdaru se seznam změnil a viset na
    // něm smazané kampaně nesmí.
    router.refresh();

    const done = deletable.length - failures.length;
    if (failures.length === 0) {
      toast.success(t('bulk.deleteDone', { count: done }));
      /*
       * Výběr se ruší jen tady, po ÚSPĚCHU. Zůstávají v něm kampaně, které se
       * mazat ani nepokoušely, protože to jejich stav nedovolí: uživatel si je
       * tak může prohlédnout a rozhodnout, co s nimi. Když ve výběru nic takového
       * nebylo, přijde prázdné pole a pruh zmizí.
       */
      onCompleted(target.filter((row) => !canDeleteCampaign(row.status)).map((row) => row.id));
      return { failed: 0, detail: null };
    }

    const failedIds = new Set(failures.map((failure) => failure.id));
    if (done > 0) {
      toast.error(t('bulk.deletePartial', { done, total: deletable.length }));
      // Ve výběru zůstane jen to, s čím se dá dál něco dělat: kampaně, u kterých
      // mazání selhalo, a ty, které se přeskočily kvůli stavu.
      onCompleted(
        target
          .filter((row) => failedIds.has(row.id) || !canDeleteCampaign(row.status))
          .map((row) => row.id),
      );
    }
    return { failed: failures.length, detail: failures[0]?.detail ?? null };
  }

  return (
    <>
      {/*
       * ŽÁDNÉ ZAŠEDLÉ TLAČÍTKO BEZ VYSVĚTLENÍ (kritérium 18 části 6). Když ve výběru
       * není jediná kampaň, kterou by šlo smazat, nestojí tu vypnuté tlačítko, ale
       * věta, která říká proč. Vypnuté tlačítko by uživatele nechalo hádat, jestli
       * mu chybí právo, nebo je něco rozbité.
       */}
      {deletable.length === 0 ? (
        <span data-testid="campaigns-bulk-nothing" className="text-panel-soft">
          {t('bulk.nothingDeletable')}
        </span>
      ) : (
        // Mazání si plnou barvu nechává, stejně jako u kontaktů: je to jediná akce
        // na pruhu a jde o následek, který nejde vzít zpět.
        <Button
          variant="destructive"
          size="sm"
          className="text-sm shadow-none hover:translate-y-0 hover:shadow-none"
          data-testid="campaigns-bulk-delete"
          onClick={() => setOpen(true)}
        >
          <Trash2 aria-hidden className="icon-sm" />
          {t('bulk.delete', { count: deletable.length })}
        </Button>
      )}

      <BulkDeleteCampaignsDialog
        open={open}
        onOpenChange={setOpen}
        deletable={deletable.length}
        skipped={skipped}
        onConfirm={deleteSelected}
      />
    </>
  );
}
