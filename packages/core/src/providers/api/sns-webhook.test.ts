import { describe, expect, it, vi } from 'vitest';
import { handleSnsWebhook, type SnsWebhookDeps, type SnsVerdict } from './sns-webhook';

const bounce = JSON.stringify({
  Type: 'Notification',
  MessageId: 'm-1',
  TopicArn: 'arn:aws:sns:eu-central-1:1:mlain-events',
  Message: '{"eventType":"Bounce"}',
});

const confirmation = JSON.stringify({
  Type: 'SubscriptionConfirmation',
  MessageId: 'm-2',
  TopicArn: 'arn:aws:sns:eu-central-1:1:mlain-events',
  Token: 'abc',
});

function deps(overrides: Partial<SnsWebhookDeps> & { verdict?: SnsVerdict } = {}) {
  const state = {
    receiptsWritten: 0,
    invalidWritten: 0,
    jobsSent: 0,
    subscriptionConfirmed: false,
    eventsStopped: false,
    securityEvents: 0,
  };
  const base: SnsWebhookDeps = {
    findProvider: async () => ({ workspaceId: 'w1', snsTopicArn: 'arn:aws:sns:x' }),
    verify: async () => overrides.verdict ?? { ok: true },
    recordInvalid: async () => {
      state.invalidWritten += 1;
    },
    insertOnce: async () => {
      state.receiptsWritten += 1;
      return 'r-1';
    },
    confirmSubscription: async () => {
      state.subscriptionConfirmed = true;
    },
    markEventsStopped: async () => {
      state.eventsStopped = true;
    },
    enqueueProcess: async () => {
      state.jobsSent += 1;
    },
    securityEvent: async () => {
      state.securityEvents += 1;
    },
    log: vi.fn(),
  };
  return { deps: { ...base, ...overrides } as SnsWebhookDeps, state };
}

describe('POST /api/webhooks/ses/{provider_id}', () => {
  it('bez zaregistrovaného ověření podpisu NIC nepřijme', async () => {
    const res = await handleSnsWebhook(null, { providerId: 'p1', rawBody: bounce, ip: null });
    expect(res.status).toBe(503);
  });

  it('špatný podpis vrací 401 a NEZAPÍŠE nic do potvrzenek', async () => {
    const { deps: d, state } = deps({ verdict: { ok: false, reason: 'bad_signature' } });
    const res = await handleSnsWebhook(d, { providerId: 'p1', rawBody: bounce, ip: '1.2.3.4' });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body ?? '{}')).toMatchObject({
      code: 'signature_invalid',
      params: { reason: 'bad_signature' },
    });
    expect(state.receiptsWritten).toBe(0);
    expect(state.securityEvents).toBe(1);
  });

  it('cert URL na cizím hostu vrací 401 cert_url_not_allowed', async () => {
    const { deps: d } = deps({ verdict: { ok: false, reason: 'cert_url_not_allowed' } });
    const res = await handleSnsWebhook(d, { providerId: 'p1', rawBody: bounce, ip: null });
    expect(JSON.parse(res.body ?? '{}').params.reason).toBe('cert_url_not_allowed');
  });

  it('cizí topic vrací 401 topic_mismatch', async () => {
    const { deps: d } = deps({ verdict: { ok: false, reason: 'topic_mismatch' } });
    const res = await handleSnsWebhook(d, { providerId: 'p1', rawBody: bounce, ip: null });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body ?? '{}').params.reason).toBe('topic_mismatch');
  });

  it('platná Notification vrací 200 s prázdným tělem a pošle úlohu', async () => {
    const { deps: d, state } = deps();
    const res = await handleSnsWebhook(d, { providerId: 'p1', rawBody: bounce, ip: null });
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(state.jobsSent).toBe(1);
  });

  it('SubscriptionConfirmation potvrdí odběr', async () => {
    const { deps: d, state } = deps();
    await handleSnsWebhook(d, { providerId: 'p1', rawBody: confirmation, ip: null });
    expect(state.subscriptionConfirmed).toBe(true);
    expect(state.jobsSent).toBe(0);
  });

  it('staré Timestamp se přijme s 200, ale nezpracuje', async () => {
    const { deps: d, state } = deps({
      verdict: { ok: false, reason: 'stale_timestamp', accept: true },
    });
    const res = await handleSnsWebhook(d, { providerId: 'p1', rawBody: bounce, ip: null });
    expect(res.status).toBe(200);
    expect(state.jobsSent).toBe(0);
    expect(state.invalidWritten).toBe(1);
  });

  it('tělo nad 256 kB vrací 413', async () => {
    const { deps: d } = deps();
    const res = await handleSnsWebhook(d, {
      providerId: 'p1',
      rawBody: 'x'.repeat(300 * 1024),
      ip: null,
    });
    expect(res.status).toBe(413);
  });

  it('neplatný JSON vrací 422 a nesahá na databázi', async () => {
    const { deps: d, state } = deps();
    const res = await handleSnsWebhook(d, { providerId: 'p1', rawBody: '{neplatne', ip: null });
    expect(res.status).toBe(422);
    expect(state.receiptsWritten).toBe(0);
  });

  it('neznámý provider vrací 200 a mlčí, aby neprozradil platná id', async () => {
    const { deps: d, state } = deps({ findProvider: async () => null });
    const res = await handleSnsWebhook(d, { providerId: 'p1', rawBody: bounce, ip: null });
    expect(res.status).toBe(200);
    expect(state.jobsSent).toBe(0);
  });

  it('chyba zpracování NEVRACÍ 500, jinak by SNS zesilovalo provoz', async () => {
    const { deps: d } = deps({
      insertOnce: async () => {
        throw new Error('databáze je pryč');
      },
    });
    const res = await handleSnsWebhook(d, { providerId: 'p1', rawBody: bounce, ip: null });
    expect(res.status).toBe(200);
  });

  it('duplicitní zpráva se nezařadí podruhé', async () => {
    const { deps: d, state } = deps({ insertOnce: async () => null });
    await handleSnsWebhook(d, { providerId: 'p1', rawBody: bounce, ip: null });
    expect(state.jobsSent).toBe(0);
  });

  it('odpověď neobsahuje nic z těla požadavku, endpoint není reflektor', async () => {
    const { deps: d } = deps();
    const res = await handleSnsWebhook(d, { providerId: 'p1', rawBody: bounce, ip: null });
    expect(res.body ?? '').not.toContain('TopicArn');
  });
});
