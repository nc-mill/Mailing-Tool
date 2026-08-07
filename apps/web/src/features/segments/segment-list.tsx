'use client';

import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { IconButton } from '@mlain/ui/components/icon-button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Plus } from '@mlain/ui/icons';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useState } from 'react';
import { MoreIcon } from '@/lib/ui/status-icons';
import {
  createSegmentFromPresetAction,
  deleteSegmentAction,
  recountSegmentAction,
} from './actions';
import { DeleteSegmentDialog } from './delete-segment-dialog';
import { formatCount, hoursSince } from './labels';
import { PresetGrid, type PresetCardData } from './preset-card';
import {
  DESTRUCTIVE_SEGMENT_ACTIONS,
  segmentContactsHref,
  segmentRowActions,
  type SegmentPermissions,
  type SegmentRowAction,
} from './segment-state';

export type SegmentListRow = {
  id: string;
  name: string;
  kind: 'dynamic' | 'static';
  cachedCount: number | null;
  cachedAt: string | null;
};

/** Nad šest hodin se počet nesmí tvářit čerstvě. */
const STALE_HOURS = 6;

/**
 * Sloupce tabulky segmentů. Šířky jsou z návrhu: název se roztahuje, počet je
 * úzký a zarovnaný doprava, čas přepočtu má pevných 190 px a poslední sloupec
 * je přesně na ikonové tlačítko.
 *
 * POD 768 px JE SLOUPEC JEDINÝ a řádek se kreslí jako KARTA, stejně jako
 * v `DataTable`. Čtyři sloupce mají dohromady 304 px pevné šířky plus tři
 * mezery, takže se tabulka nevešla do 343 px rámu a rolovala vodorovně uvnitř
 * stránky, která roluje svisle (naměřeno 7. 8. 2026: rám 343 px, obsah 720 px).
 *
 * Tvar karty je závazný a stejný napříč aplikací: **název má celý první řádek
 * sám pro sebe** a zalomí se, místo aby se uřízl; pod ním jsou doplňkové údaje
 * jako dvojice popisek a hodnota; **nabídka „…" je v pravém horním rohu**, mimo
 * tok, aby vedle názvu nestála; **prázdná hodnota se nekreslí vůbec**, takže
 * segment bez času přepočtu na kartě nedrží prázdný řádek.
 */
const COLUMNS =
  'grid grid-cols-1 items-start gap-y-1 px-[var(--spacing-row-x)] md:grid-cols-[minmax(0,1fr)_70px_190px_44px] md:items-center md:gap-[var(--spacing-stack)]';

/**
 * Nabídka „…" v řádku segmentu, tvarem shodná s kontakty a kampaněmi.
 *
 * Do 6. 8. 2026 tu byla nabídka s JEDINOU položkou (přepočet), takže se ze
 * seznamu nedalo přejít na kontakty, které do segmentu spadají, ani segment
 * upravit, a smazat ho nešlo z aplikace vůbec: `DELETE /api/v1/segments/{id}`
 * existoval bez volajícího.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, ne zašedle. Rozhodnutí dělá `segmentRowActions`
 * ve sdíleném `segment-state.ts`, takže se dá zkoušet bez Reactu.
 *
 * Okno mazání kreslí obrazovka, ne tahle komponenta: obsah rozbalené nabídky se
 * při volbě položky odpojí z DOM a odnesl by okno s sebou dřív, než by se
 * ukázalo. Je to týž důvod, jaký mají u sebe napsané kontakty i kampaně.
 */
