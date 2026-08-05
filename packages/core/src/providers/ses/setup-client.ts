import {
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  GetConfigurationSetCommand,
  PutConfigurationSetSuppressionOptionsCommand,
  type EventType,
} from '@aws-sdk/client-sesv2';
import {
  CreateTopicCommand,
  SetTopicAttributesCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import type { AwsClients } from './client';
import type { AwsSetupClient } from './events-setup';

/**
 * Převodník mezi hotovými klienty AWS a rozhraním `AwsSetupClient`.
 *
 * Existuje kvůli jedné vadě, kterou by jinak nikdo nenašel: `setupEventDestination`
 * byla napsaná, otestovaná a NEZAPOJENÁ, protože jí chyběl právě tenhle mezikus.
 * Doména mluví v pojmech „založ sadu, přihlas odběr", SDK v pojmech příkazů,
 * a dokud je nikdo nespojil, aplikace si jméno konfigurační sady jen vymyslela
 * a uložila. Odesílání pak padalo na `NotFoundException`.
 *
 * Rozhraní zůstává úzké schválně: testy domény si ho složí z pěti `vi.fn()`
 * a nemusí stavět celé SDK.
 */
export function createSetupClient(aws: AwsClients): AwsSetupClient {
  return {
    async getConfigurationSet(input) {
      const r = await aws.ses.send(
        new GetConfigurationSetCommand({ ConfigurationSetName: input.name }),
      );
      return { Tags: (r.Tags ?? []).map((t) => ({ Key: t.Key ?? '', Value: t.Value ?? '' })) };
    },
    async createConfigurationSet(input) {
      try {
        return await aws.ses.send(
          new CreateConfigurationSetCommand({
            ConfigurationSetName: input.name,
            // Reputační metriky zapnuté: bez nich Amazon nehlásí míru odrazů
            // a brzdy doručitelnosti by neměly z čeho počítat.
            ReputationOptions: { ReputationMetricsEnabled: true },
            // TrackingOptions se NENASTAVUJE, viz `events-setup.ts`.
            Tags: [{ Key: 'mlain:workspace', Value: input.workspaceId }],
          }),
        );
      } catch (err) {
        // Sada se stejným jménem už existuje. Je naše (jméno skládáme my)
        // a je použitelná, jen jí chybí naše značka. Zakládat ji podruhé
        // není chyba, na kterou má uživatel reagovat.
        if (isAlreadyExists(err)) return {};
        throw err;
      }
    },
    async putSuppressionOptions(input) {
      return aws.ses.send(
        new PutConfigurationSetSuppressionOptionsCommand({
          ConfigurationSetName: input.name,
          SuppressedReasons: input.reasons as ('BOUNCE' | 'COMPLAINT')[],
        }),
      );
    },
    async createTopic(input) {
      const r = await aws.sns.send(new CreateTopicCommand({ Name: input.name }));
      return r.TopicArn === undefined ? {} : { TopicArn: r.TopicArn };
    },
    async setTopicAttributes(input) {
      return aws.sns.send(
        new SetTopicAttributesCommand({
          TopicArn: input.topicArn,
          AttributeName: input.attributeName,
          AttributeValue: input.attributeValue,
        }),
      );
    },
    async createEventDestination(input) {
      try {
        return await aws.ses.send(
          new CreateConfigurationSetEventDestinationCommand({
            ConfigurationSetName: input.configurationSetName,
            EventDestinationName: 'mlain-events',
            EventDestination: {
              Enabled: true,
              MatchingEventTypes: [...input.eventTypes] as EventType[],
              SnsDestination: { TopicArn: input.topicArn },
            },
          }),
        );
      } catch (err) {
        // Jméno cíle je stálé, takže druhé volání znamená „už je hotovo".
        // Bez tohohle by opakované ověření spojení hlásilo chybu u účtu,
        // se kterým není nic špatně.
        if (isAlreadyExists(err)) return {};
        throw err;
      }
    },
    async subscribe(input) {
      const r = await aws.sns.send(
        new SubscribeCommand({
          TopicArn: input.topicArn,
          Protocol: input.protocol,
          Endpoint: input.endpoint,
          Attributes: { RawMessageDelivery: String(input.rawMessageDelivery) },
          ReturnSubscriptionArn: true,
        }),
      );
      return r.SubscriptionArn === undefined ? {} : { SubscriptionArn: r.SubscriptionArn };
    },
  };
}

/** Chyba, která znamená „už to tam je". Idempotence, ne selhání. */
export function isAlreadyExists(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  return name === 'AlreadyExistsException' || name === 'ConflictException';
}
