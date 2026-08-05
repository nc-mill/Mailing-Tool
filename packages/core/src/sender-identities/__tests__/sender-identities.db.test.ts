/**
 * Databázové testy předvoleb odesílatele.
 *
 * Míří na to, co se nedá ověřit jednotkovým testem: že migrace opravdu doběhla,
 * že složený cizí klíč platí, že částečný unikátní index drží jednu výchozí
 * předvolbu a že kaskáda po smazání domény a účtu opravdu uklidí.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedProvider, withTestWorkspace, type TestWorkspace } from '../../campaigns/test/harness';
import { rawSql } from '../../campaigns/repo/raw-sql';
import { withWorkspace } from '../../tx';
import { ApiError } from '../../errors/api-error';
import {
  createSenderIdentity,
  deleteSenderIdentity,
  getDefaultSenderIdentity,
  getSenderIdentity,
  listSenderIdentities,
  setDefaultSenderIdentity,
  updateSenderIdentity,
} from '../repo';
import { createSenderIdentityFromApi, updateSenderIdentityFromApi } from '../service';

/** Doména se zakládá přímo, ne přes `addDomain`: ten volá Amazon. */
async function seedDomain(
  ctx: TestWorkspace,
  providerId: string,
  domain: string,
  verified = true,
): Promise<string> {
  const id = randomUUID();
  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(
        `INSERT INTO sender_domains (id, workspace_id, provider_id, domain, verified_at)
         VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END)`,
        [id, ctx.workspaceId, providerId, domain, verified],
      ),
    ),
  );
  return id;
}

function input(over: Partial<Parameters<typeof createSenderIdentityFromApi>[1]> = {}) {
  return {
    name: 'Newsletter',
    from_name: 'Kolo Shop',
    from_email: 'newsletter@kolo-shop.cz',
    reply_to: null,
    provider_id: '',
    sender_domain_id: '',
    is_default: false,
    ...over,
  };
}

