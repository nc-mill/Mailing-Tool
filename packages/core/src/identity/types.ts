/**
 * 3.6, vrstva 1. Typy izolace se sem NEPÍŠOU ZNOVU, jen se reexportují z @mlain/db.
 *
 * Proč: WorkspaceContext je branded typ a jeho smysl je, že nejde vyrobit
 * z řetězce. Kdyby ho P04 definoval podruhé s vlastním `unique symbol`,
 * vznikly by dva vzájemně NEPŘIŘADITELNÉ typy téhož jména. Každé volání
 * withWorkspace, withReadOnly nebo registerRepoModule z @mlain/db by pak šlo
 * napsat jen s přetypováním, a přetypováním padá celá první vrstva izolace.
 * Zdůvodnění je v rozhodnutí R2.
 *
 * Značka (brand) je v @mlain/db neexportovaný `unique symbol`, takže jediný
 * způsob, jak kontext vyrobit, vede přes unsafeWorkspaceContext z podcesty
 * @mlain/db/unsafe-context. Tu volá VÝHRADNĚ context.ts a hlídá to test
 * v úkolu 19.
 */
export type { Actor, Role, WorkspaceContext } from '@mlain/db';

import type { Actor } from '@mlain/db';

export type AuditActorInfo = {
  actorType: 'user' | 'api_key' | 'system';
  actorId: string | null;
  actorLabel: string;
};

/** Popis aktéra pro audit log. actor_label je zmrazený text, ne odkaz (6, GDPR). */
export function actorInfo(actor: Actor, label: string): AuditActorInfo {
  switch (actor.type) {
    case 'user':
      return { actorType: 'user', actorId: actor.userId, actorLabel: label };
    case 'api_key':
      return { actorType: 'api_key', actorId: actor.apiKeyId, actorLabel: label };
    case 'system':
      return { actorType: 'system', actorId: null, actorLabel: actor.job };
  }
}
