'use client';

import { Link, useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Alert, FilteredEmptyState } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormIcon, MailIcon } from '@/lib/ui/status-icons';
import { restoreTemplateAction } from './actions';
import { DeleteTemplateButton, type DeletedTemplate } from './delete-template-button';

/** Zapojení šablony. Prázdná pole znamenají volnou šablonu, ne chybějící data. */
export type TemplateUsage = {
  forms: Array<{ id: string; name: string }>;
  lists: Array<{ id: string; name: string; role: string }>;
};

export type TemplateListItem = {
  id: string;
  name: string;
  /** Kategorii počítá server, ne tahle komponenta: je to pravidlo domény, ne vzhled. */
  category: string;
  usage: TemplateUsage;
};

/** Šablona, kterou někdo živě rozesílá, se nesmí tvářit jako volná předloha. */
function isWired(usage: TemplateUsage): boolean {
  return usage.forms.length > 0 || usage.lists.length > 0;
}

/**
 * Knihovna šablon. Je klientská kvůli JEDINÉ věci, kterou serverová komponenta
 * neumí: po smazání musí na obrazovce zůstat nabídka „Vrátit zpět". Bez ní by
 * bylo smazání z pohledu uživatele nevratné, i když ho server dělá měkce.
 *
 * Nabídka se ukazuje i po příchodu z detailu šablony, kde se maže ta samá
 * šablona a uživatel se pak ocitne tady. Detail proto předá id a jméno
 * v adrese (`?undo=…&undo_name=…`) a knihovna z nich složí týž pruh.
 *
 * FILTR KATEGORIÍ TU NENÍ. Vlastní ho stránka, protože stojí na adrese;
 * knihovna od něj dostane jen zvolenou hodnotu, aby uměla říct, proč je
 * seznam prázdný.
 */