describe('předvolby odesílatele', () => {
  let ctx: TestWorkspace;
  let providerId: string;
  let domainId: string;

  beforeEach(async () => {
    ctx = await withTestWorkspace();
    providerId = await seedProvider(ctx, {});
    domainId = await seedDomain(ctx, providerId, 'kolo-shop.cz');
  });

  it('předvolba se uloží a přečte i s jménem účtu a doménou', async () => {
    const id = await createSenderIdentity(
      ctx.workspace,
      {
        name: 'Newsletter',
        fromName: 'Kolo Shop',
        fromEmail: 'Newsletter@Kolo-Shop.cz',
        replyTo: 'Podpora@Kolo-Shop.cz',
        providerId,
        senderDomainId: domainId,
        isDefault: true,
      },
      null,
    );

    const row = await getSenderIdentity(ctx.workspace, id);
    expect(row).not.toBeNull();
    // Adresy se ukládají malými písmeny, jinak by je nepustilo omezení
    // `ck_sender_identities__from_email`.
    expect(row!.from_email).toBe('newsletter@kolo-shop.cz');
    expect(row!.reply_to).toBe('podpora@kolo-shop.cz');
    expect(row!.domain).toBe('kolo-shop.cz');
    expect(row!.domain_verified).toBe(true);
    expect(row!.provider_name).toBe('Provider');
    expect(row!.is_default).toBe(true);

    expect((await getDefaultSenderIdentity(ctx.workspace))!.id).toBe(id);
    expect(await listSenderIdentities(ctx.workspace)).toHaveLength(1);
  });

  it('výchozí předvolba je vždycky jen jedna', async () => {
    const a = await createSenderIdentity(
      ctx.workspace,
      {
        name: 'A',
        fromName: 'A',
        fromEmail: 'a@kolo-shop.cz',
        replyTo: null,
        providerId,
        senderDomainId: domainId,
        isDefault: true,
      },
      null,
    );
    const b = await createSenderIdentity(
      ctx.workspace,
      {
        name: 'B',
        fromName: 'B',
        fromEmail: 'b@kolo-shop.cz',
        replyTo: null,
        providerId,
        senderDomainId: domainId,
        isDefault: true,
      },
      null,
    );

    expect((await getSenderIdentity(ctx.workspace, a))!.is_default).toBe(false);
    expect((await getSenderIdentity(ctx.workspace, b))!.is_default).toBe(true);

    await setDefaultSenderIdentity(ctx.workspace, a);
    expect((await getSenderIdentity(ctx.workspace, a))!.is_default).toBe(true);
    expect((await getSenderIdentity(ctx.workspace, b))!.is_default).toBe(false);
  });

  it('adresa mimo vybranou doménu se neuloží', async () => {
    await expect(
      createSenderIdentityFromApi(
        ctx.workspace,
        input({
          provider_id: providerId,
          sender_domain_id: domainId,
          from_email: 'newsletter@jina-domena.cz',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      errors: [expect.objectContaining({ path: 'from_email', code: 'email_outside_domain' })],
    });

    // A po zamítnutí v tabulce opravdu nic není, ne že by se to jen nevrátilo.
    expect(await listSenderIdentities(ctx.workspace)).toHaveLength(0);
  });

  it('poddoména ověřené domény projde', async () => {
    const payload = await createSenderIdentityFromApi(
      ctx.workspace,
      input({
        provider_id: providerId,
        sender_domain_id: domainId,
        from_email: 'newsletter@news.kolo-shop.cz',
      }),
    );
    expect(payload.from_email).toBe('newsletter@news.kolo-shop.cz');
  });

  it('doména cizího účtu se k předvolbě přiřadit nedá', async () => {
    const other = await seedProvider(ctx, {});
    await expect(
      createSenderIdentityFromApi(
        ctx.workspace,
        input({ provider_id: other, sender_domain_id: domainId }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      errors: [
        expect.objectContaining({ path: 'sender_domain_id', code: 'domain_provider_mismatch' }),
      ],
    });
  });

  it('cizí klíč drží i tehdy, když aplikační kontrolu někdo obejde', async () => {
    const other = await seedProvider(ctx, {});
    await expect(
      withWorkspace(ctx.workspace, (tx) =>
        tx.execute(
          rawSql(
            `INSERT INTO sender_identities
               (workspace_id, name, from_name, from_email, provider_id, sender_domain_id)
             VALUES ($1, 'Podvrh', 'X', 'x@kolo-shop.cz', $2, $3)`,
            [ctx.workspaceId, other, domainId],
          ),
        ),
      ),
    ).rejects.toThrowError();
  });

  it('dvě předvolby se stejným názvem neprojdou', async () => {
    await createSenderIdentityFromApi(
      ctx.workspace,
      input({ provider_id: providerId, sender_domain_id: domainId }),
    );
    await expect(
      createSenderIdentityFromApi(
        ctx.workspace,
        input({
          provider_id: providerId,
          sender_domain_id: domainId,
          name: 'newsletter',
          from_email: 'jiny@kolo-shop.cz',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      errors: [expect.objectContaining({ path: 'name', code: 'duplicate' })],
    });
  });

  it('úprava předvolby projde stejnými kontrolami jako založení', async () => {
    const created = await createSenderIdentityFromApi(
      ctx.workspace,
      input({ provider_id: providerId, sender_domain_id: domainId }),
    );

    const updated = await updateSenderIdentityFromApi(
      ctx.workspace,
      created.id,
      input({
        provider_id: providerId,
        sender_domain_id: domainId,
        name: 'Fakturace',
        from_email: 'faktury@kolo-shop.cz',
        reply_to: 'ucetni@jinde.cz',
        is_default: true,
      }),
    );
    expect(updated.name).toBe('Fakturace');
    // Adresa pro odpovědi SMÍ být mimo odesílací doménu, kontrola se jí netýká.
    expect(updated.reply_to).toBe('ucetni@jinde.cz');
    expect(updated.is_default).toBe(true);

    await expect(
      updateSenderIdentityFromApi(
        ctx.workspace,
        created.id,
        input({
          provider_id: providerId,
          sender_domain_id: domainId,
          from_email: 'nekdo@uplne-jinde.cz',
        }),
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('smazání domény vezme předvolbu s sebou, kampaň nechá být', async () => {
    const identity = await createSenderIdentityFromApi(
      ctx.workspace,
      input({ provider_id: providerId, sender_domain_id: domainId }),
    );

    // Kampaň si hodnoty ZKOPÍRUJE a drží jen poznámku o původu.
    const campaignId = randomUUID();
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(
          `INSERT INTO campaigns
             (id, workspace_id, name, status, subject, from_name, from_email, sender_identity_id)
           VALUES ($1, $2, 'Kampaň', 'sent', 'Předmět', $3, $4, $5)`,
          [campaignId, ctx.workspaceId, identity.from_name, identity.from_email, identity.id],
        ),
      ),
    );

    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(`DELETE FROM sender_domains WHERE id = $1 AND workspace_id = $2`, [
          domainId,
          ctx.workspaceId,
        ]),
      ),
    );

    expect(await getSenderIdentity(ctx.workspace, identity.id)).toBeNull();

    const after = await withWorkspace(ctx.workspace, async (tx) => {
      const r = await tx.execute<{
        from_email: string;
        from_name: string;
        sender_identity_id: string | null;
      }>(
        rawSql(`SELECT from_email, from_name, sender_identity_id FROM campaigns WHERE id = $1`, [
          campaignId,
        ]),
      );
      return r.rows[0]!;
    });
    expect(after.from_email).toBe('newsletter@kolo-shop.cz');
    expect(after.from_name).toBe('Kolo Shop');
    // Poznámka o původu zmizela, obsah kampaně ne.
    expect(after.sender_identity_id).toBeNull();
  });

  it('smazání odesílacího účtu uklidí doménu i předvolbu', async () => {
    const identity = await createSenderIdentityFromApi(
      ctx.workspace,
      input({ provider_id: providerId, sender_domain_id: domainId }),
    );
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(`DELETE FROM sending_providers WHERE id = $1 AND workspace_id = $2`, [
          providerId,
          ctx.workspaceId,
        ]),
      ),
    );
    expect(await getSenderIdentity(ctx.workspace, identity.id)).toBeNull();
  });

  it('smazání předvolby projde a nesahá na kampaň', async () => {
    const identity = await createSenderIdentityFromApi(
      ctx.workspace,
      input({ provider_id: providerId, sender_domain_id: domainId }),
    );
    expect(await deleteSenderIdentity(ctx.workspace, identity.id)).toBe(true);
    expect(await deleteSenderIdentity(ctx.workspace, identity.id)).toBe(false);
  });

  it('repo hlásí neexistující řádek, nevymýšlí si', async () => {
    expect(await getSenderIdentity(ctx.workspace, randomUUID())).toBeNull();
    expect(
      await updateSenderIdentity(ctx.workspace, randomUUID(), {
        name: 'X',
        fromName: 'X',
        fromEmail: 'x@kolo-shop.cz',
        replyTo: null,
        providerId,
        senderDomainId: domainId,
        isDefault: false,
      }),
    ).toBe(false);
    expect(await setDefaultSenderIdentity(ctx.workspace, randomUUID())).toBe(false);
  });
});
