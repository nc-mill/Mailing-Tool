'use client';

import { Link, useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { IconButton } from '@mlain/ui/components/icon-button';
import { Alert, FilteredEmptyState } from '@mlain/ui/patterns/states';
import { useFormatter, useTranslations } from 'next-intl';
import { Fragment, useState, useTransition } from 'react';
import { FormIcon, MailIcon, MoreIcon } from '@/lib/ui/status-icons';
import { duplicateTemplateAction, restoreTemplateAction } from './actions';
import {
  TemplateDeleteDialog,
  useDeleteFailureText,
  type DeletedTemplate,
} from './template-delete-dialog';
import {
  DESTRUCTIVE_TEMPLATE_ACTIONS,
  templateRowActions,
  type TemplateRowAction,
  type TemplateUsage,
} from './template-state';

export type { TemplateUsage };

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

/**
 * Sloupce výpisu. Šířky drží rytmus výpisu kampaní z návrhu: název se
 * roztahuje, kategorie má pevný sloupec na odznak, zapojení dostane zbytek,
 * datum je úzké a poslední sloupec je přesně na ikonové tlačítko.
 */
const COLUMNS =
  'grid grid-cols-[minmax(0,1.5fr)_190px_minmax(0,1.3fr)_110px_44px] items-center gap-[var(--spacing-stack)] px-[var(--spacing-row-x)]';

/**
 * Nabídka „…" v řádku knihovny, tvarem shodná s kontakty, kampaněmi i segmenty.
 *
 * Do 6. 8. 2026 tu stála jediná ikona koše, takže se ze šablony nedalo udělat
 * nic než ji smazat, a to jen u nezapojené. Kopie hotové šablony odsud dostupná
 * nebyla vůbec, přestože `POST /templates/{id}/duplicate` v jádru existuje.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, ne zašedle. Rozhoduje `templateRowActions`
 * ve sdíleném `template-state.ts`.
 *
 * Okno mazání kreslí knihovna, ne tahle komponenta: obsah rozbalené nabídky se
 * při volbě položky odpojí z DOM a odnesl by okno s sebou dřív, než by se
 * ukázalo.
 */
function TemplateRowMenu({
  template,
  canWrite,
  onAction,
}: {
  template: TemplateListItem;
  canWrite: boolean;
  onAction: (action: TemplateRowAction, template: TemplateListItem) => void;
}) {
  const t = useTranslations('editor');
  const actions = templateRowActions(template, { write: canWrite });

  // Čtenář nemá v nabídce nic, takže se nekreslí ani spouštěč. Prázdná nabídka
  // je horší než žádná: slibuje akce, které nemá.
  if (actions.length === 0) return null;

  const firstDestructive = actions.findIndex((action) =>
    DESTRUCTIVE_TEMPLATE_ACTIONS.includes(action),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="row"
          label={t('list.rowMenu', { name: template.name })}
          data-testid={`template-row-menu-${template.id}`}
          icon={MoreIcon}
          /*
           * ČTVEREC JE 34 PX, KLIKACÍ PLOCHA 44 PX, stejně jako u kontaktů.
           * Tlačítko o straně 44 px by řádek natáhlo a rozešlo by se s rytmem
           * ostatních výpisů; plochu proto roztahuje neviditelný překryv.
           */
          className="relative after:absolute after:top-1/2 after:left-1/2 after:size-[var(--size-target-min)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action, index) => (
          <Fragment key={action}>
            {index === firstDestructive ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              {...(DESTRUCTIVE_TEMPLATE_ACTIONS.includes(action)
                ? ({ tone: 'danger' } as const)
                : {})}
              onSelect={() => onAction(action, template)}
            >
              {t(`list.rowActions.${action}`)}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  /*
   * Šablona, nad kterou je otevřené okno mazání. Drží ji knihovna, ne řádek:
   * obsah rozbalené nabídky se při volbě položky odpojí z DOM i s oknem.
   */
  const [deleting, setDeleting] = useState<TemplateListItem | null>(null);
  const [pending, startTransition] = useTransition();
  const failureText = useDeleteFailureText();

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

  /**
   * Kopie šablony. Odchází se ROVNOU DO KOPIE, ne zpátky do výpisu.
   *
   * Kopie se jmenuje „… (kopie)" a mezi ostatními řádky ji nic neoznačuje; kdo
   * duplikoval hotovou šablonu, ji navíc chce hned upravit. Přechod je tedy
   * zpětná vazba i další krok naráz, stejně jako u kampaní.
   */
  function duplicate(template: TemplateListItem) {
    setDeleteFailure(null);
    startTransition(async () => {
      const result = await duplicateTemplateAction({ workspaceId, id: template.id });
      if (result.status === 'error') {
        // Týž pruh nad výpisem jako u odmítnutého mazání: v řádku pro celou
        // větu místo není.
        setDeleteFailure(t('list.duplicate.failed', { code: result.code }));
        return;
      }
      router.push(`/w/${workspaceSlug}/templates/${result.id}`);
    });
  }

  /** Volba z řádkové nabídky. Vratné akce běží rovnou, mazání otevře okno. */
  function onRowAction(action: TemplateRowAction, template: TemplateListItem) {
    switch (action) {
      case 'edit':
        router.push(`/w/${workspaceSlug}/templates/${template.id}`);
        return;
      case 'duplicate':
        duplicate(template);
        return;
      case 'delete':
        setDeleting(template);
        return;
    }
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
                      `template_in_use`). Položka, která vždycky selže, je horší než
                      žádná, takže se u takového řádku v nabídce vůbec neukáže
                      a důvod stojí ve sloupci „Zapojení" vedle. Úprava a kopie
                      v nabídce zůstávají: obojí je u živě rozesílané předlohy
                      právě to, co člověk potřebuje.
                    */}
                    <span className="flex justify-end">
                      <TemplateRowMenu
                        template={template}
                        canWrite={canWrite}
                        onAction={onRowAction}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {deleting !== null && (
        <TemplateDeleteDialog
          // `key` zařídí, že okno otevřené nad jinou šablonou začíná načisto.
          key={deleting.id}
          workspaceId={workspaceId}
          templateId={deleting.id}
          name={deleting.name}
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onFailed={(code) => setDeleteFailure(failureText(code))}
          onDeleted={(item) => {
            setRestored(null);
            setUndoFailure(null);
            setDeleteFailure(null);
            setDeleted(item);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
