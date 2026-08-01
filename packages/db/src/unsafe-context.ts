// packages/db/src/unsafe-context.ts
import type { Actor, WorkspaceContext } from './context';

/**
 * Jediná cesta, jak kontext vyrobit. Je určená pro testy a pro migrační
 * a údržbové joby, které žádného uživatele nemají.
 *
 * Soubor je zvlášť a z kořenového exportu `@mlain/db` je VYNECHANÝ. Importuje
 * se výhradně podcestou `@mlain/db/unsafe-context`, tedy vždy vědomě.
 * Když byla vedle withWorkspace v hlavním exportu, nabízel ji našeptávač
 * každému a jediná ochrana bylo pravidlo ESLintu, které si tenhle plán přál,
 * ale po nikom si ho nevyžádal. Že v kořenovém exportu není, hlídá test
 * v posledním úkolu.
 *
 * Aplikační kód ji volat NESMÍ: obešel by ověření členství, což je celá
 * obrana první vrstvy. Legitimní továrna žije v packages/core/identity (P04).
 */
export function unsafeWorkspaceContext(workspaceId: string, actor: Actor): WorkspaceContext {
  return { workspaceId, actor } as WorkspaceContext;
}
