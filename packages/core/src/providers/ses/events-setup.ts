/**
 * OPEN ani CLICK nezapiname, ty vlastni cast 5 pres vlastni tokeny. Dvoji tracking
 * by prepisoval odkazy dvakrat.
 */
export const MATCHING_EVENT_TYPES = [
  'SEND',
  'REJECT',
  'BOUNCE',
  'COMPLAINT',
  'DELIVERY',
  'DELIVERY_DELAY',
  'RENDERING_FAILURE',
] as const;

export type AwsSetupClient = {
  getConfigurationSet(input: {
    name: string;
  }): Promise<{ Tags?: Array<{ Key: string; Value: string }> }>;
  createConfigurationSet(input: { name: string; workspaceId: string }): Promise<unknown>;
  putSuppressionOptions(input: { name: string; reasons: string[] }): Promise<unknown>;
  createTopic(input: { name: string }): Promise<{ TopicArn?: string }>;
  setTopicAttributes(input: {
    topicArn: string;
    attributeName: string;
    attributeValue: string;
  }): Promise<unknown>;
  createEventDestination(input: {
    configurationSetName: string;
    topicArn: string;
    eventTypes: readonly string[];
  }): Promise<unknown>;
  subscribe(input: {
    topicArn: string;
    protocol: string;
    endpoint: string;
    rawMessageDelivery: boolean;
  }): Promise<unknown>;
};

export type ManualInstructionsInput = {
  workspaceSlug: string;
  providerId: string;
  appUrl: string;
};

export function manualInstructions(input: ManualInstructionsInput) {
  return {
    configurationSetName: `mlain-${input.workspaceSlug}`,
    topicName: `mlain-${input.workspaceSlug}-events`,
    endpoint: `${input.appUrl}/api/webhooks/ses/${input.providerId}`,
    eventTypes: MATCHING_EVENT_TYPES,
    suppressedReasons: ['BOUNCE', 'COMPLAINT'],
  };
}

/**
 * Vstup je pojmenovany typ, ne anonymni objekt v seznamu parametru: `scope.test.ts`
 * zakazuje exportovanou funkci s `workspaceId: string` primo mezi parametry a vzor
 * vyjimky je `IssueUnsubscribeTokenInput`.
 */
export type SetupEventDestinationInput = {
  workspaceSlug: string;
  workspaceId: string;
  providerId: string;
  appUrl: string;
  region: string;
};

export async function setupEventDestination(
  aws: AwsSetupClient,
  input: SetupEventDestinationInput,
): Promise<{ topicArn: string; configurationSetName: string }> {
  const name = `mlain-${input.workspaceSlug}`;

  let exists = false;
  try {
    const cs = await aws.getConfigurationSet({ name });
    exists = (cs.Tags ?? []).some(
      (t) => t.Key === 'mlain:workspace' && t.Value === input.workspaceId,
    );
  } catch {
    exists = false;
  }

  if (!exists) {
    // TrackingOptions se NENASTAVUJE: open a click resime vlastnimi tokeny.
    await aws.createConfigurationSet({ name, workspaceId: input.workspaceId });
  }
  // Uctova suppression u Amazonu je DRUHA pojistka vedle nasi vlastni.
  await aws.putSuppressionOptions({ name, reasons: ['BOUNCE', 'COMPLAINT'] });

  const topic = await aws.createTopic({ name: `mlain-${input.workspaceSlug}-events` });
  const topicArn = topic.TopicArn;
  if (!topicArn) throw new Error('SNS nevrátil ARN topicu.');

  await aws.setTopicAttributes({
    topicArn,
    attributeName: 'SignatureVersion',
    attributeValue: '2',
  });
  await aws.createEventDestination({
    configurationSetName: name,
    topicArn,
    eventTypes: MATCHING_EVENT_TYPES,
  });
  // RawMessageDelivery = false, protoze potrebujeme podepsanou obalku SNS.
  await aws.subscribe({
    topicArn,
    protocol: 'https',
    endpoint: `${input.appUrl}/api/webhooks/ses/${input.providerId}`,
    rawMessageDelivery: false,
  });

  return { topicArn, configurationSetName: name };
}
