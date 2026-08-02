'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { CheckIcon } from '@/lib/ui/status-icons';
import { BrandReview, type BrandProfileView } from './brand-review';
import { ExtractionForm, type ExtractionFormState } from './extraction-form';
import { useExtractionPoll } from './use-extraction-poll';

export type BrandProfileSummaryView = BrandProfileView & {
  sourceUrl: string | null;
  defaultProfile: boolean;
};

export type BrandSettingsClientProps = {
  workspaceId: string;
  profiles: readonly BrandProfileSummaryView[];
};

type StartState =
  | { kind: 'idle' }
  | { kind: 'started'; id: string; url: string }
  | { kind: 'error'; code: string; url: string };

/**
 * Serverová stránka načte uložené značky a předá je sem. Stav rozpracované
 * extrakce je klientský, protože se dotazuje po 1000 ms (rozhodnutí D4).
 */
export function BrandSettingsClient({ workspaceId, profiles }: BrandSettingsClientProps) {
  const t = useTranslations('ai');
  const [start, setStart] = useState<StartState>({ kind: 'idle' });
  const { snapshot, elapsedMs, timedOut } = useExtractionPoll(
    start.kind === 'started' ? start.id : null,
  );

  const submit = useCallback(
    async (url: string) => {
      setStart({ kind: 'idle' });
      try {
        const response = await fetch('/api/v1/brand/extractions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'x-workspace-id': workspaceId,
            accept: 'application/json',
          },
          body: JSON.stringify({ url }),
        });
        const payload = (await response.json().catch(() => null)) as {
          id?: string;
          code?: string;
        } | null;
        if (response.ok && typeof payload?.id === 'string') {
          setStart({ kind: 'started', id: payload.id, url });
          return;
        }
        setStart({ kind: 'error', code: payload?.code ?? 'brand_fetch_failed', url });
      } catch {
        setStart({ kind: 'error', code: 'brand_fetch_failed', url });
      }
    },
    [workspaceId],
  );

  const state: ExtractionFormState = useMemo(() => {
    if (start.kind === 'error') return { phase: 'error', code: start.code, url: start.url };
    if (start.kind === 'idle') return { phase: 'idle' };
    if (timedOut) return { phase: 'error', code: 'brand_timeout', url: start.url };
    if (snapshot === null || snapshot.status === 'pending' || snapshot.status === 'running') {
      return { phase: 'running', elapsedMs };
    }
    if (snapshot.status === 'succeeded') return { phase: 'done' };
    return {
      phase: 'error',
      code: snapshot.error_code ?? 'brand_fetch_failed',
      url: start.url,
      host: hostOf(start.url),
    };
  }, [elapsedMs, snapshot, start, timedOut]);

  const reviewed =
    snapshot?.status === 'succeeded' && snapshot.brand_profile_id !== null
      ? (profiles.find((profile) => profile.id === snapshot.brand_profile_id) ??
        profiles.find((profile) => profile.defaultProfile) ??
        profiles[0])
      : (profiles.find((profile) => profile.defaultProfile) ?? profiles[0]);

  return (
    <div className="flex flex-col gap-8">
      <ExtractionForm state={state} onSubmit={(url) => void submit(url)} />

      {/*
        Prázdný stav říká formulář sám (`brand.emptyTitle`). Druhá věta se
        přidává jen tehdy, když už uživatel něco spustil a přesto není co
        ukázat: dvě hlášky o témže pod sebou vypadají jako chyba.
      */}
      {reviewed === undefined ? (
        start.kind === 'started' ? (
          <p className="text-sm text-text-muted">{t('brand.emptyState')}</p>
        ) : null
      ) : (
        <BrandReview profile={reviewed} />
      )}

      <section aria-labelledby="brand-profiles">
        <h2 id="brand-profiles" className="text-xl font-semibold text-text">
          {t('brand.existingProfiles')}
        </h2>
        {profiles.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{t('brand.noProfiles')}</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {profiles.map((profile) => (
              <li
                key={profile.id}
                data-testid="brand-profile-row"
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <span
                  aria-hidden="true"
                  className="inline-block size-5 rounded border border-border"
                  style={{ backgroundColor: profile.palette.primary }}
                />
                <span className="font-medium text-text">{profile.name}</span>
                {profile.sourceUrl === null ? null : (
                  <span className="text-sm text-text-muted">{profile.sourceUrl}</span>
                )}
                {profile.defaultProfile ? (
                  <Badge tone="success" icon={CheckIcon}>
                    {t('credentials.isDefault')}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
