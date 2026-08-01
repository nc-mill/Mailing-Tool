'use client';

import dynamic from 'next/dynamic';

/** Query builder se načítá jen na obrazovce segmentu (14.3). */
export const QueryBuilder = dynamic(
  () => import('./query-builder').then((module) => module.QueryBuilder),
  { ssr: false },
);
