'use client';

import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { createTemplateAction } from '@/features/templates/actions';

/** Druh, který si uživatel smí zvolit. `system` mezi nimi není a nikdy nebude. */
export type CreatableKind = 'campaign' | 'transactional';

/**
 * Vytvoření šablony je **klientská** akce, ne odkaz na `/templates/new`.
 *
 * Dřívější znění na takovou stránku odkazovalo, jenže ji nezakládá žádný plán,
 * takže by tlačítko v prázdném stavu vedlo na 404. Endpoint `POST /api/v1/templates`
 * existuje a přijímá hotový dokument, takže žádná mezistránka není potřeba:
 * pošle se nejmenší platný dokument a rovnou se otevře editor.
 *
 * `EmptyState` z P05 bere akce jako `{ label, onClick }`, což přes hranici
 * serverové komponenty poslat nejde. Proto je celý prázdný stav tady.
 *
 * ZAKLÁDÁ SE PŘES SERVEROVOU AKCI, ne přes port editoru. Port posílal natvrdo
 * `kind: 'campaign'`, takže transakční e-mail by se z knihovny nedal založit
 * vůbec a filtr kategorií by měl jednu použitelnou hodnotu.
 */
function useCreateTemplate(workspaceSlug: string, workspaceId: string) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('editor');
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const create = (kind: CreatableKind) => {
    setFailed(false);
    startTransition(async () => {
      // Výchozí jméno se liší podle druhu. „Nová šablona" u transakčního
      // e-mailu by v knihovně nepomohla poznat, co to je, a přejmenovat ho
      // uživatel může kdykoli.
      const name = kind === 'transactional' ? t('list.newTransactionalName') : t('list.newName');
      const created = await createTemplateAction({ workspaceId, name, kind, language: locale });
      if (created.status === 'error') {
        setFailed(true);
        return;
      }
      router.push(`/w/${workspaceSlug}/templates/${created.id}`);
    });
  };

  return { create, pending, failed, t };
}

/**
 * Zakládání šablony: DVĚ TLAČÍTKA, ne přepínač vedle jednoho tlačítka.
 *
 * Dřívější znění mělo v hlavičce rozbalovací seznam s druhem šablony. Byl to
 * mrtvý ovládací prvek: uživatel v něm přepnul hodnotu a na obrazovce se
 * nestalo NIC, protože si volbu jen tiše pamatoval do chvíle, než někdo
 * zmáčkne tlačítko vedle. Prvek, který na obsluhu nereaguje, se čte jako
 * rozbitý, a to i tehdy, když pod ním logika funguje.
 *
 * Dvě tlačítka odstraňují mezikrok úplně: každé kliknutí rovnou zakládá
 * a otevírá editor, a druh je napsaný přímo na tlačítku, takže se na nic
 * není potřeba ptát. Zůstává i popisek „Vytvořit šablonu" pro tu obvyklou
 * cestu, tedy kampaň.
 */
export function CreateTemplateButton({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string;
  workspaceId: string;
}) {
  const { create, pending, failed, t } = useCreateTemplate(workspaceSlug, workspaceId);

  return (
    <div className="flex items-center gap-2">
      {failed ? <Alert tone="error" title={t('list.createFailed')} /> : null}
      <Button
        variant="secondary"
        pending={pending}
        pendingLabel={t('header.saving')}
        onClick={() => create('transactional')}
      >
        {t('list.createTransactional')}
      </Button>
      {/* Primární akce nikdy nedostane `disabled` (kritérium 18). Během běhu se
          mění popisek, ne dostupnost. */}
      <Button
        variant="primary"
        pending={pending}
        pendingLabel={t('header.saving')}
        onClick={() => create('campaign')}
      >
        {t('list.create')}
      </Button>
    </div>
  );
}

export function TemplatesEmpty({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string;
  workspaceId: string;
}) {
  const { create, failed, t } = useCreateTemplate(workspaceSlug, workspaceId);
  return (
    <>
      {failed ? <Alert tone="error" title={t('list.createFailed')} /> : null}
      {/*
        Prázdná knihovna nabízí obě kategorie, ale NEPTÁ SE NA NĚ.
        Primární akce zůstává „Vytvořit šablonu" a zakládá kampaň, protože kdo
        tu stojí poprvé, chce e-mail, ne rozhodnutí o taxonomii; druh je pod ní
        napsaný slovy. Transakční e-mail je vedle jako druhá cesta.
      */}
      <EmptyState
        variant="first"
        title={t('list.empty')}
        explanation={t('list.emptyHint')}
        actions={[
          {
            label: t('list.create'),
            onClick: () => create('campaign'),
            description: t('list.createKind.campaign'),
          },
          { label: t('list.createTransactional'), onClick: () => create('transactional') },
        ]}
      />
    </>
  );
}
