import { v7 as uuidv7 } from 'uuid';

/** 4.1: hodnota z hlavičky projde, jen když vyhoví tomuhle tvaru. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export const REQUEST_ID_HEADER = 'X-Request-Id';

export function resolveRequestId(headerValue: string | undefined | null): string {
  if (headerValue && REQUEST_ID_PATTERN.test(headerValue)) return headerValue;
  return uuidv7();
}
