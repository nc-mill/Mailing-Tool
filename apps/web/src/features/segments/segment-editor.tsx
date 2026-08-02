'use client';

import type { FieldDefinition, SegmentAst } from '@mlain/ui/patterns/query-builder';
import { Button } from '@mlain/ui/components/button';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
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
  totalContacts,
  fields = [],
}: {
  workspaceId: string;
  workspaceSlug: string;
  locale?: string;
  segment: { id: string; name: string; definition: unknown } | null;
  totalContacts?: number;
  /** Katalog polí skládá serverová komponenta, viz `field-catalog.ts`. */
  fields?: FieldDefinition[];
}) {
  const t = useTranslations('segments');
  const [name, setName] = useState(segment?.name ?? '');
  const [ast, setAst] = useState<SegmentAst>((segment?.definition as SegmentAst) ?? EMPTY);
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

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-text">
          {segment === null ? t('new') : segment.name}
        </h1>
        <Field label={t('name')}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
      </header>

      <SegmentBuilder
        value={ast}
        fields={fields}
        onChange={setAst}
        {...(totalContacts === undefined ? {} : { totalContacts })}
        footer={<LiveCount definition={ast} workspaceId={workspaceId} locale={locale} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" pending={saving} onClick={() => void save()}>
          {t('builder.save')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => window.location.assign(`/w/${workspaceSlug}/segments`)}
        >
          {t('builder.cancel')}
        </Button>
      </div>
    </section>
  );
}
