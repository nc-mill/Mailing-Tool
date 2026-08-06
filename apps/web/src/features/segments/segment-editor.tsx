'use client';

import type { FieldDefinition, SegmentAst } from '@mlain/ui/patterns/query-builder';
import { Link } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { PageHeader } from '@mlain/ui/components/page-header';
import { ChevronRight, Save } from '@mlain/ui/icons';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { LiveCount } from './live-count';
import { SegmentBuilder } from './segment-builder';

const EMPTY: SegmentAst = { version: 1, root: { type: 'group', op: 'and', children: [] } };

export function SegmentEditor({
  workspaceId,
  workspaceSlug,
  locale = 'cs',
  segment,
  draft,
  totalContacts,
  fields = [],
}: {
  workspaceId: string;
  workspaceSlug: string;
  locale?: string;
  segment: { id: string; name: string; definition: unknown } | null;
  /**
   * Předvyplněný NOVÝ segment: název i podmínky přicházejí hotové, uživatel je
   * jen zkontroluje a uloží.
   *
   * Je to vlastní vstup, ne `segment` bez `id`, protože se liší tím, co se
   * stane při uložení: `segment` se opravuje přes PATCH, `draft` teprve vzniká
   * přes POST. Kdyby to bylo jedno pole, rozhodovalo by se o metodě podle toho,
   * jestli je v něm `id`, a první překlep by z předvyplněného návrhu udělal
   * úpravu cizího segmentu.
   *
   * Odsud přicházejí odkazy „Vytvořit segment z těch, kdo klikli" v reportu
   * kampaně. Dřív vedly na prázdný stavitel a podmínku si musel uživatel
   * naklikat sám, přestože ji produkt uměl složit.
   */
  draft?:
    | {
        name: string;
        definition: SegmentAst;
        /**
         * Věty nad staviteli. Skládá je serverová komponenta, protože závisí
         * na tom, ODKUD návrh přišel; stavitel sám o kampaních nic neví.
         */
        notices: string[];
      }
    | undefined;
  totalContacts?: number;
  /** Katalog polí skládá serverová komponenta, viz `field-catalog.ts`. */
  fields?: FieldDefinition[];
}) {
  const t = useTranslations('segments');
  const [name, setName] = useState(segment?.name ?? draft?.name ?? '');
  const [ast, setAst] = useState<SegmentAst>(
    (segment?.definition as SegmentAst) ?? draft?.definition ?? EMPTY,
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const body = JSON.stringify({ name, definition: ast });
    const headers = { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId };
    const res =
      segment === null
        ? await fetch('/api/v1/segments', { method: 'POST', headers, body })
        : await fetch(`/api/v1/segments/${segment.id}`, { method: 'PATCH', headers, body });
    setSaving(false);
    if (res.ok) window.location.assign(`/w/${workspaceSlug}/segments`);
  }

  const title = segment === null ? t('new') : segment.name;

  return (
    <>
      <PageHeader
        breadcrumbs={
          <nav aria-label={t('title')} className="flex flex-wrap items-center gap-2 [&_a]:text-sm">
            <Link href={`/w/${workspaceSlug}/segments`}>{t('title')}</Link>
            <ChevronRight aria-hidden className="icon-xs text-border-strong" />
            <span className="font-mono text-meta text-text-muted">{title}</span>
          </nav>
        }
        title={title}
        // Návrh má pod nadpisem editoru 8 px, ne pět: meta řádek tu není holý
        // souhrn čísel, ale věta o stavu segmentu.
        titleGap="md"
        {...(segment === null ? { meta: t('builder.newMeta') } : {})}
        actions={
          <>
            {/* Ústup je odkaz, ne tlačítko: nemá soupeřit s uložením. */}
            <Button
              variant="link"
              onClick={() => window.location.assign(`/w/${workspaceSlug}/segments`)}
            >
              {t('builder.cancel')}
            </Button>
            <Button variant="primary" pending={saving} onClick={() => void save()}>
              <Save aria-hidden className="icon-md" />
              {t('builder.save')}
            </Button>
          </>
        }
      />

      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(380px,1fr))] items-start gap-[var(--spacing-gutter)]">
        <div className="grid min-w-0 gap-[var(--spacing-gutter)]">
          <Card gap="gutter">
            <Field label={t('name')}>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
          </Card>

          {/*
           * Předvyplněný návrh se PŘIZNÁ. Bez téhle věty uživatel netuší, odkud
           * se podmínka vzala, a u segmentu, který má rozhodovat, komu se pošle
           * další kampaň, je to zásadní rozdíl.
           */}
          {segment === null && draft !== undefined
            ? draft.notices.map((notice) => (
                <Card key={notice} tone="muted" padding="sm">
                  <p className="text-ui text-text-muted" data-testid="segment-draft-notice">
                    {notice}
                  </p>
                </Card>
              ))
            : null}

          <Card gap="gutter">
            <CardTitle>{t('builder.conditionsTitle')}</CardTitle>
            <SegmentBuilder
              value={ast}
              fields={fields}
              onChange={setAst}
              {...(totalContacts === undefined ? {} : { totalContacts })}
            />
          </Card>
        </div>

        {/*
         * Počet stojí ve vlastním sloupci, ne pod staviteli. Je to odpověď na
         * to, co uživatel právě naklikal, takže musí být vidět zároveň
         * s podmínkou, ne až po odrolování.
         */}
        <Card gap="gutter">
          <LiveCount
            definition={ast}
            workspaceId={workspaceId}
            locale={locale}
            {...(segment === null
              ? {}
              : {
                  // Odkaz „Zobrazit všech" vede na kontakty filtrované tímhle
                  // segmentem. U neuloženého segmentu není podle čeho filtrovat.
                  onShowAll: () =>
                    window.location.assign(`/w/${workspaceSlug}/contacts?segment_id=${segment.id}`),
                })}
          />
        </Card>
      </div>
    </>
  );
}
