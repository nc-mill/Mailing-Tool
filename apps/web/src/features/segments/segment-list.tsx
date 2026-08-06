'use client';

import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { IconButton } from '@mlain/ui/components/icon-button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Ellipsis, Plus, RefreshCw } from '@mlain/ui/icons';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { createSegmentFromPresetAction, recountSegmentAction } from './actions';
import { formatCount, hoursSince } from './labels';
import { PresetGrid, type PresetCardData } from './preset-card';

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
 */
const COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_70px_190px_44px] items-center gap-[var(--spacing-stack)] px-[var(--spacing-row-x)]';

/** Seznam segmentů a karty presetů. Stáří počtu se počítá až na klientu. */
export function SegmentList({
  rows,
  presets,
  workspaceSlug,
  workspaceId,
  locale = 'cs',
}: {
  rows: SegmentListRow[];
  presets: PresetCardData[];
  workspaceSlug: string;
  /** Projekt pro přepočet. Bez něj běží požadavek mimo kontext a RLS vrátí 404. */
  workspaceId: string;
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
              <div className="min-w-[720px]">
                <div
                  className={`${COLUMNS} rounded-t-[var(--radius-surface)] border-b border-border bg-surface-muted py-3`}
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
                      className={`${COLUMNS} border-b border-border py-4 last:border-b-0 hover:bg-surface-muted`}
                    >
                      <Link
                        href={`/w/${workspaceSlug}/segments/${row.id}`}
                        className="justify-self-start text-base font-semibold text-text no-underline hover:underline"
                      >
                        {row.name}
                      </Link>

                      {row.cachedCount === null ? (
                        // Nikdy nepočítaný segment ukazuje „Spočítat", nikdy nulu.
                        // Nula je odpověď, kterou jsme nedali.
                        <Button
                          variant="link"
                          size="sm"
                          className="justify-self-end"
                          pending={counting === row.id}
                          pendingLabel={t('count.counting')}
                          onClick={() => void recount(row.id)}
                        >
                          {t('count.action')}
                        </Button>
                      ) : (
                        <span className="text-right font-mono text-ui text-text">
                          {formatCount(row.cachedCount, locale)}
                        </span>
                      )}

                      <span
                        data-stale={stale ? 'true' : 'false'}
                        className={cn(
                          'font-mono text-label text-text-muted',
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
                       * Přepočet bydlí v nabídce „Další akce", jak ji kreslí návrh.
                       * Není to ozdoba: bez něj se u zastaralého čísla nedá udělat
                       * nic, a to je přesně chvíle, kdy ho člověk potřebuje nejvíc.
                       */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            variant="ghost"
                            size="row"
                            label={t('rowActions')}
                            icon={<Ellipsis aria-hidden className="icon-md" />}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => void recount(row.id)}>
                            <RefreshCw aria-hidden className="icon-sm" />
                            {row.cachedCount === null ? t('count.action') : t('recount')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
