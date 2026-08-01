import { sql } from 'drizzle-orm';
import { writeAuditLog } from '../audit/write';
import { resolveName } from '../contacts/naming/resolve';
import { EMPTY_OVERRIDES } from '../contacts/naming/types';
import type { Tx } from '../tx';
import { DemoAuditActions } from './audit';
import {
  DEMO_CAMPAIGN,
  DEMO_CONTACTS,
  DEMO_LISTS,
  DEMO_SEGMENTS,
  DEMO_TAGS,
  DEMO_TEMPLATES,
  demoCampaignSentAt,
  type DemoContact,
} from './dataset';
import {
  DEMO_MANIFEST_VERSION,
  DEMO_SOURCE_REF,
  DEMO_TAG_NAME,
  parseDemoManifest,
  type DemoManifest,
} from './manifest';

export class DemoAlreadySeededError extends Error {
  constructor() {
    super('Ukázková data už v projektu jsou. Nejdřív je odstraňte, pak je můžete nahrát znovu.');
    this.name = 'DemoAlreadySeededError';
  }
}

export type SeedInput = { workspaceId: string; now: Date };

export async function readDemoManifest(tx: Tx, workspaceId: string): Promise<DemoManifest | null> {
  const { rows } = await tx.execute<{ settings: Record<string, unknown> }>(
    sql`SELECT settings FROM workspaces WHERE id = ${workspaceId}`,
  );
  return parseDemoManifest(rows[0]?.settings['demoData']);
}

/**
 * Identifikátor štítku „Ukázková data", na kterém stojí hromadný výběr
 * v tabulce kontaktů.
 *
 * Existuje proto, že tabulka kontaktů filtruje podle `tag_id`, ne podle jména
 * ani podle klíče (ověřeno v `apps/web/src/features/contacts/filters.ts`).
 * Bez identifikátoru by odkaz z pruhu ukázkových dat vedl na nefiltrovaný
 * seznam a slib „vyberte je hromadně" by neplatil.
 *
 * Hledá se podle jména UVNITŘ manifestu, ne podle pořadí v poli: pořadí je
 * náhoda, která se změní při prvním přeuspořádání datové sady.
 */
