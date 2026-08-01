import type { Formats } from 'next-intl';

/** Společné pojmenované formáty pro celou aplikaci, předávají se do next-intl. */
export const formats = {
  dateTime: {
    short: { day: 'numeric', month: 'numeric', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric' },
    time: { hour: 'numeric', minute: '2-digit' },
    dateTime: {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
  },
  number: {
    integer: { maximumFractionDigits: 0 },
    percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
  },
} satisfies Formats;
