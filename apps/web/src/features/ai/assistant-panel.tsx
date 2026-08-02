'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Label } from '@mlain/ui/components/label';
import { Textarea } from '@mlain/ui/components/textarea';
import { Alert } from '@mlain/ui/patterns/states';
import type { EditorDocument } from '@/features/editor/model/document-types';
import { useEditorStore } from '@/features/editor/state/use-editor';
import { DraftDecision } from './draft-decision';
import { GenerationSteps, type GenerationStep } from './generation-steps';
import { useAiChat } from './use-ai-chat';

export type PanelState =
  | { phase: 'idle' }
  | { phase: 'generating'; step: GenerationStep }
  | { phase: 'done' }
  | { phase: 'error'; code: string; provider?: string; retryAfterSeconds?: number; limit?: number };

const ERROR_KEYS: Record<string, string> = {
  ai_credential_missing: 'noCredential',
  ai_invalid_credentials: 'invalidKey',
  ai_insufficient_credit: 'quota',
  ai_rate_limited: 'rateLimited',
  rate_limited: 'ourRateLimited',
  ai_invalid_output: 'invalidOutputFinal',
  ai_timeout: 'timeout',
  ai_provider_unavailable: 'providerDown',
  ai_context_too_long: 'contextTooLong',
  ai_content_filtered: 'contentFiltered',
};

const TONES = ['formal', 'friendly', 'playful', 'urgent'] as const;
const LANGUAGES = ['cs', 'en'] as const;
const LENGTHS = ['short', 'medium', 'long'] as const;