export async function readDemoTagId(tx: Tx, workspaceId: string): Promise<string | null> {
  const manifest = await readDemoManifest(tx, workspaceId);
  if (manifest === null || manifest.tagIds.length === 0) return null;
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT id FROM tags
     WHERE workspace_id = ${workspaceId}
       AND id = ANY(${sql.param([...manifest.tagIds])})
       AND name = ${DEMO_TAG_NAME}
     LIMIT 1`);
  return rows[0]?.id ?? null;
}

/**
 * Seed i úklid berou `tx: Tx` a transakci otevírá volající přes
 * `withWorkspace`. Je to povinné, ne stylistická volba: všech devět tabulek,
 * do kterých se tu zapisuje, má politiku `ws_isolation` s klauzulí
 * `WITH CHECK`, takže bez nastaveného `mlain.workspace_id` by první INSERT
 * skončil na porušení politiky, a `SELECT ... FOR UPDATE` nad `workspaces`
 * by předtím vrátil prázdno a vyhodil „projekt neexistuje" u projektu,
 * který existuje.
 *
 * Celý seed je jedna transakce. Kdyby doběhl napůl, zůstala by v projektu
 * data, která nejsou v manifestu, a odstranění by je nenašlo. Půlka ukázkových
 * dat, které se nedají smazat, je horší než žádná.
 */
export async function seedDemoData(tx: Tx, input: SeedInput): Promise<DemoManifest> {
  const { rows: ws } = await tx.execute<{
    settings: Record<string, unknown>;
    locale: string;
    address_form: 'formal' | 'informal';
  }>(
    sql`SELECT settings, locale, address_form FROM workspaces
         WHERE id = ${input.workspaceId} FOR UPDATE`,
  );
  if (ws.length === 0) throw new Error(`Projekt ${input.workspaceId} neexistuje.`);
  if (parseDemoManifest(ws[0]!.settings['demoData']) !== null) throw new DemoAlreadySeededError();

  const manifest = await insertAll(tx, input, ws[0]!.locale, ws[0]!.address_form);

  await tx.execute(sql`
    UPDATE workspaces
       SET settings = jsonb_set(settings, '{demoData}', ${JSON.stringify(manifest)}::jsonb, true),
           updated_at = now()
     WHERE id = ${input.workspaceId}`);
  await writeAuditLog(tx, {
    action: DemoAuditActions['demo_data.seeded'],
    workspaceId: input.workspaceId,
    actor: { actorType: 'system', actorId: null, actorLabel: 'demo.seed' },
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: { contacts: manifest.contactIds.length },
  });
  return manifest;
}

/**
 * Jména se NEPÍŠOU do databáze natvrdo z datové sady. Projdou tímtéž
 * `resolveName`, kterým jimi projde každý zápis kontaktu ze všech kanálů
 * (rozhodnutí P07). Ukázková data jsou to jediné místo, kde uživatel na vlastní
 * oči uvidí, jestli oslovení funguje, takže musí vzniknout stejnou cestou jako
 * skutečné kontakty; jinak by ukazovala něco, co produkt neumí.
 *
 * Předpočítané `greeting` v datové sadě zůstává jako kontrolní hodnota a test
 * `dataset.test.ts` tvrdí, že se s výstupem algoritmu shoduje do písmene.
 */
function resolvedName(contact: DemoContact, locale: string, addressForm: 'formal' | 'informal') {
  return resolveName(
    {
      firstName: contact.firstName,
      lastName: contact.lastName,
      titlePrefix: contact.titlePrefix,
      locale,
    },
    {
      overrides: EMPTY_OVERRIDES,
      settings: { addressForm, salutationBy: 'first_name', vocativePolicy: 'strict' },
    },
  );
}

async function insertAll(
  tx: Tx,
  input: SeedInput,
  locale: string,
  addressForm: 'formal' | 'informal',
): Promise<DemoManifest> {
  const ws = input.workspaceId;

  // ---------------------------------------------------------------------------
  // JMÉNA SLOUPCŮ SEDÍ SE SCHÉMATEM P03 a hlídá to test „seed sedí se schématem".
  // Konkrétně: `tags.slug`, `lists.slug`, `segments.slug`, `templates.slug`,
  // `templates.subject`, `templates.blocks`, `contacts.custom_fields`
  // a `campaigns.sent_at` ve schématu NEJSOU, `list_subscriptions` nemá `id`
  // ani `created_at`, a povinné `templates.design`, `templates.design_hash`
  // i `segments.definition_hash` jsou naopak nutné.
  //
  // Identifikátor se nechává na databázi (`DEFAULT uuidv7()`) a čte se přes
  // RETURNING. uuidv7 je časově uspořádané, což u ukázkových dat znamená,
  // že se v tabulce seřadí tak, jak vznikla.
  // ---------------------------------------------------------------------------

  const tagIds = new Map<string, string>();
  for (const tag of DEMO_TAGS) {
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO tags (workspace_id, name) VALUES (${ws}, ${tag.name}) RETURNING id`);
    tagIds.set(tag.key, rows[0]!.id);
  }

  const listIds = new Map<string, string>();
  for (const list of DEMO_LISTS) {
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO lists (workspace_id, name, description)
      VALUES (${ws}, ${list.name}, ${list.description}) RETURNING id`);
    listIds.set(list.key, rows[0]!.id);
  }

  const contactIds: string[] = [];
  for (const contact of DEMO_CONTACTS) {
    const name = resolvedName(contact, locale, addressForm);
    // Vlastní pole jsou `attributes`, ne `custom_fields`.
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO contacts
        (workspace_id, email, first_name, last_name, title_prefix,
         first_name_key, last_name_key,
         gender, gender_source,
         first_name_vocative, last_name_vocative, vocative_confidence,
         name_split_confidence, greeting, greeting_neutral,
         status, source, source_ref, locale, timezone, attributes)
      VALUES (${ws}, ${contact.email}, ${name.firstName}, ${name.lastName},
              ${name.titlePrefix}, ${name.firstNameKey}, ${name.lastNameKey},
              ${name.gender}, ${name.genderSource},
              ${name.firstNameVocative}, ${name.lastNameVocative}, ${name.vocativeConfidence},
              ${name.nameSplitConfidence}, ${name.greeting}, ${name.greetingNeutral},
              'active', 'manual', ${DEMO_SOURCE_REF}, ${locale}, 'Europe/Prague',
              ${JSON.stringify({ city: contact.city })}::jsonb)
      RETURNING id`);
    const id = rows[0]!.id;
    contactIds.push(id);

    for (const key of contact.tagKeys) {
      await tx.execute(sql`
        INSERT INTO contact_tags (contact_id, tag_id, workspace_id)
        VALUES (${id}, ${tagIds.get(key)}, ${ws})`);
    }
    for (const key of contact.listKeys) {
      // list_subscriptions má složený PK (contact_id, list_id), tedy žádné
      // vlastní `id`, a nemá `created_at`. `source` je NOT NULL bez defaultu.
      await tx.execute(sql`
        INSERT INTO list_subscriptions
          (workspace_id, list_id, contact_id, status, source, subscribed_at, confirmed_at)
        VALUES (${ws}, ${listIds.get(key)}, ${id}, 'confirmed', 'manual', now(), now())`);
    }
  }

  const segmentIds: string[] = [];
  for (const segment of DEMO_SEGMENTS) {
    // `definition_hash bytea` je NOT NULL. Počítá se z kanonického JSON,
    // stejně jako u šablon.
    const definition = JSON.stringify(segment.definition);
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO segments (workspace_id, name, kind, definition, definition_hash)
      VALUES (${ws}, ${segment.name}, 'dynamic', ${definition}::jsonb, sha256(${definition}::bytea))
      RETURNING id`);
    segmentIds.push(rows[0]!.id);
  }

  const templateIds = new Map<string, string>();
  for (const template of DEMO_TEMPLATES) {
    // `design jsonb` a `design_hash bytea` jsou NOT NULL; `subject` ani
    // `blocks` na šabloně neexistují, předmět nese kampaň.
    const design = JSON.stringify(template.design);
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO templates (workspace_id, name, kind, design, design_hash)
      VALUES (${ws}, ${template.name}, 'campaign', ${design}::jsonb, sha256(${design}::bytea))
      RETURNING id`);
    templateIds.set(template.key, rows[0]!.id);
  }

  const sentAt = demoCampaignSentAt(input.now);
  // `campaigns.sent_at` neexistuje. Dokončení kampaně nese `finished_at`,
  // začátek `started_at`. Obojí se nastavuje na týž čas, protože ukázková
  // kampaň se nikdy neodesílala doopravdy.
  const { rows: campaignRows } = await tx.execute<{ id: string }>(sql`
    INSERT INTO campaigns
      (workspace_id, name, subject, template_id, status,
       started_at, finished_at, audience_built_at)
    VALUES (${ws}, ${DEMO_CAMPAIGN.name}, ${DEMO_CAMPAIGN.subject},
            ${templateIds.get(DEMO_CAMPAIGN.templateKey)}, 'sent',
            ${sentAt.toISOString()}::timestamptz, ${sentAt.toISOString()}::timestamptz,
            ${sentAt.toISOString()}::timestamptz)
    RETURNING id`);
  const campaignId = campaignRows[0]!.id;

  const s = DEMO_CAMPAIGN.stats;
  // `bounced` ani `computed_at` v campaign_stats nejsou. Nedoručení se dělí
  // na `bounced_hard` a `bounced_soft`, čas poslední změny je `updated_at`.
  await tx.execute(sql`
    INSERT INTO campaign_stats
      (workspace_id, campaign_id, sent, delivered, opens_unique, opens_unique_apple,
       clicks_unique, bounced_hard, bounced_soft, complained, unsubscribed, updated_at)
    VALUES (${ws}, ${campaignId}, ${s.sent}, ${s.delivered}, ${s.openedUnique},
            ${s.openedUniqueApple}, ${s.clickedUnique}, ${s.bouncedHard}, ${s.bouncedSoft},
            ${s.complained}, ${s.unsubscribed}, now())`);

  return {
    version: DEMO_MANIFEST_VERSION,
    seededAt: input.now.toISOString(),
    contactIds,
    listIds: [...listIds.values()],
    tagIds: [...tagIds.values()],
    segmentIds,
    templateIds: [...templateIds.values()],
    campaignIds: [campaignId],
  };
}