export function TemplateLibrary({
  workspaceSlug,
  workspaceId,
  templates,
  canWrite,
  initialDeleted,
  category,
}: {
  workspaceSlug: string;
  workspaceId: string;
  templates: TemplateListItem[];
  /** Bez `templates:write` se mazat nedá, takže se tlačítko ani nenabízí. */
  canWrite: boolean;
  initialDeleted?: DeletedTemplate | undefined;
  /** Zvolená kategorie, nebo `undefined` pro stav „Vše". */
  category?: string | undefined;
}) {
  const t = useTranslations('editor');
  const router = useRouter();
  const [deleted, setDeleted] = useState<DeletedTemplate | null>(initialDeleted ?? null);
  const [restored, setRestored] = useState<string | null>(null);
  const [undoFailure, setUndoFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function undo(template: DeletedTemplate) {
    setUndoFailure(null);
    startTransition(async () => {
      const result = await restoreTemplateAction({ workspaceId, id: template.id });
      if (result.status === 'error') {
        setUndoFailure(result.code);
        return;
      }
      setDeleted(null);
      setRestored(template.name);
      // Adresa s `?undo=…` se uklidí, jinak by po obnovení stránky nabízela
      // vrácení šablony, která je dávno zpátky.
      router.replace(`/w/${workspaceSlug}/templates`);
      // Seznam se čte na serveru, takže bez obnovy by se vrácená šablona
      // objevila až po ručním načtení stránky.
      router.refresh();
    });
  }

  /** Věty o zapojení. Jedna za každé místo, kde se šablona živě odesílá. */
  function usageLines(usage: TemplateUsage): string[] {
    return [
      ...usage.forms.map((form) => t('list.usage.form', { name: form.name })),
      ...usage.lists.map((list) =>
        list.role === 'welcome'
          ? t('list.usage.listWelcome', { name: list.name })
          : t('list.usage.listConfirmation', { name: list.name }),
      ),
    ];
  }

  const visible = templates.filter((template) => template.id !== deleted?.id);

  return (
    <div className="flex flex-col gap-4">
      {deleted ? (
        <Alert
          tone="info"
          title={t('list.delete.done', { name: deleted.name })}
          data-testid="template-deleted"
          action={
            <Button
              variant="secondary"
              size="sm"
              pending={pending}
              onClick={() => undo(deleted)}
              data-testid="template-undo"
            >
              {t('list.delete.undo')}
            </Button>
          }
        >
          {undoFailure ? (
            <p className="text-danger-text">
              {undoFailure === 'template_name_conflict'
                ? t('list.delete.undoConflict', { name: deleted.name })
                : t('list.delete.undoFailed', { code: undoFailure })}
            </p>
          ) : null}
        </Alert>
      ) : null}

      {restored ? (
        <Alert
          tone="success"
          title={t('list.delete.restored', { name: restored })}
          data-testid="template-restored"
        />
      ) : null}

      {/*
        Prázdno pod zvoleným filtrem je JINÝ stav než prázdná knihovna (S2, ne S1).
        Připomene, čím je seznam zúžený, a nabídne cestu zpátky na všechny
        šablony. Bez toho by uživatel se třemi kampaněmi viděl pod kategorií
        „E-maily z formulářů" nulu a nevěděl proč.
      */}
      {visible.length === 0 && category !== undefined && deleted === null ? (
        <FilteredEmptyState
          title={t('list.category.empty')}
          explanation={t('list.emptyHint')}
          filterDescription={`${t('list.category.legend')}: ${t(`list.category.${category}` as 'list.category.campaign')}`}
          clearFiltersLabel={t('list.category.emptyAction')}
          onClearFilters={() => router.push(`/w/${workspaceSlug}/templates`)}
        />
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/*
          Právě smazaná šablona ze seznamu mizí HNED, ještě než dojde obnova dat
          ze serveru. Bez toho by nad seznamem stálo „Šablona je smazaná" a pod
          ním by ta šablona pár set milisekund dál svítila, což vypadá jako by
          mazání nefungovalo. Vrácení zpět ji přivede zpátky.
        */}
        {visible.map((template) => {
          const lines = usageLines(template.usage);
          return (
            <li
              key={template.id}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
              data-testid="template-item"
              data-category={template.category}
            >
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/w/${workspaceSlug}/templates/${template.id}`}
                  className="font-medium underline"
                >
                  {template.name}
                </Link>
                {/*
                  Zapojenou šablonu nejde smazat, protože formulář i seznam z ní
                  čtou při každém odeslání; server takové mazání odmítne (409
                  `template_in_use`). Tlačítko, které vždycky selže, je horší než
                  žádné, takže na jeho místě stojí důvod. Volná šablona se maže
                  dál beze změny.
                */}
                {canWrite && !isWired(template.usage) ? (
                  <DeleteTemplateButton
                    workspaceId={workspaceId}
                    templateId={template.id}
                    name={template.name}
                    size="sm"
                    onDeleted={(item) => {
                      setRestored(null);
                      setUndoFailure(null);
                      setDeleted(item);
                      router.refresh();
                    }}
                  />
                ) : null}
              </div>

              {/*
                Odznak dostane jen šablona, která NENÍ obyčejná kampaň. Odznak
                na každé položce by nesl nulovou informaci; takhle označuje
                přesně ty, které by si uživatel spletl s volnou předlohou.
              */}
              {template.category === 'campaign' ? null : (
                // Obal kvůli šířce: položka je `flex-col`, takže by se odznak
                // bez něj roztáhl přes celou kartu a vypadal jako pruh.
                <div className="flex flex-wrap gap-2">
                  {template.category === 'form' ? (
                    <Badge tone="accent" icon={FormIcon}>
                      {t('list.category.badgeForm')}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" icon={MailIcon}>
                      {t('list.category.badgeTransactional')}
                    </Badge>
                  )}
                </div>
              )}

              {lines.length > 0 ? (
                <div className="text-sm text-text-muted" data-testid="template-usage">
                  {lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                  {canWrite ? <p>{t('list.usage.locked')}</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
