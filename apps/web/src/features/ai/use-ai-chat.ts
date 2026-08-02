'use client';

import { useCallback, useRef, useState } from 'react';
import { stepFromToolCalls, type GenerationStep } from './generation-steps';

/**
 * ODCHYLKA OD PLÁNU, vynucená obsahem repozitáře: plán počítá s `useChat`
 * z `@ai-sdk/react`, jenže ten balíček v `apps/web/package.json` **není**
 * a lockfile spravuje někdo jiný. Čtení streamu je proto napsané ručně.
 *
 * Formát není vymyšlený: `route.ts` vrací `toUIMessageStreamResponse()`, což
 * je podle `node_modules/ai/src/ui-message-stream/json-to-sse-transform-stream.ts`
 * proud rámců `data: <json>\n\n` zakončený `data: [DONE]`. Zajímají nás čtyři
 * druhy částí, jejich tvar je v `ui-message-chunks.ts`:
 *   - `text-delta`            { delta }
 *   - `tool-input-start`      { toolCallId, toolName }
 *   - `tool-output-available` { toolCallId, output }
 *   - `tool-output-error`     { toolCallId, errorText }  a `error` { errorText }
 */
export type AiChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type ComposedDraft = { document: unknown; designHash: string | null };

export type AiChatState = {
  status: AiChatStatus;
  step: GenerationStep;
  text: string;
  errorCode: string | null;
  /** Výsledek nástroje `composeTemplate`, tedy dokument v blokovém modelu. */
  draft: ComposedDraft | null;
  send: (input: { text: string }) => void;
  stop: () => void;
  reset: () => void;
};

const KNOWN_CODE = /\b(ai_[a-z_]+|rate_limited|not_found|forbidden|unauthenticated)\b/;

export function errorCodeOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && 'code' in value) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
  }
  const message = value instanceof Error ? value.message : String(value);
  const found = KNOWN_CODE.test(message) ? message.match(KNOWN_CODE) : null;
  return found?.[1] ?? 'ai_provider_unavailable';
}

/** Z výstupu nástroje vytáhne dokument, ať přijde holý, nebo zabalený. */
export function draftFromToolOutput(output: unknown): ComposedDraft | null {
  if (typeof output !== 'object' || output === null) return null;
  const record = output as Record<string, unknown>;
  const document = record['document'] ?? ('blocks' in record ? record : null);
  if (document === null || typeof document !== 'object') return null;
  const hash = record['designHash'] ?? record['design_hash'];
  return { document, designHash: typeof hash === 'string' ? hash : null };
}

export function useAiChat(params: {
  templateId: string;
  credentialId?: string | undefined;
  model?: string | undefined;
}): AiChatState {
  const [status, setStatus] = useState<AiChatStatus>('ready');
  const [text, setText] = useState('');
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComposedDraft | null>(null);
  const abort = useRef<AbortController | null>(null);
  const conversationId = useRef<string | null>(null);

  const reset = useCallback(() => {
    setStatus('ready');
    setText('');
    setToolNames([]);
    setErrorCode(null);
    setDraft(null);
  }, []);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setStatus('ready');
  }, []);

  const send = useCallback(
    (input: { text: string }) => {
      const controller = new AbortController();
      abort.current = controller;
      setStatus('submitted');
      setText('');
      setToolNames([]);
      setErrorCode(null);
      setDraft(null);

      const handleFrame = (frame: string) => {
        const line = frame.split('\n').find((item) => item.startsWith('data: '));
        if (line === undefined) return;
        const payload = line.slice('data: '.length);
        if (payload === '[DONE]') return;

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          return;
        }

        switch (chunk['type']) {
          case 'text-delta':
            setText((current) => current + String(chunk['delta'] ?? ''));
            return;
          case 'tool-input-start': {
            const name = chunk['toolName'];
            if (typeof name === 'string') setToolNames((current) => [...current, name]);
            return;
          }
          case 'tool-output-available': {
            const parsed = draftFromToolOutput(chunk['output']);
            if (parsed !== null) setDraft(parsed);
            return;
          }
          case 'tool-output-error':
          case 'error':
            setErrorCode(errorCodeOf(String(chunk['errorText'] ?? '')));
            setStatus('error');
            return;
          default:
            return;
        }
      };

      void (async () => {
        try {
          const response = await fetch('/api/internal/ai/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
            signal: controller.signal,
            body: JSON.stringify({
              conversationId: conversationId.current,
              templateId: params.templateId,
              credentialId: params.credentialId ?? null,
              model: params.model ?? null,
              message: { role: 'user', parts: [{ type: 'text', text: input.text }] },
            }),
          });

          if (!response.ok || response.body === null) {
            const problem = (await response.json().catch(() => null)) as unknown;
            setErrorCode(errorCodeOf(problem));
            setStatus('error');
            return;
          }

          setStatus('streaming');
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += value;
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
              handleFrame(buffer.slice(0, boundary));
              buffer = buffer.slice(boundary + 2);
              boundary = buffer.indexOf('\n\n');
            }
          }
          setStatus((current) => (current === 'error' ? current : 'ready'));
        } catch (error) {
          if (controller.signal.aborted) return;
          setErrorCode(errorCodeOf(error));
          setStatus('error');
        }
      })();
    },
    [params.credentialId, params.model, params.templateId],
  );

  return {
    status,
    step: stepFromToolCalls(toolNames, {
      finished: status === 'ready' && toolNames.length > 0,
    }),
    text,
    errorCode,
    draft,
    send,
    stop,
    reset,
  };
}
