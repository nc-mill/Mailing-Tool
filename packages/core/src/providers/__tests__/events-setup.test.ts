import { describe, expect, it, vi } from 'vitest';
import {
  setupEventDestination,
  MATCHING_EVENT_TYPES,
  manualInstructions,
} from '../ses/events-setup';

function aws(over: Record<string, unknown> = {}) {
  return {
    getConfigurationSet: vi.fn(async () => {
      throw Object.assign(new Error(), { name: 'NotFoundException' });
    }),
    createConfigurationSet: vi.fn(async () => ({})),
    putSuppressionOptions: vi.fn(async () => ({})),
    createTopic: vi.fn(async () => ({ TopicArn: 'arn:aws:sns:eu-central-1:1:mlain-acme-events' })),
    setTopicAttributes: vi.fn(async () => ({})),
    createEventDestination: vi.fn(async () => ({})),
    subscribe: vi.fn(async () => ({ SubscriptionArn: 'pending confirmation' })),
    ...over,
  };
}

const input = {
  workspaceSlug: 'acme',
  workspaceId: 'w1',
  providerId: 'p1',
  appUrl: 'https://mail.acme.cz',
  region: 'eu-central-1',
};

describe('nastaveni udalosti u SES', () => {
  it('OPEN a CLICK se nezapinaji, ty vlastnime sami', () => {
    expect(MATCHING_EVENT_TYPES).toEqual([
      'SEND',
      'REJECT',
      'BOUNCE',
      'COMPLAINT',
      'DELIVERY',
      'DELIVERY_DELAY',
      'RENDERING_FAILURE',
    ]);
    expect(MATCHING_EVENT_TYPES).not.toContain('OPEN');
    expect(MATCHING_EVENT_TYPES).not.toContain('CLICK');
  });

  it('jmeno Configuration Setu je mlain-<slug>', async () => {
    const a = aws();
    await setupEventDestination(a as never, input);
    expect(a.createConfigurationSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'mlain-acme' }),
    );
  });

  it('existujici nas Configuration Set se znovu nezaklada', async () => {
    const a = aws({
      getConfigurationSet: vi.fn(async () => ({ Tags: [{ Key: 'mlain:workspace', Value: 'w1' }] })),
    });
    await setupEventDestination(a as never, input);
    expect(a.createConfigurationSet).not.toHaveBeenCalled();
  });

  it('suppression u Amazonu je druha pojistka vedle nasi', async () => {
    const a = aws();
    await setupEventDestination(a as never, input);
    expect(a.putSuppressionOptions).toHaveBeenCalledWith(
      expect.objectContaining({ reasons: ['BOUNCE', 'COMPLAINT'] }),
    );
  });

  it('odber miri na /api/webhooks/ses/<provider_id> a RawMessageDelivery je false', async () => {
    const a = aws();
    await setupEventDestination(a as never, input);
    expect(a.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'https',
        endpoint: 'https://mail.acme.cz/api/webhooks/ses/p1',
        rawMessageDelivery: false,
      }),
    );
  });

  it('SignatureVersion se nastavuje na 2', async () => {
    const a = aws();
    await setupEventDestination(a as never, input);
    expect(a.setTopicAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ attributeName: 'SignatureVersion', attributeValue: '2' }),
    );
  });

  it('rucni rezim vypise presne hodnoty a nesaha na AWS', () => {
    const m = manualInstructions(input);
    expect(m.configurationSetName).toBe('mlain-acme');
    expect(m.endpoint).toBe('https://mail.acme.cz/api/webhooks/ses/p1');
    expect(m.eventTypes).toEqual(MATCHING_EVENT_TYPES);
  });
});
