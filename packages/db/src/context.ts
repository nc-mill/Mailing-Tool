// packages/db/src/context.ts

declare const brand: unique symbol;

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type Permission = string; // 'resource:action', úplný registr vlastní P04

export type Actor =
  | { type: 'user'; userId: string; role: Role }
  | { type: 'api_key'; apiKeyId: string; scopes: readonly Permission[] }
  | { type: 'system'; job: string };

/**
 * Branded typ. NEJDE ho vyrobit z řetězce a je to jeho jediný smysl.
 * Jediná legitimní továrna žije v packages/core/identity (P04) a ověřuje
 * členství nebo klíč. Odkud se bere workspaceId:
 *   - aktér api_key: z api_keys.workspace_id, NIKDY z URL ani z těla requestu
 *   - aktér user:    ze segmentu cesty /w/{slug} nebo z hlavičky X-Workspace-Id,
 *                    vždy po ověření členství
 */
export type WorkspaceContext = {
  readonly [brand]: 'WorkspaceContext';
  readonly workspaceId: string;
  readonly actor: Actor;
};
