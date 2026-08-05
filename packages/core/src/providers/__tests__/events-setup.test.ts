import { describe, expect, it, vi } from 'vitest';
import {
  setupEventDestination,
  ensureConfigurationSet,
  ensureEventDestination,
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

  /**
   * Instalace ve vývoji má `APP_URL` na `http://localhost`. Protokol zapsaný
   * natvrdo jako `https` Amazon odmítne s `InvalidParameter` a shodí tím celé
   * zakládání účtu na věci, která s odesíláním vůbec nesouvisí.
   */
  it('protokol odberu se odvozuje z adresy, ne natvrdo z https', async () => {
    const a = aws();
    await ensureEventDestination(a as never, {
      ...input,
      appUrl: 'http://localhost:3200',
      configurationSetName: 'mlain-acme',
    });
    expect(a.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'http',
        endpoint: 'http://localhost:3200/api/webhooks/ses/p1',
      }),
    );
  });

  /**
   * Amazon vraci u nepotvrzeneho odberu doslova `pending confirmation`. Je to
   * PLATNY STAV, ne chyba: potvrzeni chodi POSTem na nas webhook a na localhost
   * nedorazi nikdy. Volajici z toho dela „udalosti zatim nechodi", ne selhani.
   */
  it('nepotvrzeny odber neni chyba, jen se pozna podle subscribed = false', async () => {
    const a = aws();
    const r = await ensureEventDestination(a as never, {
      ...input,
      configurationSetName: 'mlain-acme',
    });
    expect(r.subscribed).toBe(false);
    expect(r.topicArn).toBe('arn:aws:sns:eu-central-1:1:mlain-acme-events');
  });

  it('potvrzeny odber vrati subscribed = true', async () => {
    const a = aws({
      subscribe: vi.fn(async () => ({ SubscriptionArn: 'arn:aws:sns:eu-central-1:1:t:abcd' })),
    });
    const r = await ensureEventDestination(a as never, {
      ...input,
      configurationSetName: 'mlain-acme',
    });
    expect(r.subscribed).toBe(true);
  });

  /**
   * Jmeno sady se bere z toho, co dostane funkce, ne z vypoctu ze slugu.
   * Dialog upravy uctu dovoluje jmeno prepsat a sender posila pod ulozenym
   * jmenem; dva zdroje pravdy by se rozesly presne tady.
   */
  it('sada se zaklada pod predanym jmenem, ne pod dopoctenym ze slugu', async () => {
    const a = aws();
    await ensureConfigurationSet(a as never, {
      configurationSetName: 'vlastni-sada',
      workspaceId: 'w1',
    });
    expect(a.createConfigurationSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'vlastni-sada' }),
    );
  });

  it('rucni rezim vypise presne hodnoty a nesaha na AWS', () => {
    const m = manualInstructions(input);
    expect(m.configurationSetName).toBe('mlain-acme');
    expect(m.endpoint).toBe('https://mail.acme.cz/api/webhooks/ses/p1');
    expect(m.eventTypes).toEqual(MATCHING_EVENT_TYPES);
  });
});
