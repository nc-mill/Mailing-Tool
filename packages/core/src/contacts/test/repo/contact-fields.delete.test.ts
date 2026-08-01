import { describe, expect, it } from 'vitest';
import {
  archiveContactField,
  createContactField,
  deleteContactField,
  getFieldImpact,
} from '../../repo/contact-fields';
import { stripAttribute } from '../../jobs/strip-attribute';
import { writeContact } from '../../repo/contacts';
import {
  countContactsWithAttribute,
  createFormWritingTo,
  createScheduledCampaignUsing,
  enqueuedJobNames,
  testContext,
} from '../support/db';
import type { WorkspaceContext } from '../../../identity/types';

async function createFieldWithValues(
  ctx: WorkspaceContext,
  key: string,
  values: readonly string[],
): Promise<{ id: string }> {
  const field = await createContactField(ctx, { key, type: 'text', label: { en: key } });
  for (const [index, value] of values.entries()) {
    await writeContact(ctx, { email: `c${index}@x.cz`, attributes: { [key]: value } });
  }
  return field;
}

describe('archivace pole', () => {
  it('je měkká: hodnoty v attributes zůstanou', async () => {
    const ctx = await testContext();
    const { id } = await createFieldWithValues(ctx, 'city', ['Brno', 'Praha']);
    await archiveContactField(ctx, id);
    expect(await countContactsWithAttribute(ctx, 'city')).toBe(2);
  });

  it('archivovaný klíč nejde použít znovu s jiným typem', async () => {
    const ctx = await testContext();
    const { id } = await createFieldWithValues(ctx, 'city', []);
    await archiveContactField(ctx, id);
    await expect(
      createContactField(ctx, { key: 'city', type: 'number', label: { en: 'C' } }),
    ).rejects.toMatchObject({ code: 'already_exists' });
  });
});

describe('kontrola dopadu smazání pole', () => {
  it('vrátí počet kontaktů s hodnotou a seznam dotčených objektů', async () => {
    const ctx = await testContext();
    const { id } = await createFieldWithValues(ctx, 'city', ['Brno', 'Praha']);
    const impact = await getFieldImpact(ctx, id);
    expect(impact.contacts_with_value).toBe(2);
    expect(impact).toHaveProperty('segments');
    expect(impact).toHaveProperty('templates');
    expect(impact).toHaveProperty('campaigns_scheduled');
    expect(impact).toHaveProperty('forms');
  });

  it('najde formulář, který do pole zapisuje', async () => {
    const ctx = await testContext();
    const { id } = await createFieldWithValues(ctx, 'city', []);
    const form = await createFormWritingTo(ctx, 'city');
    const impact = await getFieldImpact(ctx, id);
    expect(impact.forms.map((f) => f.id)).toContain(form.id);
  });
});

describe('smazání pole', () => {
  it('KRITÉRIUM 80: pole používané naplánovanou kampaní smazat nejde', async () => {
    const ctx = await testContext();
    const { id } = await createFieldWithValues(ctx, 'city', []);
    await createScheduledCampaignUsing(ctx, 'attr.city');
    await expect(deleteContactField(ctx, id)).rejects.toMatchObject({
      code: 'conflict',
      params: { detail: 'field_used_by_scheduled_campaign' },
    });
  });

  it('KRITÉRIUM 81: smazání zařadí i revalidaci šablon, ne jen značku u segmentů', async () => {
    const ctx = await testContext();
    const { id } = await createFieldWithValues(ctx, 'city', []);
    await deleteContactField(ctx, id);
    const jobs = await enqueuedJobNames(ctx);
    expect(jobs).toContain('contacts.strip_attribute');
    expect(jobs).toContain('content.revalidate_templates');
    expect(jobs).toContain('segments.mark_invalid');
  });

  it('job strip_attribute odstraní klíč po dávkách', async () => {
    const ctx = await testContext();
    const { id } = await createFieldWithValues(ctx, 'city', Array<string>(25).fill('Brno'));
    await deleteContactField(ctx, id);
    await stripAttribute({ workspaceId: ctx.workspaceId, key: 'city' });
    expect(await countContactsWithAttribute(ctx, 'city')).toBe(0);
  }, 30_000);

  it('job strip_attribute je idempotentní', async () => {
    const ctx = await testContext();
    const { id } = await createFieldWithValues(ctx, 'city', ['Brno']);
    await deleteContactField(ctx, id);
    const payload = { workspaceId: ctx.workspaceId, key: 'city' };
    await stripAttribute(payload);
    await expect(stripAttribute(payload)).resolves.toEqual({ updated: 0 });
  });
});
