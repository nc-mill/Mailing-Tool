'use client';

import type { SegmentAst } from '@mlain/ui/patterns/query-builder';
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
}: {
  workspaceId: string;
  workspaceSlug: string;
  locale?: string;
  segment: { id: string; name: string; definition: unknown } | null;
  totalContacts?: number;
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
    <div className="flex flex-col gap-4">
      <label htmlFor="segment-name">{t('name')}</label>
      <input id="segment-name" value={name} onChange={(event) => setName(event.target.value)} />

      <SegmentBuilder
        value={ast}
        onChange={setAst}
        {...(totalContacts === undefined ? {} : { totalContacts })}
        footer={<LiveCount definition={ast} workspaceId={workspaceId} locale={locale} />}
      />

      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => void save()}>
          {t('builder.save')}
        </button>
        <a href={`/w/${workspaceSlug}/segments`}>{t('builder.cancel')}</a>
      </div>
    </div>
  );
}
