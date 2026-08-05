'use client';

import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
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
   * Přepočet čísla na kartě. Tentýž kód obsluhuje „Spočítat" u segmentu, který
   * spočítaný nikdy nebyl, i „Přepočítat" u zastaralého: rozdíl je jen v tom,
   * co se na kartě zrovna ukazuje.
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
     * čerstvě přepočtený segment měl razítko novější než `now` a karta hlásila
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
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button variant="primary" onClick={() => router.push(`/w/${workspaceSlug}/segments/new`)}>
          {t('new')}
        </Button>
      </header>

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
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const age = now && row.cachedAt ? hoursSince(row.cachedAt, now) : null;
            /*
             * Přepočet se nabízí i u čísla BEZ ČASU, nejen u starého.
             *
             * V databázi takové řádky jsou (`cached_count` vyplněný, `cached_at`
             * prázdný, například u ukázkových dat) a karta u nich ukazovala číslo,
             * ke kterému se nedalo zjistit stáří ani ho obnovit: „Spočítat" se
             * schová za nenulovým počtem a „Přepočítat" se bez času neukázalo.
             * Číslo bez data přitom vypadá stejně jako spočítané před vteřinou.
             */
            const stale = age === null ? row.cachedCount !== null : age >= STALE_HOURS;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-[var(--radius-surface)] border border-border bg-surface p-4"
              >
                <Link
                  href={`/w/${workspaceSlug}/segments/${row.id}`}
                  className="font-medium text-accent-text underline underline-offset-4"
                >
                  {row.name}
                </Link>
                {row.kind === 'static' ? (
                  <span className="rounded-[var(--radius-control)] bg-surface-muted px-2 py-1 text-xs text-text-muted">
                    {t('freeze.action')}
                  </span>
                ) : null}

                <span className="ml-auto flex flex-wrap items-center gap-3">
                  {row.cachedCount === null ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      pending={counting === row.id}
                      pendingLabel={t('count.counting')}
                      onClick={() => void recount(row.id)}
                    >
                      {t('count.action')}
                    </Button>
                  ) : (
                    <span className="text-sm font-medium text-text">
                      {formatCount(row.cachedCount, locale)}
                    </span>
                  )}

                  {age !== null ? (
                    <span
                      data-stale={stale ? 'true' : 'false'}
                      className={cn('text-sm text-text-muted', stale ? 'opacity-70' : undefined)}
                    >
                      {/* Pod hodinu se stáří neuvádí v hodinách. „Před 0 h" nikdo
                          neřekne a záporná hodnota vznikne pokaždé, když je razítko
                          ze serveru novější než referenční čas v prohlížeči. */}
                      {age < 1 ? t('freshNow') : t('stale', { time: `${age} h` })}
                    </span>
                  ) : null}

                  {stale ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      pending={counting === row.id}
                      pendingLabel={t('count.counting')}
                      onClick={() => void recount(row.id)}
                    >
                      {t('recount')}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
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

      <section className="flex flex-wrap items-center gap-3 rounded-[var(--radius-surface)] border border-border bg-surface-muted p-4">
        <h2 className="text-sm font-medium text-text">{t('presets.orBuild')}</h2>
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => router.push(`/w/${workspaceSlug}/segments/new`)}
        >
          {t('presets.build')}
        </Button>
      </section>
    </section>
  );
}

function cn(...values: (string | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
