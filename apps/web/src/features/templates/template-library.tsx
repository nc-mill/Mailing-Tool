'use client';

import { Link, useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { Alert, FilteredEmptyState } from '@mlain/ui/patterns/states';
import { useFormatter, useTranslations } from 'next-intl';
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
  /**
   * Kdy se šablona naposledy změnila (ISO 8601 ze serveru). Knihovna je podle
   * toho seřazená, takže sloupec vysvětluje pořadí řádků. Chodí i v úsporné
   * podobě odpovědi, protože z něj stojí kurzor stránkování.
   */
  updated_at: string;
};

/** Šablona, kterou někdo živě rozesílá, se nesmí tvářit jako volná předloha. */
function isWired(usage: TemplateUsage): boolean {
  return usage.forms.length > 0 || usage.lists.length > 0;
}

/**
 * Sloupce výpisu. Šířky drží rytmus výpisu kampaní z návrhu: název se
 * roztahuje, kategorie má pevný sloupec na odznak, zapojení dostane zbytek,
 * datum je úzké a poslední sloupec je přesně na ikonové tlačítko.
 */
const COLUMNS =
  'grid grid-cols-[minmax(0,1.5fr)_190px_minmax(0,1.3fr)_110px_44px] items-center gap-[var(--spacing-stack)] px-[var(--spacing-row-x)]';

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
 *
 * VZHLED je odvozený z výpisu kampaní v návrhu, ne z mřížky karet: knihovna je
 * seznam pojmenovaných věcí, a každý takový seznam v systému je JEDNA karta bez
 * vnitřního okraje, uvnitř hlavička na tlumené ploše a řádky oddělené hairline
 * linkou. Mřížka karet by na tuhle obrazovku zavedla vizuální jazyk, který
 * jinde v aplikaci není.
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
  const format = useFormatter();
  const router = useRouter();
  const [deleted, setDeleted] = useState<DeletedTemplate | null>(initialDeleted ?? null);
  const [restored, setRestored] = useState<string | null>(null);
  const [undoFailure, setUndoFailure] = useState<string | null>(null);
  /** Důvod odmítnutého smazání. Vykresluje se nad výpisem, viz `onFailed`. */
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null);
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
    <div className="flex min-w-0 flex-col gap-[var(--spacing-gutter)]">
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

      {deleteFailure ? (
        <Alert tone="error" title={deleteFailure} data-testid="template-delete-failed" />
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

      {visible.length === 0 ? null : (
        <Card padding="none" gap="none">
          {/* Užší okno seznam nezalamuje, posouvá ho: sloupce mají smysl jen vedle sebe. */}
          <div className="overflow-x-auto rounded-t-[var(--radius-surface)]">
            <div className="min-w-[900px]">
              <div
                className={`${COLUMNS} rounded-t-[var(--radius-surface)] border-b border-border bg-surface-muted py-3`}
              >
                <span className="meta-caps text-text-muted">{t('list.columns.name')}</span>
                <span className="meta-caps text-text-muted">{t('list.columns.category')}</span>
                <span className="meta-caps text-text-muted">{t('list.columns.usage')}</span>
                <span className="meta-caps text-text-muted">{t('list.columns.changed')}</span>
                <span />
              </div>

              {/*
                Právě smazaná šablona ze seznamu mizí HNED, ještě než dojde obnova dat
                ze serveru. Bez toho by nad seznamem stálo „Šablona je smazaná" a pod
                ním by ta šablona pár set milisekund dál svítila, což vypadá jako by
                mazání nefungovalo. Vrácení zpět ji přivede zpátky.
              */}
              {visible.map((template) => {
                const lines = usageLines(template.usage);
                return (
                  <div
                    key={template.id}
                    className={`${COLUMNS} border-b border-border py-[var(--spacing-row-y)] last:border-b-0 hover:bg-surface-muted`}
                    data-testid="template-item"
                    data-category={template.category}
                  >
                    <Link
                      href={`/w/${workspaceSlug}/templates/${template.id}`}
                      className="justify-self-start text-base font-semibold text-text no-underline hover:underline"
                    >
                      {template.name}
                    </Link>

                    {/*
                      Odznak dostane jen šablona, která NENÍ obyčejná kampaň. Odznak
                      na každé položce by nesl nulovou informaci; takhle označuje
                      přesně ty, které by si uživatel spletl s volnou předlohou.
                      Prázdná buňka je tedy odpověď „nic zvláštního", ne chybějící údaj.
                    */}
                    <span>
                      {template.category === 'campaign' ? null : template.category === 'form' ? (
                        <Badge tone="accent" icon={FormIcon}>
                          {t('list.category.badgeForm')}
                        </Badge>
                      ) : (
                        <Badge tone="neutral" icon={MailIcon}>
                          {t('list.category.badgeTransactional')}
                        </Badge>
                      )}
                    </span>

                    <span className="grid gap-0.5">
                      {lines.length === 0 ? null : (
                        <>
                          {lines.map((line) => (
                            <span key={line} className="text-sm text-text">
                              {line}
                            </span>
                          ))}
                          {/*
                            Věta o zámku je meta údaj k řádku, ne další zapojení,
                            takže je mono a tišší. Bez práva na zápis nedává smysl:
                            tomu, kdo mazat nesmí, se nevysvětluje, proč zrovna tohle
                            smazat nejde.
                          */}
                          {canWrite ? (
                            <span className="font-mono text-label text-text-muted">
                              {t('list.usage.locked')}
                            </span>
                          ) : null}
                        </>
                      )}
                    </span>

                    {/*
                      Datum poslední změny. Je mono, protože se čte po číslicích,
                      a vysvětluje pořadí řádků: knihovna je seřazená od naposledy
                      upravené. Bez něj má obyčejná kampaňová šablona v řádku jen
                      jméno a tři prázdné buňky.
                    */}
                    <span className="font-mono text-meta text-text-muted">
                      {format.dateTime(new Date(template.updated_at), 'short')}
                    </span>

                    {/*
                      Zapojenou šablonu nejde smazat, protože formulář i seznam z ní
                      čtou při každém odeslání; server takové mazání odmítne (409
                      `template_in_use`). Tlačítko, které vždycky selže, je horší než
                      žádné, takže na jeho místě stojí důvod ve sloupci vedle.
                      Volná šablona se maže dál beze změny.
                    */}
                    <span className="justify-self-center">
                      {canWrite && !isWired(template.usage) ? (
                        <DeleteTemplateButton
                          workspaceId={workspaceId}
                          templateId={template.id}
                          name={template.name}
                          appearance="icon"
                          onFailed={(message) => setDeleteFailure(message)}
                          onDeleted={(item) => {
                            setRestored(null);
                            setUndoFailure(null);
                            setDeleteFailure(null);
                            setDeleted(item);
                            router.refresh();
                          }}
                        />
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
