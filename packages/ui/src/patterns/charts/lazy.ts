'use client';

import dynamic from 'next/dynamic';

/**
 * Grafy se načítají líně, jen na obrazovkách se statistikami (14.3).
 * `recharts` je největší závislost balíčku, do základního balíku nepatří.
 */
export const LineChart = dynamic(() => import('./line-chart').then((module) => module.LineChart), {
  ssr: false,
});

export const BarChart = dynamic(() => import('./bar-chart').then((module) => module.BarChart), {
  ssr: false,
});
