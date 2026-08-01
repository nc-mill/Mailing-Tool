import type { Problem } from '@/lib/api-client/problem';
import { fieldErrorsFrom, type FieldErrors } from '@/lib/errors/field-errors';

/** Šest kanálů z 5.3 části 6. P06 používá čtyři, zbylé dva patří dlouhým úlohám. */
export type FeedbackChannel = 'inline' | 'inlineBlock' | 'toast' | 'page';

export type ActionSuccess<T> = {
  status: 'success';
  channel: FeedbackChannel;
  /** Klíč do katalogu, vždy literál. Skládání klíče za běhu je zakázané. */
  messageKey: string;
  values?: Record<string, string | number>;
  data?: T;
};

export type ActionFailure = {
  status: 'error';
  channel: FeedbackChannel;
  problem: Problem;
  fieldErrors: FieldErrors;
};

export type ActionState<T = void> = { status: 'idle' } | ActionSuccess<T> | ActionFailure;

export const IDLE: ActionState<never> = { status: 'idle' };

export function succeeded<T>(input: Omit<ActionSuccess<T>, 'status'>): ActionSuccess<T> {
  return { status: 'success', ...input };
}

export function failed(channel: FeedbackChannel, problem: Problem): ActionFailure {
  return { status: 'error', channel, problem, fieldErrors: fieldErrorsFrom(problem) };
}