function SegmentRowMenu({
  row,
  permissions,
  onAction,
}: {
  row: SegmentListRow;
  permissions: SegmentPermissions;
  /*
   * Kam která akce vede, rozhoduje obal, ne nabídka. Adresu kontaktů i stavitele
   * skládá `onRowAction` ze `segmentContactsHref`, takže tahle komponenta
   * nepotřebuje znát ani projekt.
   */
  onAction: (action: SegmentRowAction, row: SegmentListRow) => void;
}) {
  const t = useTranslations('segments');
  const actions = segmentRowActions(permissions);

  // Segment, se kterým se z řádku nedá udělat nic (čtenář bez práva na kontakty),
  // nemá ani spouštěč. Prázdná nabídka je horší než žádná.
  if (actions.length === 0) return null;

  /*
   * Oddělovač stojí PŘED PRVNÍ rušivou akcí, ne před každou z nich, stejně jako
   * u kampaní.
   */
  const firstDestructive = actions.findIndex((action) =>
    DESTRUCTIVE_SEGMENT_ACTIONS.includes(action),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="row"
          label={t('rowMenu', { name: row.name })}
          data-testid={`segment-row-menu-${row.id}`}
          icon={MoreIcon}
          /*
           * ČTVEREC JE 34 PX, KLIKACÍ PLOCHA 44 PX, stejně jako u kontaktů.
           * Tlačítko o straně 44 px by řádek natáhlo a rozešlo by se s rytmem
           * ostatních tabulek; plochu proto roztahuje neviditelný překryv.
           */
          className="relative after:absolute after:top-1/2 after:left-1/2 after:size-[var(--size-target-min)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action, index) => (
          <Fragment key={action}>
            {index === firstDestructive ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              {...(DESTRUCTIVE_SEGMENT_ACTIONS.includes(action)
                ? ({ tone: 'danger' } as const)
                : {})}
              onSelect={() => onAction(action, row)}
            >
              {/* Přepočet se u nikdy nepočítaného segmentu jmenuje „Spočítat":
                  „Přepočítat" slibuje, že tu nějaké číslo bylo. */}
              {action === 'recount' && row.cachedCount === null
                ? t('count.action')
                : t(`rowActions.${action}`)}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Seznam segmentů a karty presetů. Stáří počtu se počítá až na klientu. */
export function SegmentList({
  rows,
  presets,
  workspaceSlug,
  workspaceId,
  permissions,
  locale = 'cs',
}: {
  rows: SegmentListRow[];
  presets: PresetCardData[];
  workspaceSlug: string;
  /** Projekt pro přepočet. Bez něj běží požadavek mimo kontext a RLS vrátí 404. */
  workspaceId: string;
  /**
   * Práva přihlášeného člověka. Počítá je stránka přes `hasPermission`; klientská
   * komponenta se na role ptát nemá a ani nemá kde. Povinné schválně: výchozí
   * „všechno smí" by čtenáři nabídlo akce, které server odmítne se 403.
   */
  permissions: SegmentPermissions;
  locale?: string;
}) {
  const t = useTranslations('segments');
  const router = useRouter();
  const toast = useToast();
  /** Segment, který se právě počítá. Přepočet běží na serveru synchronně. */
  const [counting, setCounting] = useState<string | null>(null);
  /** Otevřený preset a jméno, pod kterým se má založit. */
  const [usingPreset, setUsingPreset] = useState<{ key: string; name: string } | null>(null);
  const [presetName, setPresetName] = useState('');
  const [presetPending, setPresetPending] = useState(false);
  const [presetFailed, setPresetFailed] = useState<string | null>(null);
  /*
   * Okno mazání drží obrazovka, ne řádek: obsah rozbalené nabídky se při volbě
   * položky odpojí z DOM i s oknem, které by v něm bydlelo.
   */
  const [deleting, setDeleting] = useState<SegmentListRow | null>(null);

  /**
   * Aktuální čas se čte až po připojení. Stáří počtu na něm závisí, server ho
   * nemá, a spočítané při vykreslení by vyrobilo nesoulad hydratace, který
   * React neopraví.
   */
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  /**
   * Přepočet čísla v řádku. Tentýž kód obsluhuje „Spočítat" u segmentu, který
   * spočítaný nikdy nebyl, i „Přepočítat" u zastaralého: rozdíl je jen v tom,
   * co se v řádku zrovna ukazuje.
   */
  async function recount(id: string) {
    setCounting(id);
    const result = await recountSegmentAction({ workspaceId, id });
    setCounting(null);
    if (result.status !== 'success') {
      toast.error(t('count.failedDetail', { detail: result.code }));
      return;
    }
    /*
     * Referenční čas se posune spolu s daty.
     *
     * `now` se do téhle chvíle nastavoval JEDNOU při připojení komponenty, takže
     * čerstvě přepočtený segment měl razítko novější než `now` a řádek hlásil
     * „Aktualizováno před -1 h". Naměřeno v prohlížeči hned po prvním kliknutí.
     */
    setNow(new Date());
    // Číslo i čas poslední aktualizace přijdou ze serveru, ne z odpovědi akce:
    // stránka je čte z `GET /segments` a jinak by se rozešly.
    router.refresh();
  }

  /** Volba z řádkové nabídky. Vratné akce běží rovnou, mazání otevře okno. */
  function onRowAction(action: SegmentRowAction, row: SegmentListRow) {
    switch (action) {
      case 'recount':
        void recount(row.id);
        return;
      case 'viewContacts':
        router.push(segmentContactsHref(workspaceSlug, row.id));
        return;
      case 'edit':
        router.push(`/w/${workspaceSlug}/segments/${row.id}`);
        return;
      case 'delete':
        setDeleting(row);
        return;
    }
  }

  /**
   * Založení segmentu z presetu. Jméno se předvyplní názvem presetu a jde přepsat:
   * segment je od téhle chvíle uživatelův, ne kopie s cizím jménem.
   */
  async function submitPreset() {
    if (usingPreset === null) return;
    const name = presetName.trim();
    if (name === '') return;
    setPresetPending(true);
    setPresetFailed(null);
    const result = await createSegmentFromPresetAction({
      workspaceId,
      key: usingPreset.key,
      name,
    });
    setPresetPending(false);
    if (result.status !== 'success') {
      setPresetFailed(t('presets.useFailed', { detail: result.code }));
      return;
    }
    setUsingPreset(null);
    // Rovnou na detail nového segmentu: uživatel má vidět, co vzniklo, a upravit
    // si podmínku, ne hledat nový řádek v seznamu.
    router.push(`/w/${workspaceSlug}/segments/${result.id}`);
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        // Věta pod nadpisem říká, co segment JE. Bez ní si ho lidé pletou se
        // seznamem, do kterého se kontakty přidávají ručně.
        description={t('intro')}
        actions={
          <Button variant="primary" onClick={() => router.push(`/w/${workspaceSlug}/segments/new`)}>
            <Plus aria-hidden className="icon-md" />
            {t('new')}
          </Button>
        }
      />

      <div className="flex min-w-0 flex-col gap-[var(--spacing-section)]">
        {rows.length === 0 ? (
          <EmptyState
            variant="first"
            title={t('emptyTitle')}
            explanation={t('emptyList')}
            actions={[
              {
                label: t('presets.build'),
                onClick: () => router.push(`/w/${workspaceSlug}/segments/new`),
              },
            ]}
          />
        ) : (
          <Card padding="none" gap="none">
            <div className="overflow-x-auto rounded-t-[var(--radius-surface)]">
              {/* Minimální šířka platí až od 768 px. Pod ní je řádek dvousloupcový
                  a do stránky se vejde, takže by ho 720 px jen vytlačilo ven. */}
              <div className="min-w-0 md:min-w-[720px]">
                {/* Hlavička sloupců na úzkém displeji NENÍ: řádek se tam láme na
                    dva, takže by názvy nestály nad ničím a jen by zabraly dva
                    řádky verzálek. Hodnoty v řádku nesou význam samy (počet je
                    číslo u názvu, čas přepočtu je celá věta). */}
                <div
                  className={`${COLUMNS} max-md:hidden rounded-t-[var(--radius-surface)] border-b border-border bg-surface-muted py-3`}
                >
                  <span className="meta-caps text-text-muted">{t('columns.name')}</span>
                  <span className="meta-caps text-right text-text-muted">{t('columns.count')}</span>
                  <span className="meta-caps text-text-muted">{t('columns.recounted')}</span>
                  <span />
                </div>

                {rows.map((row) => {
                  const age = now && row.cachedAt ? hoursSince(row.cachedAt, now) : null;
                  /*
                   * Přepočet se nabízí i u čísla BEZ ČASU, nejen u starého.
                   *
                   * V databázi takové řádky jsou (`cached_count` vyplněný, `cached_at`
                   * prázdný, například u ukázkových dat) a řádek u nich ukazoval číslo,
                   * ke kterému se nedalo zjistit stáří ani ho obnovit. Číslo bez data
                   * přitom vypadá stejně jako spočítané před vteřinou.
                   */
                  const stale = age === null ? row.cachedCount !== null : age >= STALE_HOURS;
                  return (
                    <div
                      key={row.id}
                      className={cn(
                        COLUMNS,
                        'border-b border-border py-4 last:border-b-0 hover:bg-surface-muted',
                        // KARTA POD 768 px: místo pro nabídku v pravém horním rohu.
                        'max-md:relative max-md:pr-[calc(var(--size-target-min)+var(--spacing-inline))]',
                      )}
                    >
                      <Link
                        href={`/w/${workspaceSlug}/segments/${row.id}`}
                        className={cn(
                          'justify-self-start text-base font-semibold text-text no-underline hover:underline',
                          // Název má na kartě CELÝ PRVNÍ ŘÁDEK sám pro sebe,
                          // zalomí se a neuřízne, a nese klikací plochu 44 px.
                          'max-md:flex max-md:min-h-[var(--size-target-min)] max-md:items-center',
                          'max-md:[overflow-wrap:anywhere]',
                        )}
                      >
                        {row.name}
                      </Link>

                      {row.cachedCount === null ? (
                        // Nikdy nepočítaný segment ukazuje „Spočítat", nikdy nulu.
                        // Nula je odpověď, kterou jsme nedali.
                        <Button
                          variant="link"
                          size="sm"
                          className="justify-self-end max-md:justify-self-start"
                          pending={counting === row.id}
                          pendingLabel={t('count.counting')}
                          onClick={() => void recount(row.id)}
                        >
                          {t('count.action')}
                        </Button>
                      ) : (
                        <span className="text-right font-mono text-ui text-text max-md:flex max-md:items-baseline max-md:gap-2 max-md:text-left">
                          {/* Popisek se na kartě vypisuje u hodnoty: bez hlavičky
                              tabulky by u čísla nebylo poznat, co znamená. */}
                          <span
                            aria-hidden
                            className="meta-caps hidden text-text-muted max-md:inline"
                          >
                            {t('columns.count')}
                          </span>
                          {formatCount(row.cachedCount, locale)}
                        </span>
                      )}

                      <span
                        data-stale={stale ? 'true' : 'false'}
                        className={cn(
                          'font-mono text-label text-text-muted',
                          // Segment bez času přepočtu nemá co ukázat, takže
                          // na kartě nezabere ani řádek.
                          age === null ? 'max-md:hidden' : '',
                          stale ? 'opacity-70' : undefined,
                        )}
                      >
                        {/* Pod hodinu se stáří neuvádí v hodinách. „Před 0 h" nikdo
                            neřekne a záporná hodnota vznikne pokaždé, když je razítko
                            ze serveru novější než referenční čas v prohlížeči. */}
                        {age === null
                          ? ''
                          : age < 1
                            ? t('freshNow')
                            : t('stale', { time: `${age} h` })}
                      </span>

                      {/*
                       * Přepočet bydlí v nabídce „…", jak ji kreslí návrh. Není to
                       * ozdoba: bez něj se u zastaralého čísla nedá udělat nic,
                       * a to je přesně chvíle, kdy ho člověk potřebuje nejvíc.
                       */}
                      <span className="flex justify-end max-md:absolute max-md:top-[var(--spacing-inline)] max-md:right-[var(--spacing-inline)]">
                        <SegmentRowMenu
                          row={row}
                          permissions={permissions}
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

        {/* `onRecount` se schválně NEPŘEDÁVÁ, viz poznámka u `PresetGrid`: počet
            presetu bez uloženého segmentu se z rozhraní spočítat nedá. */}
        <PresetGrid
          presets={presets}
          locale={locale}
          onUse={({ preset_key }) => {
            const preset = presets.find((candidate) => candidate.key === preset_key);
            setPresetFailed(null);
            setPresetName(preset ? t(preset.labelKey) : preset_key);
            setUsingPreset({ key: preset_key, name: preset ? t(preset.labelKey) : preset_key });
          }}
        />

        <Card
          as="div"
          tone="muted"
          padding="none"
          gap="none"
          className="flex-row flex-wrap items-center gap-[var(--spacing-gutter)] px-[var(--spacing-card)] py-[var(--spacing-card-tight)]"
        >
          <div className="grid gap-1">
            <p className="text-base font-semibold text-text">{t('presets.orBuild')}</p>
            <p className="text-meta text-text-muted">{t('presets.orBuildHint')}</p>
          </div>
          <Button
            variant="secondary"
            className="ml-auto"
            onClick={() => router.push(`/w/${workspaceSlug}/segments/new`)}
          >
            {t('presets.build')}
          </Button>
        </Card>
      </div>

      {deleting !== null && (
        <DeleteSegmentDialog
          // `key` zařídí, že okno otevřené nad jiným segmentem začíná načisto.
          key={deleting.id}
          segment={{ name: deleting.name, kind: deleting.kind }}
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onConfirm={async () => {
            const result = await deleteSegmentAction({ workspaceId, id: deleting.id });
            // Obnova až po úspěchu. Kdyby běžela vždycky, přebila by chybovou
            // hlášku v okně novým vykreslením a uživatel by ji nepřečetl.
            if (result.status === 'success') router.refresh();
            return result;
          }}
        />
      )}

      <Dialog
        open={usingPreset !== null}
        onOpenChange={(open) => (open ? undefined : setUsingPreset(null))}
      >
        <DialogTitle>{t('presets.useTitle', { preset: usingPreset?.name ?? '' })}</DialogTitle>
        <DialogBody>
          <p className="text-text-muted">{t('presets.useBody')}</p>
          <div>
            <Label htmlFor="preset-name">{t('presets.useName')}</Label>
            <Input
              id="preset-name"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </div>
          {presetFailed === null ? null : <Alert tone="error" title={presetFailed} />}
        </DialogBody>
        <DialogFooter
          retreat={<Button onClick={() => setUsingPreset(null)}>{t('presets.useCancel')}</Button>}
          confirm={
            <Button
              variant="primary"
              pending={presetPending}
              {...(presetName.trim() === '' ? { unavailableReason: t('presets.nameMissing') } : {})}
              onClick={() => void submitPreset()}
            >
              {t('presets.useConfirm')}
            </Button>
          }
        />
      </Dialog>
    </>
  );
}

function cn(...values: (string | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
