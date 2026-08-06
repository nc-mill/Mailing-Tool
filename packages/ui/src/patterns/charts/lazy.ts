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

/*
 * `TrendChart` tady schválně NENÍ. Kreslí se ručním SVG a `recharts`
 * nepotřebuje, takže není co odkládat: líné načítání by mu jen přidalo
 * prázdné místo, než doskočí druhý balík. Importuje se rovnou
 * z `@mlain/ui/patterns/charts`.
 */
