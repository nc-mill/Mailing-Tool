import type { WorkspaceContext } from '../../identity/types';

export type ImportProgress = {
  importId: string;
  processed: number;
  total: number | null;
  errors: number;
};

export type ProgressSink = (ctx: WorkspaceContext, progress: ImportProgress) => void;

/**
 * SSE kanál vlastní část 1 (P01) a v procesu importu se k němu nedostaneme jinak
 * než portem: worker běží v `apps/worker`, kanál žije v `apps/web`. Do doby, než
 * si někdo sink zaregistruje, je publikování bez efektu, což je správně, protože
 * průběh je pohodlí, ne data. Tentýž vzor používá `campaigns-port.ts`.
 */
let sink: ProgressSink | null = null;

export function registerProgressSink(next: ProgressSink | null): void {
  sink = next;
}

const lastPublishedAt = new Map<string, number>();

/**
 * Nejvýš jednou za sekundu na jeden import. Bez škrcení by dávka po tisíci
 * řádcích poslala u pětimilionového souboru pět tisíc událostí a prohlížeč
 * by je jen zahazoval.
 */
export async function publishProgress(
  ctx: WorkspaceContext,
  importId: string,
  progress: { processed: number; total: number | null; errors: number },
): Promise<void> {
  if (sink === null) return;
  const now = Date.now();
  const last = lastPublishedAt.get(importId) ?? 0;
  if (now - last < 1000) return;
  lastPublishedAt.set(importId, now);
  sink(ctx, { importId, ...progress });
}

/** Konec importu: zápis se pošle vždy, i kdyby od posledního uběhla milisekunda. */
export function flushProgress(
  ctx: WorkspaceContext,
  importId: string,
  progress: { processed: number; total: number | null; errors: number },
): void {
  lastPublishedAt.delete(importId);
  sink?.(ctx, { importId, ...progress });
}