/** Prezentační vrstva. Odděleně od streamu, aby šla testovat bez sítě. */
export function AssistantPanelView({
  state,
  hasCredential,
  brandName,
  spendLabel,
  settingsHref = '/settings/ai',
  onSubmit,
  onStop,
  onKeep,
  onRetry,
  onChangeBrand,
}: {
  state: PanelState;
  hasCredential: boolean;
  brandName: string | null;
  spendLabel?: string | undefined;
  settingsHref?: string;
  onSubmit?: (input: { brief: string; tone: string; language: string; length: string }) => void;
  onStop?: () => void;
  onKeep?: () => void;
  onRetry?: () => void;
  onChangeBrand?: () => void;
}) {
  const t = useTranslations('ai');

  return (
    <aside
      aria-label={t('panel.title')}
      className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-surface p-4"
    >
      <h2 className="font-semibold text-text">{t('panel.title')}</h2>

      {!hasCredential ? (
        <Alert
          tone="error"
          action={
            <Link
              className="mt-2 inline-block text-accent-text underline underline-offset-4"
              href={settingsHref}
            >
              {t('errors.noCredentialSetup')}
            </Link>
          }
        >
          <p>{t('errors.noCredential')}</p>
        </Alert>
      ) : null}

      {hasCredential && state.phase === 'idle' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onSubmit?.({
              brief: String(data.get('brief') ?? ''),
              tone: String(data.get('tone') ?? 'friendly'),
              language: String(data.get('language') ?? 'cs'),
              length: String(data.get('length') ?? 'medium'),
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-brief">{t('panel.briefLabel')}</Label>
            <Textarea
              id="ai-brief"
              name="brief"
              rows={4}
              placeholder={t('panel.briefPlaceholder')}
            />
          </div>

          {/*
           * Nativní `<select>`, ne `Select` z P05: hodnoty se čtou z `FormData`
           * při odeslání a Radix Select do formuláře nic nedává.
           */}
          <div className="grid grid-cols-3 gap-2">
            <PanelSelect id="ai-tone" name="tone" label={t('panel.tone')} defaultValue="friendly">
              {TONES.map((value) => (
                <option key={value} value={value}>
                  {t(`tone.${value}`)}
                </option>
              ))}
            </PanelSelect>
            <PanelSelect
              id="ai-language"
              name="language"
              label={t('panel.language')}
              defaultValue="cs"
            >
              {LANGUAGES.map((value) => (
                <option key={value} value={value}>
                  {t(`language.${value}`)}
                </option>
              ))}
            </PanelSelect>
            <PanelSelect
              id="ai-length"
              name="length"
              label={t('panel.length')}
              defaultValue="medium"
            >
              {LENGTHS.map((value) => (
                <option key={value} value={value}>
                  {t(`length.${value}`)}
                </option>
              ))}
            </PanelSelect>
          </div>

          {brandName === null ? null : (
            <p className="flex flex-wrap items-center gap-2 text-sm text-text">
              {t('panel.brand', { name: brandName })}
              <Button type="button" variant="ghost" onClick={onChangeBrand}>
                {t('panel.brandChange')}
              </Button>
            </p>
          )}

          <div>
            <Button type="submit">{t('panel.submit')}</Button>
          </div>
        </form>
      ) : null}

      {state.phase === 'generating' ? (
        <GenerationSteps current={state.step} onCancel={onStop} />
      ) : null}

      {state.phase === 'done' ? <DraftDecision onKeep={onKeep} onRetry={onRetry} /> : null}

      {state.phase === 'error' && hasCredential ? (
        <Alert
          tone="error"
          action={
            <Button type="button" variant="secondary" className="mt-2 self-start" onClick={onRetry}>
              {t('errors.retry')}
            </Button>
          }
        >
          <p>
            {t(`errors.${ERROR_KEYS[state.code] ?? 'providerDown'}`, {
              provider: state.provider ?? '',
              seconds: state.retryAfterSeconds ?? 20,
              limit: state.limit ?? 60,
            })}
          </p>
        </Alert>
      ) : null}

      {spendLabel === undefined ? null : (
        <p className="mt-auto border-t border-border pt-3 text-sm text-text-muted">
          {t('panel.spendHint', { amount: spendLabel })}{' '}
          <Link className="text-accent-text underline underline-offset-4" href={settingsHref}>
            {t('panel.spendDetails')}
          </Link>
        </p>
      )}
    </aside>
  );
}

function PanelSelect({
  id,
  name,
  label,
  defaultValue,
  children,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        className="min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-2 text-sm text-text"
      >
        {children}
      </select>
    </div>
  );
}

/**
 * Napojení na stream a na editor. Editor mountuje tuhle komponentu propem
 * `assistant`, takže je uvnitř `EditorStoreProvider` a má přístup ke store.
 *
 * Výsledek se do dokumentu vkládá **přes blokový model**: `replaceDocument`
 * dostane strukturu dokumentu, ne text. Kdyby se vkládal text, přišel by
 * editor o typy bloků, o validaci i o možnost vrátit se zpátky.
 */
export function AiAssistantPanel({
  templateId,
  hasCredential,
  brandName,
  providerLabel,
  spendLabel,
  settingsHref,
}: {
  templateId: string;
  hasCredential: boolean;
  brandName: string | null;
  /** Jméno poskytovatele výchozího klíče. Hlášky ho jmenují, ať uživatel ví, u koho hledat. */
  providerLabel?: string | undefined;
  spendLabel?: string | undefined;
  settingsHref?: string;
}) {
  const store = useEditorStore();
  const chat = useAiChat({ templateId });
  const [applied, setApplied] = useState(false);
  const backup = useRef<{ document: EditorDocument; designHash: string } | null>(null);

  useEffect(() => {
    if (chat.draft === null || applied) return;
    const state = store.getState();
    // Záloha vzniká TEĎ, těsně před přepsáním: uživatel se na ni vrací
    // tlačítkem „Zkusit jinak", aniž by přišel o rozdělanou práci.
    backup.current = { document: state.document, designHash: state.designHash };
    store.replaceDocument(
      chat.draft.document as EditorDocument,
      chat.draft.designHash ?? state.designHash,
    );
    setApplied(true);
  }, [applied, chat.draft, store]);

  const restore = useCallback(() => {
    const saved = backup.current;
    if (saved !== null) store.replaceDocument(saved.document, saved.designHash);
    backup.current = null;
    setApplied(false);
  }, [store]);

  const state: PanelState =
    chat.errorCode !== null
      ? {
          phase: 'error',
          code: chat.errorCode,
          ...(providerLabel === undefined ? {} : { provider: providerLabel }),
        }
      : chat.status === 'streaming' || chat.status === 'submitted'
        ? { phase: 'generating', step: chat.step }
        : applied
          ? { phase: 'done' }
          : { phase: 'idle' };

  return (
    <AssistantPanelView
      state={state}
      hasCredential={hasCredential}
      brandName={brandName}
      spendLabel={spendLabel}
      {...(settingsHref === undefined ? {} : { settingsHref })}
      onSubmit={(input) =>
        chat.send({
          text: `${input.brief}\n\n[tón: ${input.tone}, jazyk: ${input.language}, délka: ${input.length}]`,
        })
      }
      onStop={() => chat.stop()}
      onKeep={() => {
        backup.current = null;
        setApplied(false);
        chat.reset();
      }}
      onRetry={() => {
        restore();
        chat.reset();
      }}
    />
  );
}
