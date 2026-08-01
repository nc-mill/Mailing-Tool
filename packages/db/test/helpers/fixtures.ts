import type { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';

export type TwoWorkspaces = {
  userId: string;
  workspaceA: string;
  workspaceB: string;
  contactInA: string;
};

/**
 * Zakládá se pod migrátorem schválně: migrátor vlastní schéma, takže se na něj
 * RLS nevztahuje a fixture jde vložit bez nastavování kontextu. Testy izolace
 * pak běží pod mlain_app, tedy pod rolí, na kterou RLS dopadá.
 */
export async function seedTwoWorkspaces(migrator: Pool): Promise<TwoWorkspaces> {
  const userId = uuidv7();
  const workspaceA = uuidv7();
  const workspaceB = uuidv7();
  const contactInA = uuidv7();

  await migrator.query(
    `INSERT INTO users (id, email, password_hash, locale, timezone)
     VALUES ($1, $2, 'argon2id$dummy', 'cs', 'Europe/Prague')`,
    [userId, `owner-${userId}@example.test`],
  );
  for (const [id, prefix] of [
    [workspaceA, 'ws-a'],
    [workspaceB, 'ws-b'],
  ] as const) {
    await migrator.query(
      `INSERT INTO workspaces (id, name, slug, locale, timezone, created_by)
       VALUES ($1, $2, $3, 'cs', 'Europe/Prague', $4)`,
      // Slug nese CELÉ uuid, ne prvních osm znaků. uuidv7 začíná časovou
      // značkou v milisekundách, takže prvních osm hex znaků je horních 32 bitů
      // a mění se jednou za minutu: dvě volání fixture v témž testovacím
      // souboru by dostala týž slug a druhé by spadlo na uq_workspaces__slug.
      [id, prefix, `${prefix}-${id}`, userId],
    );
    await migrator.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [id, userId],
    );
  }
  await migrator.query(
    `INSERT INTO contacts (id, workspace_id, email, locale) VALUES ($1, $2, $3, 'cs')`,
    [contactInA, workspaceA, `contact-${contactInA}@example.test`],
  );

  return { userId, workspaceA, workspaceB, contactInA };
}
