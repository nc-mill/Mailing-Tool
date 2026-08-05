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

export function configurationSetNameFor(workspaceSlug: string): string {
  return `mlain-${workspaceSlug}`;
}

/**
 * KROK, KTERÝ ROZHODUJE O TOM, JESTLI VŮBEC NĚCO ODEJDE.
 *
 * Konfigurační sada se u Amazonu musí opravdu ZALOŽIT, ne jen pojmenovat. Když si
 * aplikace jméno vymyslí, uloží ho do konfigurace a u Amazonu ho nikdo nevytvoří,
 * skončí KAŽDÉ odeslání na `NotFoundException` a zpráva neodejde. Přesně to se
 * stalo: `ListConfigurationSets` na účtu vracel prázdný seznam, přestože jméno
 * `mlain-<slug>` bylo v konfiguraci uložené.
 *
 * Proto je založení sady oddělené od nastavení událostí. Sada je podmínka
 * odesílání a její selhání se musí ohlásit hned. Události jsou zpětná vazba
 * a bez nich se odesílat DÁ, jen se nedozvíme o odrazech.
 */
export async function ensureConfigurationSet(
  aws: AwsSetupClient,
  input: { configurationSetName: string; workspaceId: string },
): Promise<{ configurationSetName: string; created: boolean }> {
  const name = input.configurationSetName;

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

  return { configurationSetName: name, created: !exists };
}

/**
 * Zpětná vazba od Amazonu: SNS topic, cíl událostí a odběr našeho webhooku.
 *
 * `protocol` se odvozuje z adresy, ne natvrdo z `https`. Instalace ve vývoji má
 * `APP_URL` na `http://localhost`, a odběr s protokolem `https` a adresou `http://…`
 * Amazon odmítne s `InvalidParameter`. Natvrdo zapsaný protokol tedy shodil celé
 * zakládání účtu na věci, která s odesíláním vůbec nesouvisí.
 */
export async function ensureEventDestination(
  aws: AwsSetupClient,
  input: SetupEventDestinationInput & { configurationSetName: string },
): Promise<{
  topicArn: string;
  subscribed: boolean;
  subscriptionArn: string | null;
  /** Proč se odběr nepovedl. `null` znamená, že volání prošlo. */
  subscribeError: string | null;
}> {
  const topic = await aws.createTopic({ name: `mlain-${input.workspaceSlug}-events` });
  const topicArn = topic.TopicArn;
  if (!topicArn) throw new Error('SNS nevrátil ARN topicu.');

  await aws.setTopicAttributes({
    topicArn,
    attributeName: 'SignatureVersion',
    attributeValue: '2',
  });
  await aws.createEventDestination({
    configurationSetName: input.configurationSetName,
    topicArn,
    eventTypes: MATCHING_EVENT_TYPES,
  });

  const endpoint = `${input.appUrl}/api/webhooks/ses/${input.providerId}`;

  /*
   * ODBĚR SE ZKOUŠÍ, ALE NESMÍ SHODIT ZBYTEK.
   *
   * V tuhle chvíli je u Amazonu hotové všechno, na čem stojí odesílání:
   * konfigurační sada, topic i cíl událostí. Odběr je poslední krok a zároveň
   * jediný, který závisí na tom, jestli je naše adresa z internetu dosažitelná.
   * Instalace ve vývoji běží na `localhost` a Amazon na ni odpoví doslova
   * „Not authorized to subscribe internal endpoints"; ověřeno spuštěním proti
   * skutečnému účtu. Kdyby se ta chyba propadla ven, přišli bychom i o ARN
   * topicu, který právě vznikl, a příští běh by ho zakládal znovu.
   *
   * Amazon navíc u nepotvrzeného odběru vrací doslova `pending confirmation`
   * místo identifikátoru. Potvrzení chodí POSTem na náš webhook, takže na
   * localhost nedorazí nikdy. Obojí je platný stav „události zatím nechodí".
   */
  let subscriptionArn: string | null = null;
  let subscribeError: string | null = null;
  try {
    // RawMessageDelivery = false, protoze potrebujeme podepsanou obalku SNS.
    const sub = (await aws.subscribe({
      topicArn,
      protocol: endpoint.startsWith('https://') ? 'https' : 'http',
      endpoint,
      rawMessageDelivery: false,
    })) as { SubscriptionArn?: string } | undefined;
    subscriptionArn = sub?.SubscriptionArn ?? null;
  } catch (err) {
    subscribeError = err instanceof Error ? err.message : 'Odběr událostí se nepodařilo založit.';
  }

  return {
    topicArn,
    subscribed: subscriptionArn !== null && subscriptionArn.startsWith('arn:'),
    subscriptionArn,
    subscribeError,
  };
}

export async function setupEventDestination(
  aws: AwsSetupClient,
  input: SetupEventDestinationInput,
): Promise<{ topicArn: string; configurationSetName: string }> {
  const { configurationSetName } = await ensureConfigurationSet(aws, {
    configurationSetName: configurationSetNameFor(input.workspaceSlug),
    workspaceId: input.workspaceId,
  });
  const { topicArn } = await ensureEventDestination(aws, { ...input, configurationSetName });
  return { topicArn, configurationSetName };
}
